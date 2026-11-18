import assert from 'node:assert/strict';
import { area, offsetLoop, selfIntersection, rect, pointInLoop, circleLoop, bbox } from '../src/geom/poly.js';
import { rectRegion } from '../src/geom/rectunion.js';
import { strokeText, textWidth } from '../src/geom/strokefont.js';

await test('area sign and offset grows CCW and CW loops alike', () => {
  const sq = rect(0, 0, 10, 10);
  assert.equal(area(sq), 100);
  assert.ok(Math.abs(area(offsetLoop(sq, 1)) - 144) < 1e-9);
  assert.ok(Math.abs(Math.abs(area(offsetLoop(sq.slice().reverse(), 1))) - 144) < 1e-9);
  assert.ok(Math.abs(area(offsetLoop(sq, -1)) - 64) < 1e-9);
});

await test('offset of a notched (finger) outline is exact', () => {
  const L = [[0, 0], [30, 0], [30, 10], [20, 10], [20, 7], [10, 7], [10, 10], [0, 10]];
  const g = offsetLoop(L, 0.075);
  const bb = bbox(g);
  assert.ok(Math.abs(bb.w - 30.15) < 1e-9 && Math.abs(bb.h - 10.15) < 1e-9);
  // notch narrows by kerf: points at y = 7.075 span x 10.075 .. 19.925
  const notch = g.filter(p => Math.abs(p[1] - 7.075) < 1e-9).map(p => p[0]).sort((a, b) => a - b);
  assert.deepEqual(notch.map(v => +v.toFixed(3)), [10.075, 19.925]);
});

await test('self-intersection detection', () => {
  assert.equal(selfIntersection(rect(0, 0, 5, 5)), null);
  assert.ok(selfIntersection([[0, 0], [10, 10], [10, 0], [0, 10]]));
});

await test('rect region: union minus cuts, with a hole', () => {
  const r = rectRegion([[0, 0, 10, 10]], [[4, 4, 6, 6]]);
  assert.equal(r.outer.length, 1);
  assert.equal(r.holes.length, 1);
  assert.equal(area(r.outer[0]), 100);
  assert.equal(area(r.holes[0]), -4);
  const n = rectRegion([[0, 0, 10, 10]], [[0, 8, 3, 10], [7, 8, 10, 10]]);
  assert.equal(n.outer[0].length, 8);
  assert.equal(area(n.outer[0]), 100 - 12);
});

await test('circle loop chord error stays under tolerance', () => {
  const c = circleLoop(0, 0, 50, 0.02);
  const n = c.length, sag = 50 * (1 - Math.cos(Math.PI / n));
  assert.ok(sag <= 0.02 + 1e-9, 'sag ' + sag);
  assert.ok(pointInLoop([0, 0], c));
});

await test('stroke font lays out text centred', () => {
  const lines = strokeText('A1', 0, 0, 6);
  const xs = lines.flat().map(p => p[0]);
  assert.ok(Math.abs(Math.min(...xs) + textWidth('A1', 6) / 2) < 1e-9);
  assert.ok(lines.length >= 3);
});
