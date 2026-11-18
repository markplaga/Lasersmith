// Accounts and the shared library in the page (PRD M4): sign in, save, share, fork, browse the
// community library, open shared links (?d=<id>), import this browser's designs, download your data.
// Everything here is hidden when no store is configured (the artifact, or a site without Supabase).

import { byId } from '../library.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VIS = [
  { value: 'private', label: 'Private' },
  { value: 'unlisted', label: 'Anyone with the link' },
  { value: 'public', label: 'Public, in the community library' },
];

/**
 * @param host {store, $, entryOf(id), current() -> entry, params() -> current params, hasErrors(),
 *   material(), snapshot() -> dataURL|null, select(id), library() (re-render), toast(msg), saveFile(name, text, type),
 *   mine() -> local designs, setParams(id, params), location}
 */
export function mountAccount(host) {
  const { store, $ } = host;
  const entries = new Map(); // 'cloud-<uuid>' -> library entry
  let community = [], mineRows = [], q = '';

  /** A library entry for a cloud design row (list rows have no code or params until opened). */
  function entryFor(r, category) {
    const id = 'cloud-' + r.id;
    const old = entries.get(id);
    const tags = ['shared', ...(r.tags || [])];
    let e;
    if (r.generator) {
      const base = byId(r.generator);
      if (!base) return null;
      e = { ...base, id, baseId: base.id, title: r.title, description: r.description || base.description, category, tags };
    } else {
      e = { id, title: r.title, description: r.description || '', category, source: 'claude', origin: 'cloud', tags, code: old && old.code, params: (old && old.params) || r.schema || [], chat: [], versions: [] };
    }
    e.cloud = { ...(old && old.cloud), ...r };
    e.loaded = old ? old.loaded : false;
    entries.set(id, e);
    return e;
  }

  async function refresh() {
    try {
      const [m, c] = await Promise.all([store.listMine(), store.listPublic(q)]);
      mineRows = m; community = c;
      const ids = new Set();
      for (const r of mineRows) { const e = entryFor(r, 'Saved to your account'); if (e) ids.add(e.id); }
      for (const r of community) if (!store.user || r.owner !== store.user.id) { const e = entryFor(r, 'Community'); if (e) ids.add(e.id); }
      for (const id of [...entries.keys()]) if (!ids.has(id) && id !== host.currentId()) entries.delete(id);
    } catch (err) { host.toast('Could not reach the shared library: ' + err.message); }
    host.library();
  }

  /** Fetch an opened cloud design's generator and saved parameters (once). */
  async function load(e) {
    if (!e.cloud || e.loaded) return;
    const r = await store.get(e.cloud.id);
    if (!r) throw new Error('That design is private or was deleted');
    e.cloud = { ...e.cloud, ...r, author: r.author || e.cloud.author };
    if (r.code) { e.code = r.code; e.params = r.schema || []; }
    host.setParams(e.id, r.params || {});
    e.loaded = true;
  }

  const own = e => e.cloud && store.user && e.cloud.owner === store.user.id;
  const link = e => `${host.location.origin}${host.location.pathname}?d=${e.cloud.id}`;

  /** Save the current design: update your own cloud design, or create a new one. */
  async function save(e, asCopy) {
    const p = host.params();
    const d = {
      title: e.title, description: (e.description || '').slice(0, 4000), tags: (e.tags || []).filter(x => !['shared', 'yours', 'claude', 'file', 'cloud'].includes(x)).slice(0, 12),
      params: p, material: host.material(), checked: !host.hasErrors(),
    };
    if (e.source === 'claude') { d.code = e.code; d.schema = e.params || []; } else d.generator = e.baseId || e.id;
    if (e.cloud && asCopy) d.fork_of = e.cloud.id;
    if (asCopy && e.cloud) d.title = /\(fork\)$/.test(e.title) ? e.title : `${e.title} (fork)`;
    const r = own(e) && !asCopy ? await store.save({ ...d, id: e.cloud.id }) : await store.save(d);
    await thumb(r.id);
    const ne = entryFor({ ...r, author: store.user.name }, 'Saved to your account');
    ne.loaded = true;
    if (ne.source === 'claude') { ne.code = d.code; ne.params = d.schema; }
    host.setParams(ne.id, p);
    await refresh();
    host.select(ne.id);
    return r;
  }
  async function thumb(id) {
    try {
      const url = host.snapshot();
      if (!url) return;
      const blob = await (await fetch(url)).blob();
      await store.uploadThumb(id, blob);
    } catch (err) { /* a thumbnail is a nice-to-have */ }
  }

  /** The Save / Share / Fork row under the design's title. */
  function tools(e) {
    const el = $('#cloudTools');
    el.hidden = false;
    if (!store.user) {
      el.innerHTML = `<p class="muted cloud-note">${e.cloud ? `Shared by ${esc(e.cloud.author || 'someone')}. ` : ''}<button class="linkbtn" data-ct="signin">Sign in</button> to save designs to your account and share them.</p>`;
    } else if (own(e)) {
      const v = e.cloud.visibility || 'private';
      el.innerHTML = `<div class="cloud-row"><button class="btn" data-ct="save">Save changes</button>
        <select data-ct="vis" aria-label="Who can see it">${VIS.map(o => `<option value="${o.value}" ${o.value === v ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
        ${v !== 'private' ? '<button class="btn ghost" data-ct="link">Copy link</button>' : ''}
        <button class="btn ghost" data-ct="del">Delete</button></div>
        <p class="muted cloud-note">${e.cloud.fork_of ? 'A copy of another design. ' : ''}Version ${e.cloud.version || 1}${v !== 'private' ? ', shared' : ''}.</p>`;
    } else if (e.cloud) {
      el.innerHTML = `<div class="cloud-row"><button class="btn" data-ct="fork">Save a copy</button><button class="btn ghost" data-ct="link">Copy link</button><button class="btn ghost" data-ct="report">Report</button></div>
        <p class="muted cloud-note">Shared by ${esc(e.cloud.author || 'someone')}. Your copy keeps a link back to it.</p>`;
    } else {
      el.innerHTML = `<div class="cloud-row"><button class="btn ghost" data-ct="save">Save to my account</button></div>`;
    }
    el.querySelectorAll('[data-ct]').forEach(b => b.addEventListener(b.tagName === 'SELECT' ? 'change' : 'click', () => act(b.dataset.ct, e, b)));
  }

  async function act(a, e, b) {
    try {
      if (a === 'signin') return openPop();
      if (a === 'save') { b.disabled = true; await save(e, false); host.toast(host.hasErrors() ? 'Saved. Fix the errors under Checks before sharing it.' : 'Saved to your account'); }
      if (a === 'fork') { b.disabled = true; await save(e, true); host.toast('Saved a copy to your account'); }
      if (a === 'vis') {
        const r = await store.setVisibility(e.cloud.id, b.value);
        e.cloud = { ...e.cloud, ...r };
        await refresh();
        tools(host.current());
        host.toast(b.value === 'private' ? 'Only you can see it now' : b.value === 'public' ? 'Shared in the community library' : 'Anyone with the link can open it');
      }
      if (a === 'link') { await copy(link(e)); host.toast('Link copied'); }
      if (a === 'del') {
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to delete'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; } }, 4000); return; }
        await store.remove(e.cloud.id);
        entries.delete(e.id);
        await refresh();
        host.select(e.baseId || 'finger-box');
        host.toast('Deleted from your account');
      }
      if (a === 'report') {
        const reason = prompt2(b);
        if (reason) { await store.report(e.cloud.id, reason); host.toast('Thanks. The report was sent.'); }
      }
    } catch (err) {
      host.toast(err.message);
      if (b) b.disabled = false;
      if (a === 'vis') tools(host.current());
    }
  }
  // Inline reason box instead of a browser dialog.
  function prompt2(b) {
    const row = b.closest('.cloud-row');
    if (row.querySelector('.report-box')) {
      const v = row.querySelector('.report-box input').value.trim();
      row.querySelector('.report-box').remove();
      return v;
    }
    row.insertAdjacentHTML('beforeend', '<span class="report-box"><input type="text" maxlength="500" placeholder="What is wrong with it?" aria-label="Reason"> <small class="muted">then press Report again</small></span>');
    row.querySelector('.report-box input').focus();
    return '';
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (x) { /* ignore */ } t.remove(); }
  }

  /* ----- header button and sign-in popover ----- */
  const btn = $('#acctBtn'), pop = $('#acctPop');
  btn.hidden = false;
  function renderBtn() { btn.textContent = store.user ? store.user.name || 'Account' : 'Sign in'; }
  function openPop() {
    const back = host.location.origin + host.location.pathname;
    if (!store.user) {
      pop.innerHTML = `<h3>Sign in</h3><p class="muted">Save designs to your account and share them. Everything else works without an account.</p>
        <form id="acctForm"><input type="email" id="acctEmail" required placeholder="you@example.com" aria-label="Email" autocomplete="email"><button class="btn" type="submit">Email me a link</button></form>
        ${store.kind === 'supabase' ? `<a class="btn ghost" href="${esc(store.googleURL(back))}">Continue with Google</a>` : ''}
        <p class="muted" id="acctMsg"></p>`;
      pop.querySelector('#acctForm').addEventListener('submit', async ev => {
        ev.preventDefault();
        const email = pop.querySelector('#acctEmail').value.trim();
        try {
          await store.sendLink(email, back);
          if (store.user) { closePop(); signedIn(); } else pop.querySelector('#acctMsg').textContent = `Check ${email} for a sign-in link.`;
        } catch (err) { pop.querySelector('#acctMsg').textContent = err.message; }
      });
    } else {
      const local = host.mine().length;
      pop.innerHTML = `<h3>${esc(store.user.name)}</h3><p class="muted">${esc(store.user.email || '')}</p>
        ${local ? `<button class="btn ghost" id="acctImport">Save my ${local} design${local === 1 ? '' : 's'} from this browser to my account</button>` : ''}
        <button class="btn ghost" id="acctExport">Download all my data</button>
        <button class="btn ghost" id="acctOut">Sign out</button>`;
      pop.querySelector('#acctOut').addEventListener('click', async () => { await store.signOut(); closePop(); renderBtn(); await refresh(); host.select(host.currentId()); });
      pop.querySelector('#acctExport').addEventListener('click', async () => {
        try { host.saveFile('lasersmith-my-data.json', JSON.stringify(await store.exportAll(), null, 2), 'application/json'); } catch (err) { host.toast(err.message); }
      });
      const imp = pop.querySelector('#acctImport');
      if (imp) imp.addEventListener('click', async () => {
        imp.disabled = true;
        let n = 0;
        for (const e of host.mine()) {
          try { await store.save({ title: e.title, description: e.description || '', tags: [], code: e.code, schema: e.params || [], params: host.paramsOf(e.id), checked: false }); n++; } catch (err) { host.toast(err.message); break; }
        }
        closePop();
        await refresh();
        host.toast(`Saved ${n} design${n === 1 ? '' : 's'} to your account (private). Open each and save it again to check it before sharing.`);
      });
    }
    pop.hidden = false;
    const f = pop.querySelector('input, button, a');
    if (f) f.focus();
  }
  function closePop() { pop.hidden = true; }
  btn.addEventListener('click', () => (pop.hidden ? openPop() : closePop()));
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !pop.hidden) closePop(); });
  document.addEventListener('click', ev => { if (!pop.hidden && !pop.contains(ev.target) && ev.target !== btn && !(ev.target.dataset && ev.target.dataset.ct === 'signin')) closePop(); });

  async function signedIn() { renderBtn(); await refresh(); host.select(host.currentId()); host.toast('Signed in as ' + store.user.name); }

  return {
    entries: () => [...entries.values()],
    has: id => entries.has(id),
    get: id => entries.get(id),
    load,
    tools,
    search(text) { q = text; clearTimeout(this._t); this._t = setTimeout(refresh, 300); },
    /** Finish a sign-in redirect, load the lists, open ?d=<id>. Returns the id to select, if any. */
    async boot() {
      renderBtn();
      try {
        if (await store.fromRedirect(host.location.hash)) { history.replaceState(null, '', host.location.pathname + host.location.search); host.toast('Signed in as ' + store.user.name); renderBtn(); }
      } catch (err) { host.toast('Sign-in failed: ' + err.message); }
      await refresh();
      const d = new URLSearchParams(host.location.search).get('d');
      if (!d) return null;
      try {
        const r = await store.get(d);
        if (!r) { host.toast('That design is private or was deleted'); return null; }
        const e = entryFor(r, store.user && r.owner === store.user.id ? 'Saved to your account' : 'Community');
        e.loaded = false;
        return e ? e.id : null;
      } catch (err) { host.toast('Could not open the shared design: ' + err.message); return null; }
    },
  };
}
