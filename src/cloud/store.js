// The shared library (PRD 5.2, 5.3, 11): save, share, fork and browse designs. Works over the Supabase
// client in supabase.js; createMemoryStore gives the same API in memory for tests.

const LIST = 'id,owner,title,description,tags,generator,visibility,checked,fork_of,thumbnail,version,updated_at,author:profiles(name)';
const ilike = q => String(q).replace(/[%*,()."\\]/g, ' ').trim();

/** Turn a database row into a plain design record. */
const rec = r => (r ? { ...r, author: r.author ? r.author.name : r.author_name || '' } : null);

export function createStore(sb) {
  const uid = () => sb.auth.user && sb.auth.user.id;
  const need = () => { if (!uid()) throw new Error('Sign in first'); };
  const store = {
    kind: 'supabase',
    get user() {
      const u = sb.auth.user;
      return u ? { id: u.id, email: u.email, name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || (u.email || '').split('@')[0] } : null;
    },
    sendLink: (email, back) => sb.auth.sendLink(email, back),
    googleURL: back => sb.auth.googleURL(back),
    fromRedirect: hash => sb.auth.fromRedirect(hash),
    signOut: () => sb.auth.signOut(),

    async listMine() {
      if (!uid()) return [];
      return (await sb.db.select('designs', `select=${LIST}&owner=eq.${uid()}&order=updated_at.desc`)).map(rec);
    },
    async listPublic(q = '', limit = 60) {
      const s = ilike(q);
      const f = s ? `&or=(title.ilike.*${encodeURIComponent(s)}*,description.ilike.*${encodeURIComponent(s)}*)` : '';
      return (await sb.db.select('designs', `select=${LIST}&visibility=eq.public${f}&order=updated_at.desc&limit=${limit}`)).map(rec);
    },
    /** One design with its generator and params (public, unlisted or own). */
    async get(id) {
      const rows = await sb.db.rpc('get_design', { design_id: id });
      const r = rows && rows[0];
      if (!r) return null;
      let author = '';
      try { const p = await sb.db.select('profiles', `select=name&id=eq.${r.owner}`); author = p[0] ? p[0].name : ''; } catch (e) { /* no name */ }
      return { ...r, author };
    },
    /** Create (no id) or update one of the user's designs. */
    async save(d) {
      need();
      const row = pick(d, ['title', 'description', 'tags', 'generator', 'code', 'schema', 'params', 'material', 'checked', 'fork_of']);
      if (!d.checked && d.visibility && d.visibility !== 'private') row.visibility = 'private';
      if (d.id) return rec(await sb.db.update('designs', `id=eq.${d.id}`, row));
      return rec(await sb.db.insert('designs', { ...row, visibility: 'private' }));
    },
    /** Share or unshare. Sharing records the current state as an immutable version. */
    async setVisibility(id, visibility) {
      need();
      const cur = (await sb.db.select('designs', `select=*&id=eq.${id}`))[0];
      if (!cur) throw new Error('Design not found');
      if (visibility !== 'private') {
        if (!cur.checked) throw new Error('Fix the errors under Checks before sharing');
        try { await sb.db.insert('design_versions', { design: id, version: cur.version, title: cur.title, code: cur.code, schema: cur.schema, params: cur.params }); } catch (e) { if (e.status !== 409) throw e; }
        return rec(await sb.db.update('designs', `id=eq.${id}`, { visibility, version: cur.version + 1 }));
      }
      return rec(await sb.db.update('designs', `id=eq.${id}`, { visibility }));
    },
    /** A private copy of someone's (or your own) design, keeping attribution. */
    async fork(d) {
      need();
      const full = d.params ? d : await store.get(d.id);
      return store.save({ ...full, id: undefined, title: forkTitle(full.title), fork_of: full.id, checked: !!full.checked });
    },
    async remove(id) { need(); await sb.db.remove('designs', `id=eq.${id}`); },
    async report(id, reason) { need(); await sb.db.insert('reports', { design: id, reason }); },
    async uploadThumb(id, blob) {
      need();
      const path = `${uid()}/${id}.png`;
      const url = await sb.files.upload('thumbnails', path, blob);
      await sb.db.update('designs', `id=eq.${id}`, { thumbnail: path });
      return url;
    },
    thumbURL: path => (path ? sb.files.publicURL('thumbnails', path) : ''),
    /** Everything the user has, for the "download my data" button (section 11). */
    async exportAll() {
      need();
      const [designs, profile] = await Promise.all([sb.db.select('designs', `select=*&owner=eq.${uid()}`), sb.db.select('profiles', `select=*&id=eq.${uid()}`)]);
      return { exported: new Date().toISOString(), profile: profile[0] || null, designs };
    },
    async saveMachine(machine) { need(); await sb.db.update('profiles', `id=eq.${uid()}`, { machine }); },
  };
  return store;
}

const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const forkTitle = t => (/\(fork\)$/.test(t) ? t : `${t} (fork)`).slice(0, 120);

/**
 * The same API in memory, for tests and for trying the flow without a backend. Rules mirror the
 * database: only the owner sees private designs, unlisted ones are found only by id, sharing needs
 * a checked design.
 */
export function createMemoryStore({ user = null, designs = [] } = {}) {
  let me = user, n = 0;
  const rows = designs.map(d => ({ ...d }));
  const visible = r => r.visibility !== 'private' || (me && r.owner === me.id);
  const out = r => ({ ...r, author: r.author_name || '' });
  const need = () => { if (!me) throw new Error('Sign in first'); };
  const store = {
    kind: 'memory',
    get user() { return me; },
    async sendLink(email) { me = { id: 'u-' + email, email, name: email.split('@')[0] }; },
    googleURL: () => '#',
    async fromRedirect() { return false; },
    async signOut() { me = null; },
    signInAs(u) { me = u; },
    async listMine() { return me ? rows.filter(r => r.owner === me.id).map(out) : []; },
    async listPublic(q = '') {
      const s = q.toLowerCase();
      return rows.filter(r => r.visibility === 'public' && (!s || (r.title + ' ' + r.description).toLowerCase().includes(s))).map(out);
    },
    async get(id) { const r = rows.find(x => x.id === id); return r && visible(r) ? out(r) : null; },
    async save(d) {
      need();
      if (d.id) {
        const r = rows.find(x => x.id === d.id);
        if (!r || r.owner !== me.id) throw new Error('Not yours');
        Object.assign(r, pick(d, ['title', 'description', 'tags', 'generator', 'code', 'schema', 'params', 'material', 'checked']), { updated_at: new Date().toISOString() });
        if (!r.checked) r.visibility = 'private';
        return out(r);
      }
      const r = { tags: [], description: '', params: {}, ...pick(d, ['title', 'description', 'tags', 'generator', 'code', 'schema', 'params', 'material', 'checked', 'fork_of']), id: `d${++n}-${Date.now().toString(36)}`, owner: me.id, author_name: me.name, visibility: 'private', version: 1, updated_at: new Date().toISOString() };
      rows.push(r);
      return out(r);
    },
    async setVisibility(id, visibility) {
      need();
      const r = rows.find(x => x.id === id && x.owner === me.id);
      if (!r) throw new Error('Design not found');
      if (visibility !== 'private' && !r.checked) throw new Error('Fix the errors under Checks before sharing');
      r.visibility = visibility;
      if (visibility !== 'private') r.version++;
      return out(r);
    },
    async fork(d) { need(); const full = await store.get(d.id); return store.save({ ...full, id: undefined, title: forkTitle(full.title), fork_of: full.id }); },
    async remove(id) { need(); const i = rows.findIndex(x => x.id === id && x.owner === me.id); if (i >= 0) rows.splice(i, 1); },
    async report() { need(); },
    async uploadThumb() { return ''; },
    thumbURL: () => '',
    async exportAll() { need(); return { exported: new Date().toISOString(), profile: me, designs: rows.filter(r => r.owner === me.id) }; },
    async saveMachine() {},
    _rows: rows,
  };
  return store;
}
