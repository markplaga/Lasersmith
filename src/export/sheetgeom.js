// Turns a nested sheet into layered, kerf-compensated paths in sheet coordinates (mm, y-down).
// Layer convention shared with Boxsmith and Polysmith so existing LightBurn libraries keep working:
// red = cut, blue = score, green = line engrave, black = fill engrave. Inner cuts come before outer cuts.

import { compensate } from '../geom/design.js';
import { sheetTransform } from '../geom/nest.js';
import { area } from '../geom/poly.js';

export const LAYERS = {
  fill: { name: 'Fill engrave', color: '#000000', lbIndex: 0, dxfColor: 7, dxfLayer: 'ENGRAVE_FILL' },
  engrave: { name: 'Line engrave', color: '#00A000', lbIndex: 3, dxfColor: 3, dxfLayer: 'ENGRAVE_LINE' },
  score: { name: 'Score', color: '#0000FF', lbIndex: 1, dxfColor: 5, dxfLayer: 'SCORE' },
  cut: { name: 'Cut', color: '#FF0000', lbIndex: 2, dxfColor: 1, dxfLayer: 'CUT' },
};
export const LAYER_ORDER = ['fill', 'engrave', 'score', 'cut'];

/**
 * @returns {{fill: Loop[][], engrave: Path[], score: Path[], cutInner: Path[], cutOuter: Path[], circles: Circle[], labels: Label[]}}
 * Path = {pts, closed}; Circle = {cx, cy, r}
 */
export function sheetGeometry(sheet, design) {
  const out = { fill: [], engrave: [], score: [], cutInner: [], cutOuter: [], circles: [], labels: [] };
  for (const it of sheet.items) {
    const T = sheetTransform(it);
    const g = compensate(it.part, design.kerfApplied ? 0 : design.material.kerf);
    const map = pts => pts.map(T);
    // sheet transform has det -1; re-orient loops so outer cuts run CCW on the sheet as displayed
    const orient = (pts, wantPositive) => (area(pts) > 0) === wantPositive ? pts : pts.slice().reverse();
    out.cutOuter.push({ pts: orient(map(g.outline), true), closed: true });
    for (const h of g.holes) out.cutInner.push({ pts: orient(map(h), false), closed: true });
    for (const c of g.circles) { const p = T([c.cx, c.cy]); out.circles.push({ cx: p[0], cy: p[1], r: c.r }); }
    for (const c of g.cuts) out.cutInner.push({ pts: map(c), closed: false });
    for (const s of g.score) out.score.push({ pts: map(s), closed: false });
    for (const s of g.engrave) out.engrave.push({ pts: map(s), closed: false });
    if (g.fill.length) out.fill.push(g.fill.map(map));
    const c = T([(it.bb.x + it.bb.x1) / 2, (it.bb.y + it.bb.y1) / 2]);
    out.labels.push({ text: it.label, x: c[0], y: c[1], w: it.rot ? it.h : it.w, h: it.rot ? it.w : it.h });
  }
  return out;
}

export const r3 = v => (Math.round(v * 1000) / 1000).toString();
