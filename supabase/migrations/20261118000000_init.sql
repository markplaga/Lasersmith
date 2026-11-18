-- Lasersmith accounts and shared library (PRD M4, sections 5.2, 5.3, 11).
-- Apply with the Supabase CLI (supabase db push) or paste into the SQL editor.
-- The browser talks to these tables directly through Supabase's REST API; row-level security below
-- is what keeps private designs private.

-- Profiles: one per user, created on sign-up. Names are public (for attribution on shared designs).
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '' check (char_length(name) <= 60),
  machine jsonb,                       -- machine and material profile (section 10)
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Designs: a library entry made by a user. Either a reference to a built-in generator (generator,
-- with saved params: a "variant") or a generator's own source (code, e.g. made with Claude).
create table public.designs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  tags text[] not null default '{}',
  generator text,                      -- built-in library id (native or boxes.py)
  code text check (char_length(code) <= 200000),
  schema jsonb,                        -- parameter schema of code designs
  params jsonb not null default '{}',
  material jsonb,
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  checked boolean not null default false, -- passed Lasersmith's validation when last saved
  fork_of uuid references public.designs on delete set null,
  thumbnail text,                      -- path in the thumbnails bucket
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint has_generator check (generator is not null or code is not null),
  -- Section 5.3: only designs that passed validation can be shared.
  constraint shared_is_checked check (visibility = 'private' or checked)
);
create index designs_owner on public.designs (owner);
create index designs_public on public.designs (updated_at desc) where visibility = 'public';

create function public.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger designs_touch before update on public.designs for each row execute function public.touch();

-- Published versions are immutable (section 5.2): insert-only.
create table public.design_versions (
  design uuid not null references public.designs on delete cascade,
  version int not null,
  title text not null,
  code text,
  schema jsonb,
  params jsonb not null,
  created_at timestamptz not null default now(),
  primary key (design, version)
);

-- Reports for takedown (section 5.3).
create table public.reports (
  id bigint generated always as identity primary key,
  design uuid not null references public.designs on delete cascade,
  reporter uuid not null default auth.uid() references public.profiles on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.designs enable row level security;
alter table public.design_versions enable row level security;
alter table public.reports enable row level security;

create policy "profiles are readable" on public.profiles for select using (true);
create policy "own profile" on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Anyone sees public designs; owners see all of theirs. Unlisted designs are read by id through
-- get_design() below, so they never show up in a listing.
create policy "read public or own" on public.designs for select
  using (visibility = 'public' or owner = (select auth.uid()));
create policy "insert own" on public.designs for insert with check (owner = (select auth.uid()));
create policy "update own" on public.designs for update using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "delete own" on public.designs for delete using (owner = (select auth.uid()));

create policy "read versions of visible designs" on public.design_versions for select
  using (exists (select 1 from public.designs d where d.id = design and (d.visibility = 'public' or d.owner = (select auth.uid()))));
create policy "add versions to own designs" on public.design_versions for insert
  with check (exists (select 1 from public.designs d where d.id = design and d.owner = (select auth.uid())));

create policy "signed-in users report" on public.reports for insert with check (reporter = (select auth.uid()));

-- A design by id: public, unlisted, or the caller's own.
create function public.get_design(design_id uuid) returns setof public.designs
language sql stable security definer set search_path = '' as $$
  select * from public.designs
  where id = design_id and (visibility in ('public', 'unlisted') or owner = (select auth.uid()));
$$;
grant execute on function public.get_design(uuid) to anon, authenticated;

-- Thumbnails: a public bucket; users write only under their own folder (<user id>/<design id>.png).
insert into storage.buckets (id, name, public) values ('thumbnails', 'thumbnails', true) on conflict do nothing;
create policy "thumbnails: write own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "thumbnails: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "thumbnails: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);
