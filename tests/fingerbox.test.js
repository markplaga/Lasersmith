import assert from 'node:assert/strict';
import box from '../src/generators/fingerbox.js';
import coupon from '../src/generators/fitcoupon.js';
import { validate, collisions } from '../src/geom/validate.js';
import { area, selfIntersection } from '../src/geom/poly.js';
import { defaults } from '../src/ui/params.js';

const mat = t => ({ name: 'ply', thickness: t, kerf: 0.15 });

await test('finger box: every size/thickness/lid passes validation with no 3D overlap', () => {
  for (const t of [3, 6.2]) for (const lid of ['closed', 'open']) for (const [w, d, h] of [[120, 80, 60], [40, 40, 30], [300, 200, 150], [61.3, 97.7, 44.1]]) for (const finger of [6, 10, 23]) {
    const p = { ...defaults(box.params), width: w, depth: d, height: h, lid, finger };
    const des = box.generate(p, mat(t));
    const issues = validate(des).filter(i => i.level === 'error');
    assert.deepEqual(issues, [], `t${t} ${lid} ${w}x${d}x${h} f${finger}`);
  }
});

await test('finger box: plate volumes add up to the shell volume (no gaps)', () => {
  for (const lid of ['closed', 'open']) {
    const t = 3, X = 120, Y = 80, Z = 60;
    const des = box.generate({ ...defaults(box.params), width: X, depth: Y, height: Z, lid }, mat(t));
    const vol = des.parts.reduce((a, p) => a + area(p.outline) * t, 0);
    const inner = lid === 'closed' ? (X - 2 * t) * (Y - 2 * t) * (Z - 2 * t) : (X - 2 * t) * (Y - 2 * t) * (Z - t);
    assert.ok(Math.abs(vol - (X * Y * Z - inner)) < 1e-6, `${lid}: ${vol} vs ${X * Y * Z - inner}`);
  }
});

await test('finger box: inside dimensions add the walls', () => {
  const des = box.generate({ ...defaults(box.params), width: 100, depth: 50, height: 40, dims: 'inner' }, mat(3));
  assert.deepEqual(des.view.bounds, [106, 56, 46]);
});

await test('finger box: collision check catches a misplaced plate', () => {
  const des = box.generate(defaults(box.params), mat(3));
  const front = des.parts.find(p => p.id === 'front');
  front.place.o = [front.place.o[0], front.place.o[1] + 1, front.place.o[2]];
  assert.ok(collisions(des).length > 0);
});

await test('kerf coupon: slots pre-compensated per kerf, comb is valid', () => {
  const des = coupon.generate(defaults(coupon.params), mat(3));
  const comb = des.parts[0];
  assert.ok(comb.kerfApplied);
  assert.equal(selfIntersection(comb.outline), null);
  // slot widths (at the slot floor) are t - k_i: 3 - 0.06 ... 3 - 0.24 for kerf 0.15 +/- 3 steps of 0.03
  const floorY = Math.min(...comb.outline.filter(p => p[1] > 5).map(p => p[1]));
  const xs = comb.outline.filter(p => Math.abs(p[1] - floorY) < 1e-6).map(p => p[0]).sort((a, b) => a - b);
  const widths = [];
  for (let i = 0; i < xs.length; i += 2) widths.push(+(xs[i + 1] - xs[i]).toFixed(3));
  assert.deepEqual(widths, [2.94, 2.91, 2.88, 2.85, 2.82, 2.79, 2.76]);
  assert.deepEqual(validate(des).filter(i => i.level === 'error'), []);
});
