// boxes.py render output (polylines grouped by part, from bridge.py) -> Lasersmith Design document.
// boxes.py has already applied kerf ("burn"), so parts are marked kerfApplied.

import { area, dist, pointInLoop, bbox, untangle } from '../geom/poly.js';
import { makeDesign } from '../geom/design.js';

const CLOSE_TOL = 0.1; // boxes.py sometimes leaves a few hundredths of a mm open where a loop should close

function isClosed(pts) { return pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < CLOSE_TOL; }

/** Join open cut polylines whose ends meet into longer chains (and close them when they loop). */
export function joinPaths(paths) {
  const open = paths.map(p => p.slice());
  const out = [];
  while (open.length) {
    let cur = open.pop();
    let grew = true;
    while (grew && !isClosed(cur)) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i], a = cur[0], b = cur[cur.length - 1];
        if (dist(b, o[0]) < CLOSE_TOL) cur = cur.concat(o.slice(1));
        else if (dist(b, o[o.length - 1]) < CLOSE_TOL) cur = cur.concat(o.slice(0, -1).reverse());
        else if (dist(a, o[o.length - 1]) < CLOSE_TOL) cur = o.concat(cur.slice(1));
        else if (dist(a, o[0]) < CLOSE_TOL) cur = o.slice().reverse().concat(cur.slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * @param result {parts: [{paths: [{layer, pts}]}]} from bridge.run
 * @param meta {entry, params, material}
 */
export function boxesToDesign(result, { entry, params, material }) {
  const parts = [];
  let n = 0;
  result.parts.forEach(bp => {
    const cutPaths = joinPaths(bp.paths.filter(p => p.layer === 'cut').map(p => p.pts));
    const loops = [], openCuts = [];
    for (const p of cutPaths) {
      if (isClosed(p)) { const l = untangle(p.slice(0, -1)); if (l.length > 2) loops.push(l); }
      else openCuts.push(p);
    }
    // Containment tree: depth 0 = outline, 1 = hole, 2 = island inside a hole (its own part), ...
    loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
    const parent = loops.map(() => -1), depth = loops.map(() => 0);
    loops.forEach((l, i) => {
      for (let j = i - 1; j >= 0; j--) {
        if (pointInLoop(l[0], loops[j]) && pointInLoop(l[Math.floor(l.length / 2)], loops[j])) { parent[i] = j; depth[i] = depth[j] + 1; break; }
      }
    });
    const local = [];
    loops.forEach((l, i) => {
      if (depth[i] % 2 === 0) {
        const id = ++n;
        local.push({ idx: i, part: { id: 'p' + id, name: 'Part ' + id, outline: l, holes: [], cuts: [], score: [], engrave: [] } });
      }
    });
    const ownerOf = pt => {
      // innermost outline containing the point
      let best = null;
      for (const L of local) if (pointInLoop(pt, loops[L.idx]) && (!best || Math.abs(area(loops[L.idx])) < Math.abs(area(loops[best.idx])))) best = L;
      return best || local[0];
    };
    loops.forEach((l, i) => {
      if (depth[i] % 2 === 1) {
        const L = local.find(x => x.idx === parent[i]);
        if (L) L.part.holes.push(l);
      }
    });
    for (const c of openCuts) { const L = ownerOf(c[0]); if (L) L.part.cuts.push(c); }
    for (const p of bp.paths) {
      if (p.layer === 'cut') continue;
      const L = ownerOf(p.pts[0]);
      if (L) L.part[p.layer === 'score' ? 'score' : 'engrave'].push(p.pts);
    }
    local.forEach(L => parts.push(L.part));
  });
  // Name parts by size so the parts list reads well
  const sorted = parts.slice().sort((a, b) => Math.abs(area(b.outline)) - Math.abs(area(a.outline)));
  sorted.forEach((p, i) => {
    const bb = bbox(p.outline);
    p.name = `${entry.cls} ${i + 1} (${Math.round(bb.w)}x${Math.round(bb.h)})`;
  });
  return makeDesign({
    title: entry.title,
    generator: { id: entry.id, params, source: 'boxes.py', module: entry.module, cls: entry.cls },
    material,
    parts,
    kerfApplied: true,
    notes: [],
  });
}
