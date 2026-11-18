import assert from 'node:assert/strict';
import { makeGrid, set, encode, decode, fromFunction, FIGURES, count } from '../src/voxel/grid.js';
import { sculpt, planeLayers } from '../src/voxel/slice.js';
import voxel from '../src/generators/voxel.js';
import { validate, collisions } from '../src/geom/validate.js';
import { makeDesign } from '../src/geom/design.js';
import { defaults } from '../src/ui/params.js';
import { area } from '../src/geom/poly.js';

const mat = { name: 'ply', thickness: 3, kerf: 0.15 };

await test('voxel grid: encode/decode round trip', () => {
  const g = fromFunction(7, 5, 9, (x, y, z) => (x + y * 2 + z * 3) % 4 === 0);
  const h = decode(encode(g));
  assert.deepEqual([h.nx, h.ny, h.nz], [7, 5, 9]);
  assert.deepEqual([...h.cells], [...g.cells]);
  assert.throws(() => decode('nonsense'));
});

await test('voxel slice: a solid block becomes a half-lapped egg crate with no 3D overlap', () => {
  const g = makeGrid(4, 3, 5);
  for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 5; z++) set(g, x, y, z);
  const V = 12, t = 3;
  const r = sculpt(g, { voxel: V, families: [0, 1], spacing: 1, t, labels: true });
  assert.equal(r.parts.length, 7);
  const d = makeDesign({ title: 'b', material: mat, parts: r.parts });
  assert.deepEqual(collisions(d), []);
  // X piece: full 3x5 cell rectangle minus three t-wide slots from mid-height to the top
  const x1 = d.parts.find(p => p.name === 'X1');
  assert.ok(Math.abs(Math.abs(area(x1.outline)) - (3 * V * 5 * V - 3 * t * 2.5 * V)) < 1e-6);
  const y1 = d.parts.find(p => p.name === 'Y1');
  assert.ok(Math.abs(Math.abs(area(y1.outline)) - (4 * V * 5 * V - 4 * t * 2.5 * V)) < 1e-6);
  assert.ok(x1.engrave.length > 0, 'labelled');
  assert.deepEqual(planeLayers(g, 0, 2), [0, 2]);
});

await test('voxel sculpture: every figure and piece direction validates with no overlap', () => {
  for (const figure of Object.keys(FIGURES)) for (const families of ['xy', 'xz', 'yz']) for (const spacing of [1, 2]) {
    const d = voxel.generate({ ...defaults(voxel.params), figure, families, spacing }, mat);
    assert.ok(d.parts.length > 3, `${figure} ${families}`);
    assert.deepEqual(validate(d).filter(i => i.level === 'error'), [], `${figure} ${families} ${spacing}`);
  }
});

await test('voxel sculpture: custom grid from the editor is used; empty grid is flagged', () => {
  const g = fromFunction(6, 6, 6, (x, y, z) => Math.hypot(x - 3, y - 3, z - 3) < 2.8);
  const d = voxel.generate({ ...defaults(voxel.params), figure: 'custom', grid: encode(g) }, mat);
  assert.equal(d.title, 'My voxel figure sculpture');
  assert.ok(d.parts.length >= 4);
  const e = voxel.generate({ ...defaults(voxel.params), figure: 'custom', grid: encode(makeGrid(4, 4, 4)) }, mat);
  assert.ok(e.notes.some(n => /empty/.test(n)));
  assert.equal(count(FIGURES.cat.make()) > 100, true);
});
