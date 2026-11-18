import assert from 'node:assert/strict';
import coupon from '../src/generators/hingecoupon.js';
import { validate } from '../src/geom/validate.js';
import { defaults } from '../src/ui/params.js';
import { frameToFrame, applyRigid, movePlace, rotAxis, mul } from '../src/geom/frame.js';
import { buildBox } from '../src/generators/fingerbox.js';
import { readme } from '../src/export/formats.js';
import { nest } from '../src/geom/nest.js';
import { bbox } from '../src/geom/poly.js';

const mat = t => ({ name: 'ply', thickness: t, kerf: 0.15 });
const near = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < e);

await test('frames: frameToFrame maps one frame onto another', () => {
  const F = { o: [1, 2, 3], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
  const R = rotAxis([1, 1, 0], 0.7);
  const G = { o: [5, -1, 2], u: mul(R, [0, 0, 1]), v: mul(R, [1, 0, 0]), n: mul(R, [0, 1, 0]) };
  const M = frameToFrame(F, G);
  assert.ok(near(applyRigid(M, F.o), G.o));
  const P = movePlace(F, M);
  assert.ok(near(P.u, G.u) && near(P.v, G.v) && near(P.n, G.n));
});

await test('box ports sit on the outer face with outward normals', () => {
  const b = buildBox([100, 80, 60], 3);
  const top = b.ports.find(p => p.name === 'top'), left = b.ports.find(p => p.name === 'left');
  assert.deepEqual(top.o, [50, 40, 60]); assert.deepEqual(top.n, [0, 0, 1]);
  assert.deepEqual(left.o, [0, 40, 30]); assert.deepEqual(left.n, [-1, 0, 0]);
  for (const p of b.ports) assert.ok(near([p.u[1] * p.v[2] - p.u[2] * p.v[1], p.u[2] * p.v[0] - p.u[0] * p.v[2], p.u[0] * p.v[1] - p.u[1] * p.v[0]], p.n), p.name);
});

await test('hinge coupon: cross and pin hinges validate at rest for several sizes', () => {
  for (const hinge of ['cross', 'pin']) for (const t of [3, 6]) for (const [box, cube, armW] of t === 3 ? [[60, 24, 20], [80, 30, 24], [45, 20, 14]] : [[80, 32, 20], [100, 40, 30]]) {
    const p = { ...defaults(coupon.params), hinge, box, cube: Math.max(cube, 4 * t + 8), armW };
    const d = coupon.generate(p, mat(t));
    const bad = validate(d).filter(i => i.level !== 'info');
    assert.deepEqual(bad, [], `${hinge} t${t} box${box}`);
  }
});

await test('hinge coupon: a face too small for the arms is flagged', () => {
  const d = coupon.generate({ ...defaults(coupon.params), box: 45, cube: 32 }, mat(6));
  assert.ok(d.notes.some(n => /too small for the hinge arms/.test(n)));
});

await test('cross hinge: flat cross with four nubs, round nub holes in the arms, slots match the tabs', () => {
  const p = defaults(coupon.params);
  const d = coupon.generate(p, mat(3));
  const arms = d.parts.filter(q => q.id.startsWith('arm'));
  assert.equal(arms.length, 4);
  // Nubs are t x t: arm holes are the nub diagonal plus clearance
  for (const a of arms) assert.ok(Math.abs(a.circles[0].r - (Math.SQRT2 * 3 + p.pinClear) / 2) < 1e-9);
  const cross = d.parts.filter(q => q.body === 'X');
  assert.equal(cross.length, 1);
  const cb = bbox(cross[0].outline);
  assert.ok(Math.abs(cb.w - (p.cube + 2 * (p.gap + 3 + 1))) < 1e-9 && cb.w === cb.h);
  assert.equal(cross[0].outline.length, 20);
  for (const id of ['a-bottom', 'b-top']) {
    const face = d.parts.find(q => q.id === id);
    assert.equal(face.holes.length, 2, id);
    for (const h of face.holes) {
      const bb = bbox(h);
      assert.deepEqual([bb.w, bb.h].map(v => +v.toFixed(6)).sort((a, b) => a - b), [3, 10], id);
    }
  }
  assert.equal(d.hardware.length, 0);
});

await test('hinge coupon: range of motion is found and posing past it warns (not an error)', () => {
  const base = defaults(coupon.params);
  const d0 = coupon.generate(base, mat(3));
  const r = d0.joints[0].range;
  assert.ok(r.a1[0] <= -30 && r.a1[1] >= 30 && r.a2[0] <= -30 && r.a2[1] >= 30, JSON.stringify(r));
  const inside = coupon.generate({ ...base, pose1: r.a1[1] - 3, pose2: 0 }, mat(3));
  assert.deepEqual(validate(inside).filter(i => i.level !== 'info'), []);
  const past = coupon.generate({ ...base, pose1: r.a1[1] + 25 }, mat(3));
  const iss = validate(past);
  assert.ok(iss.some(i => i.code === 'pose-collision'));
  assert.ok(!iss.some(i => i.level === 'error'));
  const pin = coupon.generate({ ...base, hinge: 'pin' }, mat(3));
  assert.equal(pin.joints[0].range.a2, null);
  assert.ok(pin.joints[0].range.a1[1] >= 20);
});

await test('hinge coupon: posing moves only the lower body and the cross block', () => {
  const base = defaults(coupon.params);
  const a = coupon.generate(base, mat(3)), b = coupon.generate({ ...base, pose1: 20, pose2: -15 }, mat(3));
  a.parts.forEach((p, i) => {
    const q = b.parts[i].place, same = near(p.place.o, q.o, 1e-9) && near(p.place.u, q.u, 1e-9) && near(p.place.v, q.v, 1e-9);
    assert.equal(same, p.body === 'A', p.name);
  });
});

await test('hinge coupon: README lists the dowels', () => {
  const d = coupon.generate({ ...defaults(coupon.params), hinge: 'pin' }, mat(3));
  const txt = readme(nest(d, { sheetW: 914.4, sheetH: 609.6, margin: 5, gap: 3 }), d);
  assert.match(txt, /1 x 6 mm wood dowel, cut to 13\.0 mm/);
  assert.match(txt, /Range of motion/);
});

await test('robot: cross and pin versions are clean, every joint has a range, legs block each other', async () => {
  const robot = (await import('../src/generators/robot.js')).default;
  for (const hinge of ['cross', 'pin']) for (const t of [3, 3.2]) {
    const d = robot.generate({ ...defaults(robot.params), hinge }, mat(t));
    assert.deepEqual(validate(d).filter(i => i.level !== 'info'), [], `${hinge} t${t}`);
    assert.equal(d.joints.length, 5);
    assert.equal(d.hardware.length, hinge === 'cross' ? 1 : 5);
    for (const j of d.joints) assert.ok(j.range.a1[0] <= -30 && j.range.a1[1] >= 30, `${j.label} ${JSON.stringify(j.range)}`);
    if (hinge === 'cross') {
      const L = d.joints.find(j => j.key === 'hipL').range.a2, R = d.joints.find(j => j.key === 'hipR').range.a2;
      assert.ok(Math.min(-L[0], R[1]) < 10 && Math.max(L[1], -R[0]) > 40, `${L} ${R}`);
    }
  }
  const nod = robot.generate({ ...defaults(robot.params), neck: 'hinge' }, mat(3));
  assert.deepEqual(validate(nod).filter(i => i.level !== 'info'), []);
  assert.equal(nod.joints[0].type, 'cross');
  assert.equal(nod.hardware.length, 0);
});

await test('swivel coupon: discs on one dowel, holes snug/loose, turns all the way round', () => {
  const p = { ...defaults(coupon.params), hinge: 'swivel' };
  const d = coupon.generate(p, mat(3));
  assert.deepEqual(validate(d).filter(i => i.level !== 'info'), []);
  assert.equal(d.hardware.length, 1);
  assert.equal(d.hardware[0].len, 4 * 3 + 2);
  assert.equal(d.parts.find(q => q.id === 'a-bottom').circles[0].r, (p.pinD + p.pinClear) / 2);
  assert.equal(d.parts.find(q => q.id === 'b-top').circles[0].r, p.pinD / 2);
  assert.deepEqual(d.joints[0].range.a1, [-180, 180]);
  assert.match(d.info[0], /all the way round/);
  const turned = coupon.generate({ ...p, pose1: 45 }, mat(3));
  assert.deepEqual(validate(turned).filter(i => i.level !== 'info'), []);
});
