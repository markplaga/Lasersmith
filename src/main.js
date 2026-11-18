// Lasersmith app shell: library -> parameters -> Design document -> validation, nesting, preview, export.
import { LIBRARY, byId, MATERIALS, MACHINE } from './library.js';
import { renderParams, defaults, fmtLen } from './ui/params.js';
import { createPreview } from './ui/preview3d.js';
import { validate, hasErrors } from './geom/validate.js';
import { nest } from './geom/nest.js';
import { sheetSVG, sheetDXF, sheetLBRN2, exportBundle, slug } from './export/formats.js';
import { createBoxesClient } from './boxespy/client.js';
import { boxesToDesign } from './boxespy/adapter.js';

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

/* ---------- 3D ---------- */
const preview = createPreview($('#view'));

/* ---------- library ---------- */
function renderLibrary() {
  const q = S.q.trim().toLowerCase();
  const cats = new Map();
  for (const e of LIBRARY) {
    const hay = (e.title + ' ' + e.category + ' ' + (e.tags || []).join(' ') + ' ' + (e.cls || '')).toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (!cats.has(e.category)) cats.set(e.category, []);
    cats.get(e.category).push(e);
  }
  let html = '';
  for (const [c, list] of cats) {
    html += `<li class="cat">${esc(c)}</li>`;
    for (const e of list) {
      html += `<li><button class="lib-item${e.id === S.entry ? ' on' : ''}" data-id="${e.id}" aria-pressed="${e.id === S.entry}"><b>${esc(e.title)}</b><span class="src src-${e.source === 'native' ? 'native' : 'py'}">${e.source === 'native' ? 'Native 3D' : 'boxes.py'}</span></button></li>`;
    }
  }
  $('#lib').innerHTML = html || '<li class="empty">Nothing matches.</li>';
  $('#lib').querySelectorAll('.lib-item').forEach(b => b.addEventListener('click', () => select(b.dataset.id)));
}

async function select(id) {
  S.entry = id;
  S.sheet = 0;
  save();
  renderLibrary();
  const e = byId(id);
  $('#dtitle').textContent = e.title;
  $('#ddesc').textContent = e.description || '';
  $('#pyNote').hidden = e.source === 'native';
  if (e.source === 'native') {
    schema = e.gen.params;
    mountParams();
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
  const e = byId(S.entry);
  const params = currentParams();
  const material = { name: S.material.name, thickness: +S.material.thickness, kerf: +S.material.kerf };
  try {
    let d;
    if (e.source === 'native') d = e.gen.generate(params, material);
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
    issues = validate(design, { bedW: +S.machine.bedW, bedH: +S.machine.bedH, margin: +S.machine.margin });
    nested = nest(design, { sheetW: +S.machine.bedW, sheetH: +S.machine.bedH, margin: +S.machine.margin, gap: +S.machine.gap });
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
  if (kind === 'zip') saveFile(slug(design.title) + '.zip', new Blob([exportBundle(nested, design)], { type: 'application/zip' }));
}));

/* ---------- material + machine ---------- */
function mountMaterial() {
  $('#matSel').innerHTML = MATERIALS.map(m => `<option value="${m.id}" ${m.id === S.material.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('') + `<option value="custom" ${!MATERIALS.some(m => m.id === S.material.id) ? 'selected' : ''}>Custom</option>`;
  $('#thick').value = fmtLen(S.material.thickness, S.units);
  $('#kerf').value = S.material.kerf;
  $('#bedW').value = fmtLen(S.machine.bedW, S.units);
  $('#bedH').value = fmtLen(S.machine.bedH, S.units);
  $('#margin').value = fmtLen(S.machine.margin, S.units);
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
for (const k of ['bedW', 'bedH', 'margin']) {
  $('#' + k).addEventListener('input', e => {
    const v = toMM(parseFloat(e.target.value));
    if (!(v >= 0)) return;
    S.machine[k] = v; save(); regenerate();
  });
}
$('#bedSwap').addEventListener('click', () => { [S.machine.bedW, S.machine.bedH] = [S.machine.bedH, S.machine.bedW]; save(); mountMaterial(); regenerate(); });
document.querySelectorAll('#unitSeg button').forEach(b => b.addEventListener('click', () => {
  S.units = b.dataset.u; save(); mountMaterial(); mountParams(); if (design) { renderSheets(); renderStats(); }
}));
document.querySelectorAll('#viewSeg button').forEach(b => b.addEventListener('click', () => {
  S.view = b.dataset.v; save();
  document.querySelectorAll('#viewSeg button').forEach(x => x.classList.toggle('on', x === b));
  if (design) render();
}));
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
$('#stereoDepthIn').addEventListener('input', e => { S.stereoDeg = +e.target.value; save(); preview.setStereo(S.stereo, S.stereoDeg); });
$('#q').addEventListener('input', e => { S.q = e.target.value; renderLibrary(); });
$('#reset').addEventListener('click', () => { delete S.params[S.entry]; save(); mountParams(); regenerate(true); });

/* ---------- Claude mode detection (features arrive in M3) ---------- */
(async () => {
  try {
    if (window.claude && window.claude.use) {
      await window.claude.use('sample');
      document.body.dataset.claude = 'on';
      $('#mode').textContent = 'Claude connected';
    }
  } catch (e) { /* standalone */ }
})();

/* ---------- boot ---------- */
document.querySelectorAll('#viewSeg button').forEach(x => x.classList.toggle('on', x.dataset.v === S.view));
$('#explode').value = S.explode;
applyStereo();
$('#q').value = S.q;
mountMaterial();
if (!byId(S.entry)) S.entry = 'finger-box';
select(S.entry);

// test hook
window.__lasersmith = { get design() { return design; }, get issues() { return issues; }, get nested() { return nested; }, select, state: S };
