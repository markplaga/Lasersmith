// Validation for every design (native, boxes.py, later Claude-made). Errors block export; warnings don't.

import { bbox, circleLoop, pointInLoop, segSegDist, selfIntersection, offsetLoop, segmentGrid, area } from './poly.js';
import { toWorld } from './design.js';

export const DEFAULT_RULES = { bedW: 914.4, bedH: 609.6, margin: 5, minBridgeFactor: 0.6, collision: true };

/**
 * @returns {Array<{level: 'error'|'warn'|'info', code: string, msg: string, part?: string}>}
 */
export function validate(design, rules = {}) {
  const R = { ...DEFAULT_RULES, ...rules };
  const issues = [];
  const t = design.material.thickness;
  const minBridge = R.minBridge ?? Math.max(1, t * R.minBridgeFactor);
  for (const part of design.parts) {
    const P = part.name;
    if (!part.outline || part.outline.length < 3) { issues.push({ level: 'error', code: 'open', msg: 'Part has no closed outline.', part: P }); continue; }
    if (Math.abs(area(part.outline)) < 1e-6) issues.push({ level: 'error', code: 'degenerate', msg: 'Outline has zero area.', part: P });
    const si = selfIntersection(part.outline);
    if (si) issues.push({ level: 'error', code: 'self-intersect', msg: `Outline crosses itself near (${si.at[0].toFixed(1)}, ${si.at[1].toFixed(1)}).`, part: P });
    part.holes.forEach((h, i) => {
      if (selfIntersection(h)) issues.push({ level: 'error', code: 'self-intersect', msg: `Hole ${i + 1} crosses itself.`, part: P });
      if (!pointInLoop(h[0], part.outline)) issues.push({ level: 'warn', code: 'hole-outside', msg: `Hole ${i + 1} is not inside the outline.`, part: P });
    });
    // Bed fit, after kerf growth
    const bb = bbox(part.outline), k = part.kerfApplied ? 0 : design.material.kerf;
    const w = bb.w + k, h = bb.h + k, W = R.bedW - 2 * R.margin, H = R.bedH - 2 * R.margin;
    if (!((w <= W && h <= H) || (h <= W && w <= H))) {
      issues.push({ level: 'error', code: 'too-big', msg: `${w.toFixed(1)} x ${h.toFixed(1)} mm does not fit the ${R.bedW.toFixed(0)} x ${R.bedH.toFixed(0)} mm bed (margin ${R.margin} mm). Split it or shrink the design.`, part: P });
    }
    // Thin bridges between cut loops of the same part
    const loops = [part.outline, ...part.holes, ...part.circles.map(c => circleLoop(c.cx, c.cy, c.r, 0.1))];
    const thin = thinBridge(loops, minBridge);
    if (thin) issues.push({ level: 'warn', code: 'thin-bridge', msg: `Wood between cuts is only ${thin.d.toFixed(2)} mm (minimum ${minBridge.toFixed(1)} mm) near (${thin.at[0].toFixed(1)}, ${thin.at[1].toFixed(1)}). It may snap or burn through.`, part: P });
    // Kerf compensation must not fold small features over
    if (!part.kerfApplied && design.material.kerf > 0) {
      const grown = offsetLoop(part.outline, design.material.kerf / 2);
      if (!si && selfIntersection(grown)) issues.push({ level: 'warn', code: 'kerf-fold', msg: 'A feature is smaller than the kerf; compensation folds it over.', part: P });
    }
  }
  if (R.collision && design.parts.filter(p => p.place).length > 1) {
    const posed = (design.joints || []).some(j => j.a1 || j.a2);
    const bodyOf = new Map(design.parts.map(p => [p.name, p.body]));
    for (const c of collisions(design)) {
      const at = c.at.map(v => v.toFixed(1)).join(', ');
      // Parts that only meet because a joint is posed past its range: the cut files are still fine.
      if (posed && bodyOf.get(c.a) !== bodyOf.get(c.b)) issues.push({ level: 'warn', code: 'pose-collision', msg: `At this pose ${c.a} hits ${c.b} near (${at}) mm. Bring the pose back inside the range of motion.`, part: c.a });
      else issues.push({ level: 'error', code: 'collision', msg: `${c.a} and ${c.b} overlap in 3D near (${at}) mm.`, part: c.a });
    }
  }
  for (const n of design.notes || []) issues.push({ level: 'warn', code: 'note', msg: n });
  for (const n of design.info || []) issues.push({ level: 'info', code: 'info', msg: n });
  return issues;
}

export function hasErrors(issues) { return issues.some(i => i.level === 'error'); }

/** Smallest distance between two different loops of a part, if under min. */
export function thinBridge(loops, min) {
  if (loops.length < 2) return null;
  const segs = [], owner = [];
  loops.forEach((l, li) => l.forEach((p, i) => { segs.push([p, l[(i + 1) % l.length]]); owner.push(li); }));
  // Grow each segment's box by min so near pairs share a cell.
  const grown = segs.map(s => [[Math.min(s[0][0], s[1][0]) - min, Math.min(s[0][1], s[1][1]) - min], [Math.max(s[0][0], s[1][0]) + min, Math.max(s[0][1], s[1][1]) + min]]);
  const grid = segmentGrid(grown, Math.max(min * 2, 2));
  let best = null;
  const seen = new Set();
  for (const b of grid.values()) {
    for (let x = 0; x < b.length; x++) for (let y = x + 1; y < b.length; y++) {
      const i = b[x], j = b[y];
      if (owner[i] === owner[j]) continue;
      const key = i < j ? i * segs.length + j : j * segs.length + i;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = segSegDist(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
      if (d < min && (!best || d < best.d)) best = { d, at: segs[i][0] };
    }
  }
  return best;
}

function worldAABB(part, t) {
  const bb = bbox(part.outline);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const x of [bb.x, bb.x1]) for (const y of [bb.y, bb.y1]) for (const w of [-t / 2, t / 2]) {
    const p = toWorld(part.place, x, y, w);
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  return { lo, hi };
}

function inside(part, pt, insetLoops) {
  if (!pointInLoop(pt, insetLoops.outline)) return false;
  for (const h of insetLoops.holes) if (pointInLoop(pt, h)) return false;
  for (const c of part.circles) if (Math.hypot(pt[0] - c.cx, pt[1] - c.cy) < c.r + insetLoops.e) return false;
  return true;
}

/** Sample each placed part's volume and test the points against every other part's volume. */
export function collisions(design, { eps = 0.05, step } = {}) {
  const placed = design.parts.filter(p => p.place);
  return collisionPairs(design.material.thickness, placed, (i, j) => j > i ? [placed[i], placed[j]] : null, { eps, step });
}

/** Collisions only between parts of two groups (e.g. two bodies of a posed joint). Stops at the first hit if `first`. */
export function collisionsBetween(t, groupA, groupB, { eps = 0.05, step, first = false } = {}) {
  const all = groupA.concat(groupB), n = groupA.length;
  return collisionPairs(t, all, (i, j) => (i < n && j >= n ? [all[i], all[j]] : null), { eps, step, first });
}

function collisionPairs(t, placed, pairOf, { eps, step, first }) {
  const h = step || Math.max(0.4, Math.min(1.5, t / 2));
  const inset = new Map(placed.map(p => {
    const th = p.thickness || t;
    return [p, { outline: offsetLoop(p.outline, -eps), holes: p.holes.map(l => offsetLoop(l, eps)), e: eps, th, box: worldAABB(p, th) }];
  }));
  const hits = [];
  for (let i = 0; i < placed.length; i++) for (let j = 0; j < placed.length; j++) {
    const pr = pairOf(i, j);
    if (!pr) continue;
    const hit = pairHit(pr[0], pr[1], inset.get(pr[0]), inset.get(pr[1]), h, eps);
    if (hit) { hits.push(hit); if (first) return hits; }
  }
  return hits;
}

function pairHit(A, B, IA, IB, h, eps) {
  const lo = [0, 1, 2].map(k => Math.max(IA.box.lo[k], IB.box.lo[k]));
  const hi = [0, 1, 2].map(k => Math.min(IA.box.hi[k], IB.box.hi[k]));
  if (lo.some((v, k) => v >= hi[k] - eps)) return null;
  // Intersection box corners in A's local frame bound the sample window
  const { o, u, v } = A.place;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const X of [lo[0], hi[0]]) for (const Y of [lo[1], hi[1]]) for (const Z of [lo[2], hi[2]]) {
    const d = [X - o[0], Y - o[1], Z - o[2]];
    const lx = d[0] * u[0] + d[1] * u[1] + d[2] * u[2], ly = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); y0 = Math.min(y0, ly); y1 = Math.max(y1, ly);
  }
  const ws = [-IA.th / 2 + eps, 0, IA.th / 2 - eps];
  for (let x = x0 + h * 0.37; x < x1; x += h) for (let y = y0 + h * 0.41; y < y1; y += h) {
    if (!inside(A, [x, y], IA)) continue;
    for (const w of ws) {
      const P = toWorld(A.place, x, y, w);
      const B0 = B.place.o, d = [P[0] - B0[0], P[1] - B0[1], P[2] - B0[2]];
      const bw = d[0] * B.place.n[0] + d[1] * B.place.n[1] + d[2] * B.place.n[2];
      if (Math.abs(bw) >= IB.th / 2 - eps) continue;
      const bx = d[0] * B.place.u[0] + d[1] * B.place.u[1] + d[2] * B.place.u[2];
      const by = d[0] * B.place.v[0] + d[1] * B.place.v[1] + d[2] * B.place.v[2];
      if (inside(B, [bx, by], IB)) return { a: A.name, b: B.name, at: P };
    }
  }
  return null;
}
