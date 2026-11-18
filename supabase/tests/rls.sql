-- Row-level security checks: each block asserts one rule. Run through run.sh.
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', what; end if; raise notice 'ok  %', what; end $$;
create function pg_temp.fails(stmt text, what text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok  %', what; return; end;
  raise exception 'FAILED (statement succeeded): %', what;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'ada@x.com', '{"full_name":"Ada"}'), ('22222222-2222-2222-2222-222222222222', 'mark@x.com', '{}');
select pg_temp.expect((select count(*) from public.profiles) = 2, 'a profile is made for every new user');

set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into public.designs (title, generator, checked, visibility) values ('pub', 'finger-box', true, 'public'), ('unl', 'finger-box', true, 'unlisted'), ('priv', 'finger-box', true, 'private');
select pg_temp.fails($$insert into public.designs (title, generator, checked, visibility) values ('bad', 'finger-box', false, 'public')$$, 'an unchecked design cannot be shared');
select pg_temp.fails($$insert into public.designs (title) values ('nogen')$$, 'a design needs a generator or code');
select pg_temp.expect((select count(*) from public.designs) = 3, 'the owner sees all their designs');
select pg_temp.expect((select count(*) from public.design_versions) = 0, 'no versions yet');
insert into public.design_versions (design, version, title, params) select id, 1, title, params from public.designs where title = 'pub';
select pg_temp.expect((select count(*) from storage.objects) = 0, 'no thumbnails yet');
insert into storage.objects (bucket_id, name) values ('thumbnails', '11111111-1111-1111-1111-111111111111/a.png');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('thumbnails', '22222222-2222-2222-2222-222222222222/a.png')$$, 'thumbnails go only in your own folder');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.expect((select array_agg(title) from public.designs) = array['pub'], 'others list only public designs');
select pg_temp.expect((select count(*) from public.get_design((select id from public.designs where false union all (select d.id from public.designs d limit 0)))) = 0, 'get_design with no id finds nothing');
reset role;
create temp table ids as select title, id from public.designs;
grant select on ids to authenticated, anon;
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.expect((select count(*) from public.get_design((select id from ids where title = 'unl'))) = 1, 'an unlisted design opens by id');
select pg_temp.expect((select count(*) from public.get_design((select id from ids where title = 'priv'))) = 0, 'someone else''s private design does not open by id');
select pg_temp.expect((select count(*) from public.design_versions) = 1, 'versions of public designs are readable');
update public.designs set title = 'hacked' where title = 'pub';
select pg_temp.fails($$insert into public.designs (owner, title, generator) values ('11111111-1111-1111-1111-111111111111', 'spoof', 'x')$$, 'cannot create designs as someone else');
select pg_temp.fails($$insert into public.design_versions (design, version, title, params) select id, 2, 'x', '{}' from ids where title = 'pub'$$, 'cannot add versions to someone else''s design');
delete from public.designs where title = 'pub';
insert into public.reports (design, reason) select id, 'spam' from ids where title = 'pub';
select pg_temp.expect((select count(*) from public.reports) = 0, 'reports are not readable by users');
insert into public.designs (title, generator, fork_of) select 'pub (fork)', 'finger-box', id from ids where title = 'pub';

set role anon;
select pg_temp.as_user('');
select pg_temp.expect((select array_agg(title) from public.designs) = array['pub'], 'signed-out visitors see public designs only');
select pg_temp.fails($$insert into public.designs (title, generator) values ('anon', 'x')$$, 'signed-out visitors cannot save');

reset role;
select pg_temp.expect((select title from public.designs where title like 'pub%' order by title limit 1) = 'pub', 'others'' updates and deletes change nothing');
select pg_temp.expect((select count(*) from public.reports) = 1, 'the report was stored');
update public.design_versions set title = 'changed';
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update public.design_versions set title = 'edited';
reset role;
select pg_temp.expect((select title from public.design_versions limit 1) = 'changed', 'published versions cannot be edited by their owner');
