import assert from 'node:assert/strict';
import { createSupabase } from '../src/cloud/supabase.js';
import { createStore, createMemoryStore } from '../src/cloud/store.js';

/** A fake fetch that records requests and answers from a handler. */
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, ...init, body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    const [status, data] = handler(url, init) || [200, null];
    return { ok: status < 300, status, text: async () => (data == null ? '' : JSON.stringify(data)) };
  };
  f.calls = calls;
  return f;
}
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };

await test('supabase client: magic link, redirect sign-in, auth headers, token refresh', async () => {
  let t = 1_000_000;
  const f = fakeFetch((url) => {
    if (url.includes('/auth/v1/user')) return [200, { id: 'u1', email: 'm@x.com' }];
    if (url.includes('grant_type=refresh_token')) return [200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 }];
    if (url.includes('/rest/v1/designs')) return [200, []];
    return [200, {}];
  });
  const sb = createSupabase({ url: 'https://p.supabase.co/', anonKey: 'ANON', fetch: f, storage: mem(), now: () => t });
  await sb.auth.sendLink('m@x.com', 'https://lasersmith.app/');
  assert.equal(f.calls[0].url, 'https://p.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Flasersmith.app%2F');
  assert.deepEqual(f.calls[0].body, { email: 'm@x.com', create_user: true });
  assert.equal(f.calls[0].headers.Authorization, 'Bearer ANON');
  assert.ok(sb.auth.googleURL('https://lasersmith.app/').startsWith('https://p.supabase.co/auth/v1/authorize?provider=google&redirect_to='));
  assert.equal(await sb.auth.fromRedirect('#access_token=A1&refresh_token=R1&expires_in=3600&token_type=bearer'), true);
  assert.equal(sb.auth.user.email, 'm@x.com');
  await sb.db.select('designs', 'select=id');
  assert.equal(f.calls.at(-1).headers.Authorization, 'Bearer A1');
  assert.equal(f.calls.at(-1).headers.apikey, 'ANON');
  t += 3_590_000; // within a minute of expiry
  await sb.db.select('designs', 'select=id');
  assert.ok(f.calls.at(-2).url.includes('grant_type=refresh_token'));
  assert.equal(f.calls.at(-1).headers.Authorization, 'Bearer A2');
  assert.equal(await sb.auth.fromRedirect(''), false);
});

await test('supabase store: listing asks only for public designs; sharing records a version', async () => {
  const designs = [{ id: 'd1', owner: 'u1', title: 'Box', version: 3, checked: true, code: null, schema: null, params: { width: 1 } }];
  const f = fakeFetch((url, init) => {
    if (url.includes('/auth/v1/user')) return [200, { id: 'u1', email: 'm@x.com' }];
    if (url.includes('/rest/v1/designs') && init.method === 'PATCH') return [200, [{ ...designs[0], ...JSON.parse(init.body) }]];
    if (url.includes('/rest/v1/designs')) return [200, designs];
    if (url.includes('/rest/v1/design_versions')) return [201, [{}]];
    return [200, []];
  });
  const sb = createSupabase({ url: 'https://p.supabase.co', anonKey: 'ANON', fetch: f, storage: mem() });
  const st = createStore(sb);
  await st.listPublic('tea, box*');
  const u = decodeURIComponent(f.calls.at(-1).url);
  assert.ok(u.includes('visibility=eq.public') && u.includes('title.ilike.*tea  box*'), u);
  await assert.rejects(() => st.save({ title: 'x', generator: 'finger-box' }), /Sign in/);
  await sb.auth.fromRedirect('#access_token=A&refresh_token=R&expires_in=3600');
  const r = await st.setVisibility('d1', 'public');
  const ver = f.calls.find(c => c.url.includes('design_versions'));
  assert.deepEqual([ver.body.design, ver.body.version], ['d1', 3]);
  assert.equal(r.visibility, 'public');
  assert.equal(r.version, 4);
});

await test('memory store follows the same rules as the database', async () => {
  const st = createMemoryStore({ designs: [
    { id: 'p', owner: 'a', title: 'Pub', description: '', visibility: 'public', checked: true, version: 1, params: {} },
    { id: 'u', owner: 'a', title: 'Unl', description: '', visibility: 'unlisted', checked: true, version: 1, params: {} },
    { id: 'x', owner: 'a', title: 'Priv', description: '', visibility: 'private', checked: true, version: 1, params: {} },
  ] });
  assert.deepEqual((await st.listPublic()).map(d => d.id), ['p']);
  assert.ok(await st.get('u'));
  assert.equal(await st.get('x'), null);
  st.signInAs({ id: 'b', name: 'B' });
  const d = await st.save({ title: 'Mine', generator: 'finger-box', params: {}, checked: false });
  await assert.rejects(() => st.setVisibility(d.id, 'public'), /Checks/);
  await assert.rejects(() => st.save({ id: 'p', title: 'hack' }), /Not yours/);
  const f = await st.fork({ id: 'p' });
  assert.equal(f.fork_of, 'p');
  assert.equal(f.title, 'Pub (fork)');
});
