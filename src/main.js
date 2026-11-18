// Lasersmith app shell: library -> parameters -> Design document -> validation, nesting, preview, export.
import { LIBRARY, byId, MATERIALS, MACHINE, STOCK, sheetSize } from './library.js';
import { renderParams, defaults, fmtLen } from './ui/params.js';
import { createPreview } from './ui/preview3d.js';
import { validate, hasErrors } from './geom/validate.js';
import { nest } from './geom/nest.js';
import { sheetSVG, sheetDXF, sheetLBRN2, exportBundle, slug } from './export/formats.js';
import { createBoxesClient } from './boxespy/client.js';
import { boxesToDesign } from './boxespy/adapter.js';
import { createSandbox } from './claude/sandbox.js';
import { loadMine, saveMine, newEntry, generatorFile, codeFromFile } from './mine.js';
import { mountClaudePanel } from './ui/claudepanel.js';
import { mountVoxelEditor } from './ui/voxeleditor.js';
import { gridFor } from './generators/voxel.js';
import { mountAssemblyPanel } from './ui/assemblypanel.js';
import { spotOn, fitSpot } from './generators/assembly.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CFG = window.LASERSMITH_CONFIG || {};
const STORE = 'lasersmith-v1';

/* ---------- state ---------- */
const S = {
  entry: 'finger-box',
  params: {},          // per entry id
  material: { ...MATERIALS[0] },
  machine: { ...MACHINE },
  units: 'mm',
  view: '3d',
  explode: 0,
  stereo: 'off',
  stereoDeg: 3.5,
  sheet: 0,
  q: '',
};
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved) Object.assign(S, saved, { material: { ...S.material, ...saved.material }, machine: { ...S.machine, ...saved.machine } });
} catch (e) { /* storage unavailable: run with defaults */ }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ } };

let design = null, nested = null, issues = [], schema = [], busy = 0;
const openGroups = new Set();

/* ---------- boxes.py ---------- */
const workerSrc = document.getElementById('ls-worker')?.textContent || '';
const zipEl = document.getElementById('ls-boxes-zip');
const boxes = createBoxesClient({
  workerSource: workerSrc,
  zipBase64: zipEl ? zipEl.textContent.trim() : null,
  zipURL: CFG.boxesZip || 'boxespy.zip',
  indexURL: CFG.pyodideIndex,
  onProgress: msg => setStatus(msg + '…', true),
});

/* ---------- your designs (Claude-made or opened from a file) ---------- */
let mine = loadMine();
const entryOf = id => mine.find(e => e.id === id) || byId(id);
const sandbox = createSandbox(document.getElementById('ls-genworker')?.textContent || '');
const matNow = () => ({ name: S.material.name, thickness: +S.material.thickness, kerf: +S.material.kerf });
const rules = () => { const z = sheetSize(S.machine); return { bedW: z.w, bedH: z.h, margin: +S.machine.margin, sheetName: z.label, rotate: S.machine.grain !== 'x' }; };

/* ---------- 3D ---------- */
const preview = createPreview($('#view'));

/* ---------- library ---------- */
function renderLibrary() {
  const q = S.q.trim().toLowerCase();
  const cats = new Map();
  for (const e of [...mine, ...LIBRARY]) {
    const hay = (e.title + ' ' + e.category + ' ' + (e.tags || []).join(' ') + ' ' + (e.cls || '')).toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (!cats.has(e.category)) cats.set(e.category, []);
    cats.get(e.category).push(e);
  }
  let html = '';
  for (const [c, list] of cats) {
    html += `<li class="cat">${esc(c)}</li>`;
    for (const e of list) {
      html += `<li><button class="lib-item${e.id === S.entry ? ' on' : ''}" data-id="${e.id}" aria-pressed="${e.id === S.entry}"><b>${esc(e.title)}</b>${badge(e)}</button></li>`;
    }
  }
  $('#lib').innerHTML = html || '<li class="empty">Nothing matches.</li>';
  $('#lib').querySelectorAll('.lib-item').forEach(b => b.addEventListener('click', () => select(b.dataset.id)));
}

function badge(e) {
  if (e.source === 'native') return '<span class="src src-native">Native 3D</span>';
  if (e.source === 'claude') return `<span class="src src-mine">${e.origin === 'file' ? 'Opened' : 'Claude'}</span>`;
  return '<span class="src src-py">boxes.py</span>';
}

async function select(id) {
  S.entry = id;
  S.sheet = 0;
  save();
  renderLibrary();
  const e = entryOf(id);
  $('#dtitle').textContent = e.title;
  $('#ddesc').textContent = e.description || '';
  $('#pyNote').hidden = e.source !== 'boxes.py';
  renderMineTools(e);
  panel.refresh();
  $('#voxelCard').hidden = id !== 'voxel-sculpture';
  $('#asmCard').hidden = id !== 'assembly';
  stopPick();
  if (e.source === 'claude') {
    schema = e.params || [];
    mountParams();
    regenerate(true);
  } else if (e.source === 'native') {
    schema = e.gen.params;
    mountParams();
    if (id === 'voxel-sculpture') voxEd.load();
    if (id === 'assembly') asmPanel.load();
    regenerate(true);
  } else {
    schema = [];
    $('#params').innerHTML = '<p class="muted">Loading parameters from boxes.py…</p>';
    try {
      const s = await boxes.schema(e);
      if (S.entry !== id) return;
      schema = s.params;
      e.description = s.description ? s.doc + '\n\n' + s.description : s.doc;
      $('#ddesc').textContent = (s.doc || '').split('\n')[0];
      mountParams(s.params[0] && s.params[0].group);
      regenerate(true);
    } catch (err) {
      $('#params').innerHTML = `<p class="err">Could not start boxes.py: ${esc(err.message)}</p><p class="muted">boxes.py designs need a network connection the first time (Pyodide, about 10 MB). Native designs work offline.</p>`;
      setStatus('boxes.py unavailable', false);
    }
  }
}

function currentParams() {
  const d = defaults(schema);
  const saved = S.params[S.entry] || {};
  const out = { ...d };
  for (const k in saved) if (k in d) out[k] = saved[k];
  return out;
}

function mountParams(primaryGroup) {
  renderParams($('#params'), schema, currentParams(), (k, v) => {
    S.params[S.entry] = { ...(S.params[S.entry] || {}), [k]: v };
    save();
    regenerate();
  }, { units: S.units, openGroups, primaryGroup });
}

/* ---------- generate ---------- */
let timer = 0, gen = 0;
function regenerate(now) {
  clearTimeout(timer);
  timer = setTimeout(run, now ? 0 : 90);
}
async function run() {
  const my = ++gen;
  const e = entryOf(S.entry);
  const params = currentParams();
  const material = matNow();
  try {
    let d;
    if (e.source === 'claude') {
      setStatus('Running generator…', true);
      d = (await sandbox.run(e.code, params, material)).design;
    } else if (e.source === 'native') d = e.gen.generate(params, material);
    else {
      setStatus('Rendering with boxes.py…', true);
      // send only values that differ from boxes.py defaults
      const dflt = defaults(schema), args = {};
      for (const k in params) if (params[k] !== dflt[k]) args[k] = params[k];
      const res = await boxes.run(e, args, material);
      if (my !== gen) return;
      d = boxesToDesign(res, { entry: e, params, material });
    }
    if (my !== gen) return;
    design = d;
    issues = validate(design, rules());
    const z = sheetSize(S.machine);
    nested = nest(design, { sheetW: z.w, sheetH: z.h, margin: +S.machine.margin, gap: +S.machine.gap, rotate: S.machine.grain !== 'x' });
    if (S.sheet >= nested.sheets.length) S.sheet = 0;
    render();
    setStatus('', false);
  } catch (err) {
    console.error(err);
    if (my !== gen) return;
    issues = [{ level: 'error', code: 'generator', msg: 'Generator failed: ' + err.message }];
    renderIssues();
    setStatus('Generator failed', false);
  }
}

/* ---------- render ---------- */
function render() {
  preview.show(design, nested, { mode: S.view, material: S.material });
  preview.setExplode(S.explode);
  const hasPlace = design.parts.some(p => p.place);
  $('#viewSeg').hidden = !hasPlace;
  $('#explodeWrap').hidden = !hasPlace || S.view === 'flat';
  $('#badge').innerHTML = `<b>${esc(design.title)}</b>${design.parts.reduce((a, p) => a + p.qty, 0)} parts · ${nested.sheets.length} sheet${nested.sheets.length === 1 ? '' : 's'}`;
  renderSheets();
  renderIssues();
  renderStats();
  if (S.entry === 'assembly') asmPanel.refresh();
}

function renderSheets() {
  const tabs = nested.sheets.map((s, i) => `<button class="${i === S.sheet ? 'on' : ''}" data-i="${i}">Sheet ${i + 1}${s.oversize ? ' (oversize)' : ''}</button>`).join('');
  $('#sheetTabs').innerHTML = nested.sheets.length > 1 ? tabs : '';
  $('#sheetTabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { S.sheet = +b.dataset.i; renderSheets(); }));
  const sh = nested.sheets[S.sheet];
  $('#sheet').innerHTML = sh ? sheetSVG(sh, design, { preview: true }) : '';
  if (sh) {
    const used = sh.items.reduce((a, it) => a + it.w * it.h, 0) / (sh.w * sh.h);
    const u = S.units === 'in' ? `${fmtLen(sh.w, 'in')}" x ${fmtLen(sh.h, 'in')}"` : `${fmtLen(sh.w, 'mm')} x ${fmtLen(sh.h, 'mm')} mm`;
    $('#sheetInfo').textContent = `${sh.items.length} parts on ${u}, ${(used * 100).toFixed(0)}% of the sheet by bounding box.`;
  }
}

function renderIssues() {
  const errs = issues.filter(i => i.level === 'error'), warns = issues.filter(i => i.level === 'warn'), infos = issues.filter(i => i.level === 'info');
  const word = { error: 'Error', warn: 'Warning', info: 'Note' };
  const li = i => `<li class="${i.level}"><b>${word[i.level] || 'Note'}</b>${i.part ? ` <em>${esc(i.part)}</em>` : ''} ${esc(i.msg)}</li>`;
  const ok = '<li class="ok"><b>Ready to cut</b> Outlines closed, parts fit the bed, no thin bridges' + (design && design.parts.some(p => p.place) ? ', no 3D overlaps.' : '.') + '</li>';
  $('#issues').innerHTML = (errs.length || warns.length ? '' : ok) + errs.concat(warns, infos).map(li).join('');
  const blocked = hasErrors(issues);
  document.querySelectorAll('[data-export]').forEach(b => { b.disabled = blocked || !design; });
  $('#exportNote').textContent = blocked ? 'Fix the errors above to export.' : '';
}

function renderStats() {
  const t = design.material.thickness;
  let cut = 0;
  for (const p of design.parts) {
    const L = l => l.reduce((a, q, i) => a + Math.hypot(l[(i + 1) % l.length][0] - q[0], l[(i + 1) % l.length][1] - q[1]), 0);
    cut += p.qty * (L(p.outline) + p.holes.reduce((a, h) => a + L(h), 0) + p.circles.reduce((a, c) => a + 2 * Math.PI * c.r, 0));
  }
  const dims = design.view && design.view.bounds;
  const u = S.units;
  const stats = [
    ['Material', `${S.material.name}`],
    ['Thickness / kerf', `${fmtLen(t, u)} / ${design.material.kerf} ${u === 'in' ? 'in / mm' : 'mm'}`],
    ['Parts', design.parts.reduce((a, p) => a + p.qty, 0)],
    ['Cut length', u === 'in' ? `${(cut / 25.4 / 12).toFixed(1)} ft` : `${(cut / 1000).toFixed(2)} m`],
  ];
  if (dims) stats.splice(1, 0, ['Outside size', dims.map(v => fmtLen(v, u)).join(' x ') + ' ' + u]);
  $('#stats').innerHTML = stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}

let statusTimer = 0;
function setStatus(msg, spin) {
  clearTimeout(statusTimer);
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('spin', !!spin);
  el.hidden = !msg;
}

/* ---------- export ---------- */
let dl = null;
(async () => { try { if (window.claude && window.claude.use) dl = await window.claude.use('downloads'); } catch (e) { /* not in Claude */ } })();
async function saveFile(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (dl) { try { await dl.save({ filename: name, data: blob }); toast('Saved ' + name); return; } catch (e) { if (e && e.code === 'declined') { toast('Download cancelled'); return; } } }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Downloading ' + name);
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2600);
}
document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => {
  if (!design || hasErrors(issues)) return;
  const kind = b.dataset.export, sh = nested.sheets[S.sheet];
  const base = slug(design.title) + (nested.sheets.length > 1 ? '-sheet' + (S.sheet + 1) : '');
  if (kind === 'svg') saveFile(base + '.svg', sheetSVG(sh, design), 'image/svg+xml');
  if (kind === 'dxf') saveFile(base + '.dxf', sheetDXF(sh, design), 'application/dxf');
  if (kind === 'lbrn2') saveFile(base + '.lbrn2', sheetLBRN2(sh, design), 'application/xml');
  const e = entryOf(S.entry);
  const extra = e.source === 'claude' ? [{ name: slug(e.title) + '.generator.js', data: generatorFile(e) }] : [];
  if (kind === 'zip') saveFile(slug(design.title) + '.zip', new Blob([exportBundle(nested, design, { extra, image: guideImage() })], { type: 'application/zip' }));
}));

/** A picture of the assembled design for the assembly guide (normal view, whatever the stereo setting). */
function guideImage() {
  if (!design.parts.some(p => p.place) || S.view === 'flat') return null;
  try {
    if (S.stereo === 'off') return preview.snapshot();
    preview.setStereo('off', S.stereoDeg); preview.show(design, nested, { mode: S.view, material: S.material, reframe: true });
    preview.renderNow();
    const img = preview.snapshot();
    applyStereo(); render();
    return img;
  } catch (e) { return null; }
}

/* ---------- material + machine ---------- */
function mountMaterial() {
  $('#matSel').innerHTML = MATERIALS.map(m => `<option value="${m.id}" ${m.id === S.material.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('') + `<option value="custom" ${!MATERIALS.some(m => m.id === S.material.id) ? 'selected' : ''}>Custom</option>`;
  $('#thick').value = fmtLen(S.material.thickness, S.units);
  $('#kerf').value = S.material.kerf;
  $('#bedW').value = fmtLen(S.machine.bedW, S.units);
  $('#bedH').value = fmtLen(S.machine.bedH, S.units);
  $('#margin').value = fmtLen(S.machine.margin, S.units);
  $('#stockSel').innerHTML = STOCK.map(s => `<option value="${s.id}" ${s.id === (S.machine.stock || 'bed') ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
  $('#stockCustom').hidden = S.machine.stock !== 'custom';
  $('#stockW').value = fmtLen(S.machine.stockW, S.units);
  $('#stockH').value = fmtLen(S.machine.stockH, S.units);
  $('#grainSel').value = S.machine.grain || 'free';
  document.querySelectorAll('.u').forEach(el => { el.textContent = S.units; });
  document.querySelectorAll('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.u === S.units));
}
const toMM = v => (S.units === 'in' ? v * 25.4 : v);
$('#matSel').addEventListener('change', e => {
  const m = MATERIALS.find(x => x.id === e.target.value);
  S.material = m ? { ...m } : { ...S.material, id: 'custom', name: `Custom ${S.material.thickness} mm` };
  save(); mountMaterial(); regenerate();
});
$('#thick').addEventListener('input', e => {
  const v = toMM(parseFloat(e.target.value));
  if (!(v > 0.3 && v < 30)) return;
  S.material = { ...S.material, thickness: +v.toFixed(3), id: 'custom', name: `Custom ${+v.toFixed(2)} mm` };
  $('#matSel').value = 'custom'; save(); regenerate();
});
$('#kerf').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (!(v >= 0 && v < 1)) return;
  S.material = { ...S.material, kerf: v };
  save(); regenerate();
});
$('#stockSel').addEventListener('change', e => { S.machine.stock = e.target.value; S.sheet = 0; save(); mountMaterial(); regenerate(); });
$('#grainSel').addEventListener('change', e => { S.machine.grain = e.target.value; save(); regenerate(); });
for (const k of ['bedW', 'bedH', 'margin', 'stockW', 'stockH']) {
  $('#' + k).addEventListener('input', e => {
    const v = toMM(parseFloat(e.target.value));
    if (!(v >= 0)) return;
    S.machine[k] = v; save(); regenerate();
  });
}
$('#bedSwap').addEventListener('click', () => { [S.machine.bedW, S.machine.bedH] = [S.machine.bedH, S.machine.bedW]; save(); mountMaterial(); regenerate(); });
document.querySelectorAll('#unitSeg button').forEach(b => b.addEventListener('click', () => {
  S.units = b.dataset.u; save(); mountMaterial(); mountParams(); if (design) { renderSheets(); renderStats(); } if (S.entry === 'assembly') asmPanel.load();
}));
document.querySelectorAll('#viewSeg button').forEach(b => b.addEventListener('click', () => {
  S.view = b.dataset.v; save();
  document.querySelectorAll('#viewSeg button').forEach(x => x.classList.toggle('on', x === b));
  if (design) render();
}));
$('#assembleBtn').addEventListener('click', () => {
  if (preview.assembling) { preview.stopAssemble(); return; }
  if (preview.assemble(() => { $('#assembleBtn').textContent = 'Assemble ▶'; })) $('#assembleBtn').textContent = 'Stop ■';
});
$('#explode').addEventListener('input', e => { S.explode = +e.target.value; preview.setExplode(S.explode); });
function applyStereo() {
  preview.setStereo(S.stereo, S.stereoDeg);
  $('#stereoSel').value = S.stereo;
  $('#stereoDepthIn').value = S.stereoDeg;
  $('#stereoDepth').hidden = S.stereo === 'off';
  $('#stereoSplit').hidden = S.stereo === 'off';
}
$('#stereoSel').addEventListener('change', e => {
  S.stereo = e.target.value; save(); applyStereo();
  if (S.stereo !== 'off') toast(S.stereo === 'cross' ? 'Cross your eyes until the two pictures merge into a third in the middle' : 'Look through the screen until the two pictures merge');
  if (design) render();
});
/* ---------- maximize the preview ---------- */
const viewEl = document.querySelector('.view');
function setMax(on) {
  on = !!on;
  if (viewEl.classList.contains('max') === on) return;
  viewEl.classList.toggle('max', on);
  document.body.classList.toggle('view-max', on);
  const b = $('#maxBtn');
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Restore preview (Esc)' : 'Maximize preview (Esc to restore)';
  b.setAttribute('aria-label', on ? 'Restore preview' : 'Maximize preview');
  // Real fullscreen when the page allows it; the CSS fill above covers the window either way.
  try {
    if (on && document.fullscreenEnabled && !document.fullscreenElement) viewEl.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) { /* fullscreen blocked: the window fill is enough */ }
  preview.reframe();
  if (design) requestAnimationFrame(() => render());
}
$('#maxBtn').addEventListener('click', () => setMax(!viewEl.classList.contains('max')));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && viewEl.classList.contains('max')) setMax(false); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && viewEl.classList.contains('max')) setMax(false); });
$('#stereoDepthIn').addEventListener('input', e => { S.stereoDeg = +e.target.value; save(); preview.setStereo(S.stereo, S.stereoDeg); });
$('#q').addEventListener('input', e => { S.q = e.target.value; renderLibrary(); });
$('#reset').addEventListener('click', () => { delete S.params[S.entry]; save(); mountParams(); regenerate(true); });

/* ---------- your designs: tools, open from file ---------- */
function renderMineTools(e) {
  const el = $('#mineTools');
  if (e.source !== 'claude') { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<button class="btn ghost" data-mt="dl">Download generator</button>${e.versions && e.versions.length ? '<button class="btn ghost" data-mt="undo">Undo last change</button>' : ''}<button class="btn ghost" data-mt="del">Delete</button>`;
  el.querySelector('[data-mt=dl]').addEventListener('click', () => saveFile(slug(e.title) + '.generator.js', generatorFile(e), 'text/javascript'));
  const undo = el.querySelector('[data-mt=undo]');
  if (undo) undo.addEventListener('click', () => {
    const prev = e.versions.pop();
    Object.assign(e, prev);
    saveMine(mine); select(e.id); toast('Went back to the previous version');
  });
  const del = el.querySelector('[data-mt=del]');
  del.addEventListener('click', () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Click again to delete'; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = 'Delete'; } }, 4000); return; }
    mine = mine.filter(x => x.id !== e.id); delete S.params[e.id];
    saveMine(mine); select('finger-box'); toast('Deleted ' + e.title);
  });
}

function addOrUpdate({ code, meta, chat, changing, origin = 'claude' }) {
  let e;
  if (changing) {
    e = entryOf(S.entry);
    e.versions = (e.versions || []).concat([{ code: e.code, params: e.params, title: e.title, description: e.description }]).slice(-10);
    e.code = code;
    if (meta) Object.assign(e, { params: meta.params, title: meta.title || e.title, description: meta.description || e.description });
    if (chat) e.chat = chat;
  } else {
    e = newEntry({ code, meta: meta || { title: 'New design (needs fixing)', params: [] }, chat, origin });
    mine.unshift(e);
  }
  if (!saveMine(mine)) toast('Could not save in this browser; download the generator to keep it');
  select(e.id);
  return e;
}

$('#openGen').addEventListener('change', async ev => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  const code = codeFromFile(await f.text());
  try {
    const r = await sandbox.run(code, {}, matNow());
    addOrUpdate({ code, meta: r.meta, chat: [], origin: 'file' });
    toast('Opened ' + r.meta.title);
  } catch (err) {
    toast('That file is not a working Lasersmith generator: ' + err.message);
  }
});

/* ---------- voxel editor (M5) ---------- */
const voxEd = mountVoxelEditor($('#voxelCard'), {
  getGrid: () => gridFor(currentParams()),
  onChange: grid => {
    S.params[S.entry] = { ...(S.params[S.entry] || {}), grid, figure: 'custom' };
    save(); mountParams(); regenerate();
  },
});

/* ---------- assemblies: boxes joined by hinges (PRD 4.3) ---------- */
let pickCb = null, downAt = null;
function stopPick() { pickCb = null; $('#view').classList.remove('picking'); }
const asmPanel = mountAssemblyPanel($('#asmCard'), {
  getSpec: () => currentParams().spec,
  setSpec: spec => { S.params[S.entry] = { ...(S.params[S.entry] || {}), spec: JSON.stringify(spec) }; save(); regenerate(); },
  units: () => S.units,
  design: () => design,
  fit: (spot, joint) => fitSpot(spot, design, joint, currentParams(), matNow().thickness),
  startPick: cb => {
    if (!cb) return stopPick();
    pickCb = cb;
    $('#view').classList.add('picking');
    if (S.view === 'flat') { S.view = '3d'; document.querySelectorAll('#viewSeg button').forEach(x => x.classList.toggle('on', x.dataset.v === '3d')); render(); }
  },
  toast,
});
$('#view').addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
$('#view').addEventListener('pointerup', e => {
  if (!pickCb || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const hit = preview.pick(e.clientX, e.clientY);
  const spot = hit && design && spotOn(design, hit.part, hit.point);
  if (!spot) { toast('Click on the face of a box'); return; }
  const cb = pickCb;
  stopPick();
  cb(spot);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pickCb) { const cb = pickCb; stopPick(); cb(null); } });

/* ---------- Claude mode (M3) ---------- */
const panel = mountClaudePanel($('#claudeCard'), {
  currentEntry: () => entryOf(S.entry),
  currentParams,
  material: matNow,
  machine: () => { const z = sheetSize(S.machine); return { ...S.machine, sheetW: z.w, sheetH: z.h }; },
  run: (src, params) => sandbox.run(src, params, matNow()),
  check: d => validate(d, rules()).filter(i => i.level === 'error').map(i => (i.part ? i.part + ': ' : '') + i.msg),
  onResult: r => addOrUpdate({ code: r.source, meta: r.meta, chat: r.chat, changing: r.changing }),
  toast,
});
(async () => {
  try {
    if (window.claude && window.claude.use) {
      const s = await window.claude.use('sample');
      if (!s) return;
      document.body.dataset.claude = 'on';
      $('#mode').textContent = 'Claude connected';
      panel.enable(s);
    }
  } catch (e) { /* standalone */ }
})();

/* ---------- boot ---------- */
document.querySelectorAll('#viewSeg button').forEach(x => x.classList.toggle('on', x.dataset.v === S.view));
$('#explode').value = S.explode;
applyStereo();
$('#q').value = S.q;
mountMaterial();
if (!entryOf(S.entry)) S.entry = 'finger-box';
select(S.entry);

// test hook
window.__lasersmith = { get design() { return design; }, get issues() { return issues; }, get nested() { return nested; }, get mine() { return mine; }, sandbox, select, state: S };
