// Sheet nesting: MaxRects (best short-side fit) on part bounding boxes, with 90-degree rotation,
// filling as many sheets as needed. Sheet coordinates are y-down (as SVG), origin top-left.

import { bbox } from './poly.js';
import { instances } from './design.js';

function packSheet(items, W, H, gap, allowRot) {
  let free = [{ x: 0, y: 0, w: W, h: H }];
  const placed = [], rest = [];
  for (const it of items) {
    const iw = it.w + gap, ih = it.h + gap;
    let best = null;
    for (const f of free) {
      for (const rot of allowRot ? [false, true] : [false]) {
        const w = rot ? ih : iw, h = rot ? iw : ih;
        if (w <= f.w + 1e-9 && h <= f.h + 1e-9) {
          const score = Math.min(f.w - w, f.h - h), score2 = Math.max(f.w - w, f.h - h);
          if (!best || score < best.score || (score === best.score && score2 < best.score2)) best = { f, rot, w, h, score, score2 };
        }
      }
    }
    if (!best) { rest.push(it); continue; }
    const r = { x: best.f.x, y: best.f.y, w: best.w, h: best.h };
    placed.push({ ...it, x: r.x, y: r.y, rot: best.rot });
    // Split every free rect that overlaps r (MaxRects)
    const next = [];
    for (const f of free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) { next.push(f); continue; }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
    }
    free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y)));
  }
  return { placed, rest };
}

/**
 * @param design Design document
 * @param opts {sheetW, sheetH, margin, gap, rotate}
 * @returns {sheets: [{w, h, items: [{part, label, x, y, rot, bb}]}], oversize: [...]}
 * Item placement: sheet point = rot ? (x + (p.y - bb.y), y + (p.x - bb.x)) : (x + p.x - bb.x, y + bb.y1 - p.y) with kerf pad; see sheetTransform.
 */
export function nest(design, { sheetW = 914.4, sheetH = 609.6, margin = 5, gap = 3, rotate = true } = {}) {
  const pad = design.kerfApplied ? 0 : design.material.kerf / 2;
  const items = instances(design).map(inst => {
    const bb = bbox(inst.part.outline);
    return { ...inst, bb, pad, w: bb.w + 2 * pad, h: bb.h + 2 * pad };
  }).sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  const W = sheetW - 2 * margin + gap, H = sheetH - 2 * margin + gap;
  const sheets = [], oversize = [];
  let todo = items.filter(it => {
    const fits = (it.w <= W - gap && it.h <= H - gap) || (rotate && it.h <= W - gap && it.w <= H - gap);
    if (!fits) oversize.push(it);
    return fits;
  });
  while (todo.length) {
    const { placed, rest } = packSheet(todo, W, H, gap, rotate);
    if (!placed.length) break;
    sheets.push({ w: sheetW, h: sheetH, items: placed.map(p => ({ ...p, x: p.x + margin, y: p.y + margin })) });
    todo = rest;
  }
  // Oversize parts still get their own sheet so they can be inspected (export stays blocked by validation).
  for (const it of oversize) {
    sheets.push({ w: Math.max(sheetW, it.w + 2 * margin), h: Math.max(sheetH, it.h + 2 * margin), oversize: true, items: [{ ...it, x: margin, y: margin, rot: false }] });
  }
  return { sheets, oversize };
}

/** Function mapping part coords (y-up) to sheet coords (y-down) for a nested item. */
export function sheetTransform(item) {
  const { bb, pad, x, y, rot } = item;
  if (!rot) return p => [x + pad + (p[0] - bb.x), y + pad + (bb.y1 - p[1])];
  // Rotated 90 degrees: part x runs down the sheet, part y runs across it.
  return p => [x + pad + (p[1] - bb.y), y + pad + (p[0] - bb.x)];
}
