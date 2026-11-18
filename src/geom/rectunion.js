// Outline of a union of axis-aligned rectangles minus other rectangles.
// Used by finger-jointed plates: start from the full plate, subtract the strips other plates own.

import { area, clean } from './poly.js';

/**
 * @param {Array<[x0,y0,x1,y1]>} keep rectangles to fill
 * @param {Array<[x0,y0,x1,y1]>} cut rectangles to remove (applied after keep)
 * @returns {{outer: Array, holes: Array}} CCW outer loops and CW hole loops
 */
export function rectRegion(keep, cut = []) {
  // Snap to 1e-6 mm so breakpoints computed along different edges (1 ulp apart) merge.
  const q = v => Math.round(v * 1e6) / 1e6;
  keep = keep.map(r => r.map(q));
  cut = cut.map(r => r.map(q));
  const xs = new Set(), ys = new Set();
  for (const r of keep.concat(cut)) { xs.add(r[0]); xs.add(r[2]); ys.add(r[1]); ys.add(r[3]); }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const nx = X.length - 1, ny = Y.length - 1;
  const fill = new Uint8Array(Math.max(0, nx * ny));
  const ix = v => X.indexOf(v), iy = v => Y.indexOf(v);
  const mark = (r, val) => {
    const i0 = ix(r[0]), i1 = ix(r[2]), j0 = iy(r[1]), j1 = iy(r[3]);
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) fill[j * nx + i] = val;
  };
  keep.forEach(r => mark(r, 1));
  cut.forEach(r => mark(r, 0));
  const at = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && fill[j * nx + i] === 1;

  // Directed boundary edges with the filled region on the left (CCW around solids, CW around holes).
  const edges = new Map(); // "i,j" start vertex -> list of [i2,j2]
  const push = (a, b) => { const k = a[0] + ',' + a[1]; if (!edges.has(k)) edges.set(k, []); edges.get(k).push(b); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) push([i, j], [i + 1, j]);
    if (!at(i + 1, j)) push([i + 1, j], [i + 1, j + 1]);
    if (!at(i, j + 1)) push([i + 1, j + 1], [i, j + 1]);
    if (!at(i - 1, j)) push([i, j + 1], [i, j]);
  }
  const loops = [];
  for (const [k, list] of edges) {
    while (list.length) {
      const start = k.split(',').map(Number);
      const loop = [start];
      let prev = start, cur = list.pop();
      let guard = 0;
      while (!(cur[0] === start[0] && cur[1] === start[1]) && guard++ < 1e6) {
        loop.push(cur);
        const outs = edges.get(cur[0] + ',' + cur[1]);
        // At a pinch vertex pick the left-most turn so loops stay simple.
        let best = 0;
        if (outs.length > 1) {
          const din = [cur[0] - prev[0], cur[1] - prev[1]];
          let bestScore = -Infinity;
          outs.forEach((o, idx) => {
            const d = [o[0] - cur[0], o[1] - cur[1]];
            const score = din[0] * d[1] - din[1] * d[0];
            if (score > bestScore) { bestScore = score; best = idx; }
          });
        }
        prev = cur;
        cur = outs.splice(best, 1)[0];
      }
      loops.push(loop.map(([i, j]) => [X[i], Y[j]]));
    }
  }
  const outer = [], holes = [];
  for (const l of loops) {
    const c = clean(l);
    if (c.length < 3) continue;
    (area(c) > 0 ? outer : holes).push(c);
  }
  return { outer, holes };
}
