// Native finger-jointed box (the Boxsmith closed box, rebuilt on the Lasersmith geometry core).
// Every plate is a slab of the box; where two slabs cross, the shared bar is split into alternating
// fingers; where three cross (a corner cube) the highest-priority plate keeps it. Each plate's outline
// is its full rectangle minus whatever other plates own, so the parts interlock exactly (tests check
// there is no 3D overlap and no gap).

import { rectRegion } from '../geom/rectunion.js';
import { makeDesign } from '../geom/design.js';
import { strokeText, textWidth } from '../geom/strokefont.js';
import { area } from '../geom/poly.js';

const AX = ['x', 'y', 'z'];
const unit = a => [a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0];
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Split [a, b] into an odd number of fingers close to width fw. */
export function fingerSegments(a, b, fw, t) {
  const s = b - a;
  if (s <= 0) return [];
  let n = 2 * Math.floor(s / (2 * fw)) + 1;
  while (n > 1 && s / n < t) n -= 2;
  if (s < 2 * t) n = 1;
  const out = [];
  for (let i = 0; i < n; i++) out.push([a + (s * i) / n, a + (s * (i + 1)) / n, i]);
  return out;
}

/**
 * Build plates for a box of outer size L = [X, Y, Z].
 * plates: [{name, n (normal axis), slab: [lo, hi], u, v, pri}]
 */
export function boxPlates(L, t, faces) {
  const all = {
    bottom: { n: 2, slab: [0, t], u: 0, v: 1, pri: 1 },
    top: { n: 2, slab: [L[2] - t, L[2]], u: 0, v: 1, pri: 1 },
    front: { n: 1, slab: [0, t], u: 0, v: 2, pri: 3 },
    back: { n: 1, slab: [L[1] - t, L[1]], u: 0, v: 2, pri: 3 },
    left: { n: 0, slab: [0, t], u: 1, v: 2, pri: 2 },
    right: { n: 0, slab: [L[0] - t, L[0]], u: 1, v: 2, pri: 2 },
  };
  return faces.map(name => ({ name, ...all[name] }));
}

/** 2D region (in the plate's u, v coords) that a plate owns. */
export function plateRegion(P, plates, L, t, fw) {
  const keep = [[0, 0, L[P.u], L[P.v]]];
  const cut = [];
  for (const Q of plates) {
    if (Q === P || Q.n === P.n) continue;
    const c = Q.n === P.u ? P.v : P.u; // axis the shared bar runs along
    const rs = plates.filter(R => R.n === c).sort((a, b) => a.slab[0] - b.slab[0]);
    const intervals = [];
    let c0 = 0, c1 = L[c];
    for (const R of rs) {
      const owner = [P, Q, R].reduce((a, b) => (b.pri > a.pri ? b : a));
      intervals.push([R.slab[0], R.slab[1], owner]);
      if (R.slab[0] <= 0 + 1e-9) c0 = Math.max(c0, R.slab[1]);
      else c1 = Math.min(c1, R.slab[0]);
    }
    const hi = P.pri > Q.pri ? P : Q, lo = hi === P ? Q : P;
    for (const [a, b, i] of fingerSegments(c0, c1, fw, t)) intervals.push([a, b, i % 2 === 0 ? hi : lo]);
    for (const [a, b, owner] of intervals) {
      if (owner === P) continue;
      const r = c === P.u ? [a, Q.slab[0], b, Q.slab[1]] : [Q.slab[0], a, Q.slab[1], b];
      cut.push(r);
    }
  }
  return rectRegion(keep, cut);
}

/** Outward port frames on each face: o = outer face centre, n = outward normal, u x v = n. */
const PORT_AXES = {
  top: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  bottom: { n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
  front: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  back: { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1] },
  right: { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  left: { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] },
};

/**
 * A finger-jointed box as placed parts plus a port on every face, in box coordinates
 * (corner at the origin, size L). Used by the box generator and by assemblies (hinges, robot).
 * opts: {faces, finger, labels, prefix, title}
 */
export function buildBox(L, t, opts = {}) {
  const faces = opts.faces || ['bottom', 'top', 'front', 'back', 'left', 'right'];
  const fw = Math.max(opts.finger ?? 10, 1.5 * t);
  const pre = opts.prefix || '';
  const plates = boxPlates(L, t, faces);
  const notes = [];
  const parts = plates.map(P => {
    const reg = plateRegion(P, plates, L, t, fw);
    const outline = reg.outer.slice().sort((a, b) => area(b) - area(a))[0];
    if (reg.outer.length > 1) notes.push(`${pre}${P.name} has ${reg.outer.length} separate islands; increase size or finger width.`);
    const u = unit(P.u), v = unit(P.v), n = crossV(u, v);
    const mid = (P.slab[0] + P.slab[1]) / 2;
    const o = [0, 0, 0];
    o[P.n] = mid;
    const lu = L[P.u], lv = L[P.v];
    const label = (opts.title ? opts.title + ' ' : '') + P.name;
    const size = Math.min(6, lv / 6, lu / (textWidth(label, 1) + 1));
    const nm = P.name[0].toUpperCase() + P.name.slice(1);
    return {
      id: pre + P.name,
      name: opts.title ? `${opts.title} ${P.name}` : nm,
      outline,
      holes: reg.holes,
      engrave: opts.labels && size >= 2 ? strokeText(label, lu / 2, lv / 2 - size / 2, size) : [],
      place: { o, u, v, n },
      meta: { axis: AX[P.n], face: P.name },
    };
  });
  const ports = faces.map(f => {
    const a = PORT_AXES[f], o = [L[0] / 2, L[1] / 2, L[2] / 2];
    const k = a.n.findIndex(x => x !== 0);
    o[k] = a.n[k] > 0 ? L[k] : 0;
    const iu = a.u.findIndex(x => x !== 0), iv = a.v.findIndex(x => x !== 0);
    // Room for a joint: the face's inside area (between the side walls).
    return { name: f, part: pre + f, o, u: a.u.slice(), v: a.v.slice(), n: a.n.slice(), size: [L[iu] - 2 * t, L[iv] - 2 * t] };
  });
  return { parts, ports, notes, L };
}

export default {
  id: 'finger-box',
  title: 'Finger-jointed box',
  category: 'Boxes',
  source: 'native',
  description: 'A six-sided (or open-top) box with finger joints on every edge. Full 3D preview; parts interlock exactly at the material thickness.',
  tags: ['box', 'finger joint', 'starter'],
  params: [
    { key: 'width', label: 'Width', type: 'length', default: 120, min: 20, max: 900, group: 'Size', help: 'Along X.' },
    { key: 'depth', label: 'Depth', type: 'length', default: 80, min: 20, max: 900, group: 'Size', help: 'Along Y.' },
    { key: 'height', label: 'Height', type: 'length', default: 60, min: 15, max: 900, group: 'Size', help: 'Along Z.' },
    { key: 'dims', label: 'Sizes are', type: 'select', default: 'outer', group: 'Size', choices: [{ value: 'outer', label: 'Outside' }, { value: 'inner', label: 'Inside' }] },
    { key: 'lid', label: 'Top', type: 'select', default: 'closed', group: 'Style', choices: [{ value: 'closed', label: 'Closed box' }, { value: 'open', label: 'Open tray' }] },
    { key: 'finger', label: 'Finger width', type: 'length', default: 10, min: 3, max: 100, group: 'Joints', help: 'Target finger length; adjusted so each edge gets an odd count.' },
    { key: 'labels', label: 'Engrave part names', type: 'bool', default: true, group: 'Style' },
  ],
  generate(p, material) {
    const t = material.thickness;
    const closed = p.lid !== 'open';
    const add = p.dims === 'inner' ? [2 * t, 2 * t, closed ? 2 * t : t] : [0, 0, 0];
    const L = [p.width + add[0], p.depth + add[1], p.height + add[2]];
    const faces = ['bottom', 'front', 'back', 'left', 'right'].concat(closed ? ['top'] : []);
    const box = buildBox(L, t, { faces, finger: p.finger, labels: p.labels });
    return makeDesign({
      title: `Finger box ${fmt(L[0])} x ${fmt(L[1])} x ${fmt(L[2])} mm`,
      generator: { id: 'finger-box', params: p },
      material,
      parts: box.parts,
      notes: box.notes,
      ports: box.ports,
      view: { bounds: L },
    });
  },
};

function fmt(v) { return Math.round(v * 10) / 10; }
