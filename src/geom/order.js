// Assembly order (PRD 4.4 / 10): the order parts go together, used by the "assemble" animation and the
// assembly guide. A design can give its own (design.order: part ids); otherwise parts are built from
// the bottom up (by the height of each part's middle), keeping the design's own order for parts at the same height.

import { toWorld } from './design.js';

/** Height of a placed part's middle, in world z (floors before walls before lids). */
function midZ(p) {
  let lo = Infinity, hi = -Infinity;
  for (const [x, y] of p.outline) { const z = toWorld(p.place, x, y)[2]; lo = Math.min(lo, z); hi = Math.max(hi, z); }
  return (lo + hi) / 2;
}

/** Placed parts in assembly order. */
export function assemblyOrder(design) {
  const placed = design.parts.filter(p => p.place);
  if (Array.isArray(design.order) && design.order.length) {
    const at = new Map(design.order.map((id, i) => [id, i]));
    return placed.map((p, i) => [p, at.has(p.id) ? at.get(p.id) : 1e6 + i]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
  }
  return placed.map((p, i) => ({ p, i, z: Math.round(midZ(p) * 2) / 2 })).sort((a, b) => a.z - b.z || a.i - b.i).map(a => a.p);
}
