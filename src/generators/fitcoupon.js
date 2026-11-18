// Kerf / fit coupon: a comb whose slots are each compensated for a different kerf, plus a
// finger-joint pair cut at the current kerf. Cut it, push an offcut into each slot, and the slot that
// grips firmly is your kerf.

import { makeDesign } from '../geom/design.js';
import { offsetLoop } from '../geom/poly.js';
import { strokeText } from '../geom/strokefont.js';
import { fingerSegments } from './fingerbox.js';

export default {
  id: 'fit-coupon',
  title: 'Kerf and fit coupon',
  category: 'Calibration',
  source: 'native',
  description: 'Cut this first on a new material. Each comb slot is compensated for a different kerf; the snug one is your kerf. The finger pair checks a real joint at your current setting.',
  tags: ['kerf', 'calibration', 'test'],
  params: [
    { key: 'slots', label: 'Slots', type: 'int', default: 7, min: 3, max: 11, group: 'Comb' },
    { key: 'step', label: 'Kerf step', type: 'number', default: 0.03, min: 0.01, max: 0.1, step: 0.01, unit: 'mm', group: 'Comb', help: 'Difference in kerf between neighbouring slots.' },
    { key: 'depth', label: 'Slot depth', type: 'length', default: 12, min: 5, max: 30, group: 'Comb' },
    { key: 'pair', label: 'Finger-joint pair', type: 'bool', default: true, group: 'Joint' },
  ],
  generate(p, material) {
    const t = material.thickness, k = material.kerf;
    const n = Math.max(3, Math.round(p.slots) | 1), pitch = Math.max(12, t + 9), H = p.depth + 14;
    const W = n * pitch + 8;
    // Comb outline (nominal), slots opening from the top edge. Each slot pre-compensated for its own kerf.
    const pts = [[0, 0], [W, 0], [W, H]];
    const labels = [];
    const ks = [];
    for (let i = n - 1; i >= 0; i--) {
      const ki = Math.max(0, k + (i - (n - 1) / 2) * p.step);
      ks[i] = ki;
      const cx = 4 + pitch * (i + 0.5);
      // Slot cut at nominal t, then shrunk by ki/2 per side, then the whole comb is grown by k/2 below.
      // Net slot width after cutting with the real kerf kr: t - ki + kr. Snug when ki == kr.
      const sw = t - ki + k; // width before the global grow (which removes k)
      pts.push([cx + sw / 2, H], [cx + sw / 2, H - p.depth], [cx - sw / 2, H - p.depth], [cx - sw / 2, H]);
    }
    pts.push([0, H]);
    const comb = offsetLoop(pts, k / 2);
    ks.forEach((ki, i) => labels.push(...strokeText(ki.toFixed(2), 4 + pitch * (i + 0.5), 3, Math.min(4, pitch / 4.5))));
    labels.push(...strokeText(`T${t} K${k}`, W / 2, H - p.depth - 6.5, 3));
    const parts = [{ id: 'comb', name: 'Kerf comb', outline: comb, engrave: labels, kerfApplied: true }];
    if (p.pair) {
      const L = 40, D = 25;
      for (const [id, own] of [['a', 0], ['b', 1]]) {
        const out = [[0, 0], [L, 0]];
        const segs = fingerSegments(0, L, Math.max(1.5 * t, 6), t);
        for (const [a, b, i] of segs.slice().reverse()) {
          const y = i % 2 === own ? D : D - t;
          out.push([b, y], [a, y]);
        }
        parts.push({ id: 'pair-' + id, name: 'Joint ' + id.toUpperCase(), outline: dedupe(out), engrave: strokeText(id.toUpperCase(), L / 2, 5, 6) });
      }
    }
    return makeDesign({ title: `Kerf coupon ${t} mm`, generator: { id: 'fit-coupon', params: p }, material, parts });
  },
};

function dedupe(pts) {
  return pts.filter((q, i) => { const r = pts[(i + 1) % pts.length]; return Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-9; });
}
