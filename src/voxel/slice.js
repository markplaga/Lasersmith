// Voxel figure -> interlocking flat pieces (PRD section 9). Two families of planes at right angles
// (for example X and Y), each plane through the middle of a voxel layer; each piece is that layer's
// cross-section. Where two pieces cross they get half-lap slots: along every crossing line the first
// family keeps the lower half and the second the upper half, so the second family slides on from above.

import { get } from './grid.js';
import { rectRegion } from '../geom/rectunion.js';
import { area, pointInLoop, bbox } from '../geom/poly.js';
import { strokeText, textWidth } from '../geom/strokefont.js';

const AX = ['X', 'Y', 'Z'];
const E = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dims = g => [g.nx, g.ny, g.nz];
const at = (g, c) => get(g, c[0], c[1], c[2]);

/** Layers of axis a that get a plane: every `spacing`-th layer, centred in the figure. */
export function planeLayers(g, a, spacing) {
  const n = dims(g)[a];
  const filled = [];
  for (let i = 0; i < n; i++) {
    let any = false;
    for (let x = 0; x < g.nx && !any; x++) for (let y = 0; y < g.ny && !any; y++) for (let z = 0; z < g.nz && !any; z++) {
      const c = [x, y, z];
      if (c[a] === i && at(g, c)) any = true;
    }
    if (any) filled.push(i);
  }
  if (!filled.length) return [];
  const lo = filled[0], hi = filled[filled.length - 1];
  const off = lo + Math.floor(((hi - lo) % spacing) / 2);
  const out = [];
  for (let i = off; i <= hi; i += spacing) out.push(i);
  return out;
}

/**
 * @param g grid  @param o {voxel (mm), families: [a, b] axis indexes, spacing (layers), t, labels}
 * @returns {parts, notes, info}
 */
export function sculpt(g, o) {
  const V = o.voxel, t = o.t, [A, B] = o.families, s = Math.max(1, Math.round(o.spacing || 1));
  const W = 3 - A - B; // crossing lines run along this axis
  const notes = [], parts = [], split = [];
  let dropped = 0;
  if (V < 2.2 * t) notes.push(`Voxels of ${V} mm leave less than ${(0.6 * t).toFixed(1)} mm of wood beside each ${t} mm slot. Use voxels of at least ${(2.2 * t).toFixed(1)} mm.`);
  const layers = { [A]: planeLayers(g, A, s), [B]: planeLayers(g, B, s) };
  const N = dims(g);
  // Crossing line between plane a=i and plane b=j. Family A keeps everything below the split, B everything
  // above, so B can slide onto A. With one run of voxels along the line that is a plain half-lap; with
  // several runs the split goes through the middle of the longest one (the others go wholly to one side).
  const splitAt = (i, j) => {
    const runs = [];
    let start = -1;
    for (let k = 0; k <= N[W]; k++) {
      const c = [0, 0, 0]; c[A] = i; c[B] = j; c[W] = k;
      const f = k < N[W] && at(g, c);
      if (f && start < 0) start = k;
      if (!f && start >= 0) { runs.push([start, k]); start = -1; }
    }
    if (!runs.length) return null;
    const best = runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    return { lo: runs[0][0] * V, hi: runs[runs.length - 1][1] * V, mid: ((best[0] + best[1]) / 2) * V, multi: runs.length > 1 };
  };
  // Third family (optional): flat tiles in planes across W, one per cell of the A/B lattice, each
  // hooked by tabs into slots in the A pieces on either side (PRD 9: the third family is split so it
  // can still go together). extra[i] = slots for the A piece at layer i.
  const extra = {}, tiles = [];
  const tileInfo = [];
  if (o.third && s < 2) notes.push('Flat tiles need a plane spacing of 2 or more: with spacing 1 there is no room between the pieces.');
  else if (o.third) thirdFamily(g, { V, t, A, B, W, N, layers: [layers[A], layers[B], planeLayers(g, W, s)], extra, tiles, notes: tileInfo });
  for (const fam of [A, B]) {
    const other = fam === A ? B : A;
    const [P, Q] = [0, 1, 2].filter(k => k !== fam); // piece coordinates (p along axis P, q along axis Q)
    const u = E[P], v = E[Q], n = crossV(u, v);
    layers[fam].forEach((i, num) => {
      const keep = [], cut = [];
      for (let p = 0; p < N[P]; p++) for (let q = 0; q < N[Q]; q++) {
        const c = [0, 0, 0]; c[fam] = i; c[P] = p; c[Q] = q;
        if (at(g, c)) keep.push([p * V, q * V, (p + 1) * V, (q + 1) * V]);
      }
      if (!keep.length) return;
      for (const j of layers[other]) {
        const sp = fam === A ? splitAt(i, j) : splitAt(j, i);
        if (!sp) continue;
        const cb = (j + 0.5) * V;
        // fam A gives up the upper half (along W), fam B the lower half
        const w0 = fam === A ? sp.mid : sp.lo - 1, w1 = fam === A ? sp.hi + 1 : sp.mid;
        const r = P === other ? [cb - t / 2, w0, cb + t / 2, w1] : [w0, cb - t / 2, w1, cb + t / 2];
        cut.push(r);
      }
      if (fam === A && extra[i]) cut.push(...extra[i]);
      const reg = rectRegion(keep, cut);
      // Cleanup: drop slivers; an island must cross another piece (touch a slot) to be held in place.
      const minArea = 0.5 * V * V;
      const held = l => cut.some(r => l.some(([x, y]) => x >= r[0] - 1e-6 && x <= r[2] + 1e-6 && y >= r[1] - 1e-6 && y <= r[3] + 1e-6));
      const all = reg.outer.slice().sort((x, y) => Math.abs(area(y)) - Math.abs(area(x)));
      const outers = all.filter(l => Math.abs(area(l)) >= minArea && (all.length === 1 || held(l)));
      dropped += all.length - outers.length;
      const base = AX[fam] + (num + 1);
      if (outers.length > 1) split.push(base);
      outers.forEach((outline, k) => {
        const name = outers.length > 1 ? base + String.fromCharCode(97 + k) : base;
        const holes = reg.holes.filter(h => pointInLoop(h[0], outline));
        const o3 = [0, 0, 0]; o3[fam] = (i + 0.5) * V;
        parts.push({
          id: 'vx-' + name.toLowerCase(), name, outline, holes,
          engrave: o.labels ? label(name, outline, holes, cut, V, t, Q === W) : [],
          place: { o: o3, u, v, n },
          meta: { family: AX[fam], layer: i },
        });
      });
    });
  }
  // Tiles become parts; assembly order: A pieces with the tiles between them, then B.
  const order = [];
  if (tiles.length) {
    const aParts = parts.filter(q => q.meta.family === AX[A]);
    const LA = layers[A];
    const tilesIn = k => tiles.filter(q => q.interval === k).map(q => q.id);
    LA.forEach((layer, w) => {
      order.push(...aParts.filter(q => q.meta.layer === layer).map(q => q.id));
      if (w === 0) order.push(...tilesIn(0));
      order.push(...tilesIn(w + 1));
    });
    order.push(...parts.filter(q => q.meta.family === AX[B]).map(q => q.id));
    for (const q of tiles) {
      parts.push({ id: q.id, name: q.name, outline: q.outline, holes: [], engrave: o.labels ? label(q.name, q.outline, [], [], V, t, false) : [], place: q.place, meta: { family: AX[W], layer: q.layer } });
    }
  }
  const fA = AX[A], fB = AX[B], dir = ['left to right', 'front to back', 'bottom to top'];
  if (dropped) notes.push(`${dropped} sliver${dropped === 1 ? ' was' : 's were'} left out (too small or not held by any slot). Bigger voxels or a wider plane spacing keep more detail.`);
  const info = [
    `${layers[A].length} ${fA} pieces and ${layers[B].length} ${fB} pieces, numbered ${dir[A]} and ${dir[B]}.`,
    `Assembly: stand the ${fA} pieces in order, then slide each ${fB} piece onto them along ${AX[W]} (the ${fB} pieces' slots face the ${fA} pieces' slots). Every crossing is a half-lap.`,
  ];
  if (split.length) info.push(`${split.join(', ')} ${split.length === 1 ? 'is' : 'are'} cut as separate pieces (a, b, ...): that layer of the figure is not all one piece, or a slot passes through a thin part. Each slots onto the pieces it crosses.`);
  if (tiles.length) {
    const glued = tiles.filter(q => q.tabs < 2).length;
    info.push(...tileInfo);
    info.push(`${tiles.length} ${AX[W]} tiles fill in the flat layers. Build along ${AX[A]}: stand ${fA}1, hook the tiles beside it into its slots, push the next ${fA} piece on so the tiles' other tabs go into its slots, and so on. Then slide the ${fB} pieces on as above.` + (glued ? ` ${glued} tile${glued === 1 ? ' has' : 's have'} a tab on one side only: glue ${glued === 1 ? 'it' : 'them'}.` : ''));
  }
  return { parts, notes, info, order };
}

/**
 * Tiles of the third family. Layers: [A planes, B planes, W planes] (voxel layer indexes). Each W plane
 * is cut into cells between the A and B planes; a cell's tile reaches t/2 short of each plane and has a
 * tab into each A plane beside it (the tile on the low side uses the first half of the shared edge, the
 * tile on the high side the second half, so the two tabs share one slot).
 */
function thirdFamily(g, { V, t, A, B, W, N, layers: [LA, LB, LW], extra, tiles, notes }) {
  const m = Math.max(1, 0.6 * t) + 0.2;
  const cellsOf = (L, n) => {
    const out = [];
    const cs = L.map(i => (i + 0.5) * V);
    for (let k = 0; k <= cs.length; k++) out.push([k === 0 ? 0 : cs[k - 1] + t / 2, k === cs.length ? n * V : cs[k] - t / 2, k > 0 ? L[k - 1] : null, k < cs.length ? L[k] : null]);
    return out;
  };
  const cellsA = cellsOf(LA, N[A]), cellsB = cellsOf(LB, N[B]);
  const [P, Q] = [A, B].sort((a, b) => a - b); // tile coordinates
  const rect = (rA, rB) => (P === A ? [rA[0], rB[0], rA[1], rB[1]] : [rB[0], rA[0], rB[1], rA[1]]);
  const vox = (a, b, w) => { const c = [0, 0, 0]; c[A] = a; c[B] = b; c[W] = w; return at(g, c); };
  let dropped = 0;
  LW.forEach((k, num) => {
    const w = (k + 0.5) * V;
    let count = 0;
    cellsA.forEach(([a0, a1, wallLo, wallHi], ia) => cellsB.forEach(([b0, b1]) => {
      if (a1 - a0 < t || b1 - b0 < t) return;
      const keep = [];
      for (let a = Math.floor(a0 / V); a < Math.ceil(a1 / V); a++) for (let b = Math.floor(b0 / V); b < Math.ceil(b1 / V); b++) {
        if (!vox(a, b, k)) continue;
        const ra = [Math.max(a * V, a0), Math.min((a + 1) * V, a1)], rb = [Math.max(b * V, b0), Math.min((b + 1) * V, b1)];
        if (ra[1] - ra[0] > 0.01 && rb[1] - rb[0] > 0.01) keep.push(rect(ra, rb));
      }
      if (!keep.length) return;
      // Tabs into the A planes on either side.
      const tabs = [];
      for (const [wall, high] of [[wallLo, false], [wallHi, true]]) {
        if (wall == null) continue;
        let best = null, run = null;
        for (let b = Math.floor(b0 / V); b <= Math.ceil(b1 / V); b++) {
          if (b < Math.ceil(b1 / V) && vox(wall, b, k)) { if (!run) run = [b, b]; run[1] = b + 1; } else if (run) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; }
        }
        if (!best) continue;
        const y0 = Math.max(best[0] * V, b0) + m, y1 = Math.min(best[1] * V, b1) - m;
        const mid = (y0 + y1) / 2;
        const [s0, s1] = high ? [y0, mid] : [mid, y1]; // high wall: this tile is on its low side, first half
        if (s1 - s0 < 1.5 * t) continue;
        const ac = (wall + 0.5) * V;
        tabs.push({ wall, ra: [ac - t / 2, ac + t / 2], rb: [s0, s1] });
      }
      if (!tabs.length) { dropped++; return; }
      for (const tb of tabs) keep.push(rect(tb.ra, tb.rb));
      const reg = rectRegion(keep, []);
      const outline = reg.outer.slice().sort((x, y) => Math.abs(area(y)) - Math.abs(area(x)))[0];
      if (!outline || Math.abs(area(outline)) < 0.5 * V * V) { dropped++; return; }
      for (const tb of tabs) {
        // the slot in that A piece, in its own coordinates (axes B and W, in index order)
        const [p2] = [B, W].sort((a, b) => a - b);
        const sl = p2 === B ? [tb.rb[0], w - t / 2, tb.rb[1], w + t / 2] : [w - t / 2, tb.rb[0], w + t / 2, tb.rb[1]];
        (extra[tb.wall] = extra[tb.wall] || []).push(sl);
      }
      count++;
      const name = `${AX[W]}${num + 1}-${count}`;
      const o3 = [0, 0, 0]; o3[W] = w;
      const u = E[P], v = E[Q];
      tiles.push({ id: 'vx-' + name.toLowerCase(), name, outline, place: { o: o3, u, v, n: crossV(u, v) }, interval: ia, layer: k, tabs: tabs.length });
    }));
  });
  if (dropped) notes.push(`${dropped} small ${AX[W]} tile${dropped === 1 ? ' was' : 's were'} left out (too small, or no ${AX[A]} piece beside ${dropped === 1 ? 'it' : 'them'} to hold ${dropped === 1 ? 'it' : 'them'}).`);
}

/** A small engraved ID placed in the piece's solid wood, clear of slots. */
function label(text, outline, holes, cuts, V, t, wIsQ) {
  const bb = bbox(outline);
  const cx = (bb.x + bb.x1) / 2, cy = (bb.y + bb.y1) / 2;
  const size = Math.min(5, Math.max(1.5, (V - t) / 2 - 1.2));
  const w = textWidth(text, size), h = size;
  const clear = (x0, y0, x1, y1) => {
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
    if (!pts.every(pt => pointInLoop(pt, outline))) return false;
    if (holes.some(hl => pts.some(pt => pointInLoop(pt, hl)))) return false;
    const m = 0.8;
    return !cuts.some(r => !(x1 + m < r[0] || x0 - m > r[2] || y1 + m < r[1] || y0 - m > r[3]));
  };
  // Try spots on a grid, nearest the middle first
  const cand = [];
  for (let x = bb.x + 1; x + w < bb.x1; x += V / 4) for (let y = bb.y + 1; y + h < bb.y1; y += V / 4) cand.push([x, y, Math.hypot(x + w / 2 - cx, y + h / 2 - cy)]);
  cand.sort((a, b) => a[2] - b[2]);
  for (const [x, y] of cand) if (clear(x, y, x + w, y + h)) return strokeText(text, x + w / 2, y, size);
  return [];
}
