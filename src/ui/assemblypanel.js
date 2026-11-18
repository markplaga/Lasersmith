// Assembly panel (PRD 4.3): the list of boxes in an assembly, what each hangs off, by which joint, and
// its pose. Edits the assembly generator's hidden `spec` parameter; faces can also be picked in 3D.

import { parseSpec, FACES, OPPOSITE, JOINT_TYPES } from '../generators/assembly.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IN = 25.4;
const cap = s => s[0].toUpperCase() + s.slice(1);

/**
 * @param el root element
 * @param host {getSpec() -> text, setSpec(spec), units() -> 'mm'|'in', design() -> current design,
 *              startPick(onPick({obj, face, du, dv}) | cancel), fit(spot, joint) -> spot, toast(msg)}
 */
export function mountAssemblyPanel(el, host) {
  let spec = parseSpec(host.getSpec());
  let openId = null, picking = null;

  const L = v => (host.units() === 'in' ? +(v / IN).toFixed(3) : Math.round(v * 10) / 10);
  const fromL = v => (host.units() === 'in' ? v * IN : v);
  const commit = (rerender) => { host.setSpec(spec); if (rerender) render(); };
  const descendants = id => spec.objects.filter(o => o.parent === id).flatMap(o => [o.id, ...descendants(o.id)]);

  function render() {
    const u = host.units();
    const objs = spec.objects;
    const ranges = new Map(((host.design() || {}).joints || []).map(j => [j.key, j.range]));
    el.innerHTML = `
      <h2>Assembly</h2>
      <p class="muted">Each box hangs off a face of a box above it in the list. Pick the face from the lists, or press <b>Pick in 3D</b> and click a face in the preview.</p>
      <div class="as-list">${objs.map((o, i) => objHTML(o, i, u, ranges.get(o.id))).join('')}</div>
      <div class="as-bar"><button class="btn" id="asAdd">Add a box</button><span class="muted" id="asHint"></span></div>`;
    el.querySelectorAll('details.as-obj').forEach(d => d.addEventListener('toggle', () => { if (d.open) openId = d.dataset.id; else if (openId === d.dataset.id) openId = null; }));
    el.querySelectorAll('[data-f]').forEach(inp => {
      const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
      inp.addEventListener(ev, () => change(inp));
    });
    el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act, b.dataset.id)));
    el.querySelector('#asAdd').addEventListener('click', add);
    if (picking) el.querySelector('#asHint').textContent = 'Click a face in the 3D view (Esc to cancel).';
  }

  function objHTML(o, i, u, range) {
    const objs = spec.objects;
    const sel = (f, opts, v) => `<select data-f="${f}" data-id="${esc(o.id)}" aria-label="${esc(f)}">${opts.map(c => `<option value="${esc(c.value)}" ${String(c.value) === String(v) ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`;
    const num = (f, v, label, unit = u) => `<label class="as-n"><span>${label}</span><span class="num"><input type="number" inputmode="decimal" step="${unit === 'in' ? 0.0625 : 1}" data-f="${f}" data-id="${esc(o.id)}" value="${L(v)}"><i>${unit}</i></span></label>`;
    const faces = FACES.map(f => ({ value: f, label: cap(f) }));
    const slider = (f, label, r) => `<div class="row col"><label>${label}${r ? `<small>Free from ${r[0]}° to +${r[1]}°</small>` : ''}</label><span class="angle"><input type="range" min="-150" max="150" step="1" data-f="${f}" data-id="${esc(o.id)}" value="${o[f]}" aria-label="${esc(o.name)} ${label}"><span class="num"><input type="number" min="-150" max="150" step="1" data-f="${f}" data-id="${esc(o.id)}" value="${o[f]}"><i>°</i></span></span></div>`;
    const parent = objs.find(q => q.id === o.parent);
    const jl = o.parent ? (JOINT_TYPES.find(j => j.value === o.joint) || {}).label.split(' (')[0] : 'Fixed in place';
    const sum = o.parent ? `${jl} on ${esc(parent.name)}, ${o.face}` : 'Base';
    let body = `<div class="row"><label>Name</label><span class="num as-name"><input type="text" data-f="name" data-id="${esc(o.id)}" value="${esc(o.name)}" maxlength="40"></span></div>
      <div class="as-size">${num('w', o.w, 'Width')}${num('d', o.d, 'Depth')}${num('h', o.h, 'Height')}</div>`;
    if (o.parent) {
      const others = objs.slice(0, i).filter(q => !descendants(o.id).includes(q.id)).map(q => ({ value: q.id, label: q.name }));
      body += `
        <div class="row"><label>Hangs off</label>${sel('parent', others, o.parent)}</div>
        <div class="row"><label>On its face</label>${sel('face', faces, o.face)}</div>
        <div class="row"><label>Joint</label>${sel('joint', JOINT_TYPES, o.joint)}</div>
        <div class="row"><label>With this box's face<small>Usually the opposite one.</small></label>${sel('childFace', faces, o.childFace)}</div>
        <div class="row"><label>Turn the box</label>${sel('spin', [0, 90, 180, 270].map(a => ({ value: a, label: a + '°' })), o.spin)}</div>
        <div class="as-size">${num('du', o.du, 'Across')}${num('dv', o.dv, 'Along')}</div>
        ${o.joint !== 'fixed' ? slider('a1', o.joint === 'swivel' ? 'Turn' : o.joint === 'cross' ? 'Pose, axis 1' : 'Pose', range && range.a1) : ''}
        ${o.joint === 'cross' ? slider('a2', 'Pose, axis 2', range && range.a2) : ''}
        <div class="as-bar"><button class="btn ghost" data-act="pick" data-id="${esc(o.id)}">${picking === o.id ? 'Click a face…' : 'Pick in 3D'}</button><button class="btn ghost" data-act="remove" data-id="${esc(o.id)}">Remove</button></div>`;
    }
    const open = openId ? openId === o.id : i === objs.length - 1;
    return `<details class="as-obj" data-id="${esc(o.id)}" ${open ? 'open' : ''}><summary><b>${esc(o.name)}</b><span>${sum}</span></summary>${body}</details>`;
  }

  function change(inp) {
    const o = spec.objects.find(q => q.id === inp.dataset.id);
    const f = inp.dataset.f;
    let v = inp.value;
    let structural = false;
    if (['w', 'd', 'h', 'du', 'dv'].includes(f)) { if (v === '' || isNaN(+v)) return; v = fromL(+v); }
    else if (f === 'a1' || f === 'a2' || f === 'spin') { v = +v; if (f !== 'spin') el.querySelectorAll(`[data-f="${f}"][data-id="${o.id}"]`).forEach(x => { if (x !== inp) x.value = v; }); }
    if (f === 'face') { o.childFace = OPPOSITE[v]; o.du = 0; o.dv = 0; structural = true; }
    if (['parent', 'joint', 'childFace'].includes(f)) structural = true;
    if (f === 'name') { el.querySelector(`details[data-id="${o.id}"] summary b`).textContent = v; }
    o[f] = v;
    spec = parseSpec(spec);
    openId = o.id;
    commit(structural);
  }

  function act(a, id) {
    if (a === 'remove') {
      const gone = new Set([id, ...descendants(id)]);
      const n = gone.size - 1;
      spec = parseSpec({ objects: spec.objects.filter(o => !gone.has(o.id)) });
      if (n) host.toast(`Removed with the ${n} box${n === 1 ? '' : 'es'} hanging off it.`);
      openId = null;
      commit(true);
    } else if (a === 'pick') {
      if (picking === id) { picking = null; host.startPick(null); render(); return; }
      picking = id;
      openId = id;
      render();
      host.startPick(spot => {
        picking = null;
        const o = spec.objects.find(q => q.id === id);
        if (!spot || !o) { render(); return; }
        if (spot.obj === id || descendants(id).includes(spot.obj)) { host.toast('A box cannot hang off itself or a box hanging off it.'); render(); return; }
        // Keep the list in order: parents before children.
        const objs = spec.objects.filter(q => q.id !== id && !descendants(id).includes(q.id));
        const moving = spec.objects.filter(q => q.id === id || descendants(id).includes(q.id));
        const fit = host.fit(spot, o.joint);
        Object.assign(o, { parent: spot.obj, face: spot.face, childFace: OPPOSITE[spot.face], du: fit.du, dv: fit.dv });
        const at = Math.max(objs.findIndex(q => q.id === spot.obj) + 1, 1);
        spec = parseSpec({ objects: [...objs.slice(0, at), ...moving, ...objs.slice(at)] });
        commit(true);
      });
    }
  }

  function add() {
    const objs = spec.objects;
    const last = objs[objs.length - 1];
    // A free face on the last box, top first.
    const used = new Set(objs.filter(o => o.parent === last.id).map(o => o.face));
    if (last.parent) used.add(last.childFace);
    const face = ['top', 'right', 'left', 'front', 'back', 'bottom'].find(f => !used.has(f)) || 'top';
    let n = objs.length + 1, id;
    do id = 'o' + n++; while (objs.some(o => o.id === id));
    const size = Math.max(50, Math.round(Math.min(last.w, last.d) * 0.8));
    spec = parseSpec({ objects: [...objs, { id, name: `Box ${objs.length + 1}`, w: size, d: size, h: size, parent: last.id, face, joint: 'cross' }] });
    openId = id;
    commit(true);
  }

  return {
    /** The assembly design was opened or its spec changed from outside. */
    load() { spec = parseSpec(host.getSpec()); picking = null; render(); },
    /** A new design came back: refresh the ranges shown under the pose sliders. */
    refresh() {
      if (el.contains(document.activeElement) && document.activeElement.matches('input')) return; // do not steal focus
      render();
    },
    cancelPick() { if (picking) { picking = null; render(); } },
  };
}
