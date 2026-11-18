// A small Supabase client over fetch (no SDK): email magic link and Google sign-in (GoTrue), table
// reads and writes (PostgREST) and thumbnail upload (Storage). Row-level security in
// supabase/migrations decides what each user may see and change.

const SESSION_KEY = 'lasersmith-session-v1';

export class CloudError extends Error {
  constructor(msg, status, code) { super(msg); this.status = status; this.code = code; }
}

/**
 * @param o {url, anonKey, fetch?, storage? (localStorage-like), now? () => ms}
 */
export function createSupabase({ url, anonKey, fetch: f = globalThis.fetch.bind(globalThis), storage = safeStorage(), now = () => Date.now() }) {
  const base = String(url).replace(/\/+$/, '');
  let session = null;
  try { session = JSON.parse(storage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
  const keep = s => { session = s; try { s ? storage.setItem(SESSION_KEY, JSON.stringify(s)) : storage.removeItem(SESSION_KEY); } catch (e) { /* private mode */ } };
  const fromToken = t => ({
    access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: t.expires_at ? t.expires_at * 1000 : now() + (+t.expires_in || 3600) * 1000,
    user: t.user || null,
  });

  async function call(path, { method = 'GET', body, headers = {}, auth = true, raw = false } = {}) {
    if (auth) await fresh();
    const h = { apikey: anonKey, Authorization: `Bearer ${auth && session ? session.access_token : anonKey}`, ...headers };
    if (body !== undefined && !(body instanceof Blob) && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const res = await f(base + path, { method, headers: h, body: body === undefined || body instanceof Blob ? body : JSON.stringify(body) });
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `HTTP ${res.status}`;
      if (res.status === 401 && auth && session) keep(null);
      throw new CloudError(String(msg), res.status, data && data.code);
    }
    return data;
  }

  /** Refresh the access token shortly before it expires. */
  async function fresh() {
    if (!session || session.expires_at - now() > 60000) return;
    try {
      const t = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false });
      keep({ ...fromToken(t), user: t.user || session.user });
    } catch (e) { keep(null); }
  }

  const auth = {
    get session() { return session; },
    get user() { return session && session.user; },
    /** Email a sign-in link that comes back to redirectTo. */
    sendLink: (email, redirectTo) => call(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email, create_user: true }, auth: false }),
    /** Where to send the browser for Google sign-in. */
    googleURL: redirectTo => `${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`,
    /**
     * Finish a sign-in from the URL fragment Supabase redirects back with (#access_token=...).
     * Returns true when a session was found (the caller should then clean the URL).
     */
    async fromRedirect(hash) {
      const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
      if (q.get('error_description')) throw new CloudError(q.get('error_description'), 400, q.get('error'));
      if (!q.get('access_token')) return false;
      keep(fromToken(Object.fromEntries(q)));
      const user = await call('/auth/v1/user');
      keep({ ...session, user });
      return true;
    },
    async signOut() {
      try { if (session) await call('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* already gone */ }
      keep(null);
    },
  };

  /** PostgREST: table rows. query is the URL query string (select=..., filters, order, limit). */
  const db = {
    select: (table, query = 'select=*') => call(`/rest/v1/${table}?${query}`),
    insert: (table, row) => call(`/rest/v1/${table}`, { method: 'POST', body: row, headers: { Prefer: 'return=representation' } }).then(r => r[0]),
    update: (table, filter, patch) => call(`/rest/v1/${table}?${filter}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' } }).then(r => r[0]),
    remove: (table, filter) => call(`/rest/v1/${table}?${filter}`, { method: 'DELETE' }),
    rpc: (fn, args) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args }),
  };

  const files = {
    /** Upload (or replace) a file in a bucket; returns its public URL. */
    async upload(bucket, path, blob) {
      await call(`/storage/v1/object/${bucket}/${path}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'true' } });
      return `${base}/storage/v1/object/public/${bucket}/${path}`;
    },
    publicURL: (bucket, path) => `${base}/storage/v1/object/public/${bucket}/${path}`,
  };

  return { auth, db, files };
}

function safeStorage() {
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch (e) { /* blocked */ }
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
}
