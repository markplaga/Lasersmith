import assert from 'node:assert/strict';
import asm, { parseSpec, buildAssembly, DEFAULT_SPEC } from '../src/generators/assembly.js';
import { validate } from '../src/geom/validate.js';
import { defaults } from '../src/ui/params.js';
import { posed } from '../src/joints/hinge.js';
import { v3 } from '../src/geom/frame.js';

const mat = { name: 'ply', thickness: 3, kerf: 0.15 };
const P = spec => ({ ...defaults(asm.params), spec: JSON.stringify(spec) });
const errs = d => validate(d).filter(i => i.level === 'error');
const centre = (parts, body) => {
  const pts = parts.filter(p => p.body === body).flatMap(p => p.outline.map(([x, y]) => v3.add(v3.add(p.place.o, v3.scale(p.place.u, x)), v3.scale(p.place.v, y))));
  return [0, 1, 2].map(k => (Math.min(...pts.map(q => q[k])) + Math.max(...pts.map(q => q[k]))) / 2);
};

await test('assembly: default lamp builds clean with a range for every hinge', () => {
  const d = asm.generate(defaults(asm.params), mat);
  assert.equal(errs(d).length, 0, JSON.stringify(errs(d).slice(0, 2)));
  assert.equal(d.joints.length, 3);
  for (const j of d.joints) assert.ok(j.range && j.range.a1[1] > 0, j.name);
});

await test('assembly: spec is cleaned (bad parent, face, joint, duplicate ids)', () => {
  const s = parseSpec(JSON.stringify({ objects: [{ id: 'a', name: 'A' }, { id: 'a', parent: 'zz', face: 'up', joint: 'glue' }] }));
  assert.equal(s.objects[1].id, 'a_');
  assert.equal(s.objects[1].parent, 'a');
  assert.equal(s.objects[1].face, 'top');
  assert.equal(s.objects[1].childFace, 'bottom');
  assert.equal(s.objects[1].joint, 'cross');
  assert.equal(parseSpec('not json').objects.length, DEFAULT_SPEC.objects.length);
});

await test('assembly: posing a joint carries everything hanging below it', () => {
  const spec = parseSpec(JSON.stringify(DEFAULT_SPEC));
  const p = defaults(asm.params);
  const A = buildAssembly(spec, p, 3);
  const rest = posed(A.parts, A.hardware, A.joints.map(j => ({ ...j, a1: 0, a2: 0 })));
  const turned = posed(A.parts, A.hardware, A.joints.map((j, i) => ({ ...j, a1: i === 0 ? 90 : 0, a2: 0 })));
  // The swivel (first joint) turns the post, the arm and the head about the vertical axis.
  const h0 = centre(rest.parts, 'obj-o4'), h1 = centre(turned.parts, 'obj-o4');
  assert.ok(Math.abs(h0[2] - h1[2]) < 1e-6, 'head stays at the same height');
  const b0 = centre(rest.parts, 'obj-base'), b1 = centre(turned.parts, 'obj-base');
  assert.ok(v3.len(v3.sub(b0, b1)) < 1e-9, 'base does not move');
  // Head offset from the swivel axis turns by 90 degrees (axis is vertical through the post).
  const axis = A.joints[0].pivot;
  const r0 = [h0[0] - axis[0], h0[1] - axis[1]], r1 = [h1[0] - axis[0], h1[1] - axis[1]];
  assert.ok(Math.abs(r0[0] * r1[0] + r0[1] * r1[1]) < 1e-6 || Math.hypot(...r0) < 1e-6, 'turned a quarter');
  // A deeper joint composes on top: pin on the head with the swivel turned
  const both = posed(A.parts, A.hardware, A.joints.map((j, i) => ({ ...j, a1: i === 0 ? 90 : i === 2 ? 30 : 0, a2: 0 })));
  assert.equal(errs({ ...asm.generate(P({ objects: spec.objects.map((o, i) => ({ ...o, a1: i === 1 ? 90 : i === 3 ? 30 : 0 })) }), mat) }).length, 0);
  assert.ok(both.parts.length === A.parts.length);
});

await test('assembly: glued box, spin and offsets', () => {
  const spec = { objects: [
    { id: 'body', name: 'Body', w: 120, d: 80, h: 100 },
    { id: 'tag', name: 'Tag', w: 40, d: 40, h: 40, parent: 'body', face: 'front', joint: 'fixed', du: 20 },
    { id: 'arm', name: 'Arm', w: 50, d: 50, h: 90, parent: 'body', face: 'left', childFace: 'top', joint: 'cross', spin: 90, a1: 20 },
  ] };
  const d = asm.generate(P(spec), mat);
  assert.equal(errs(d).length, 0, JSON.stringify(errs(d).slice(0, 2)));
  // The tag's back face is glued on the body's front (y = 0), so the tag is in front: y < 0.
  const c = centre(d.parts, 'obj-tag');
  assert.ok(c[1] < 0 && Math.abs(c[0] - 80) < 1e-6, JSON.stringify(c));
  assert.equal(d.joints.length, 1);
});
