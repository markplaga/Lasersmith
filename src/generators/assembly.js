// Assembly (PRD 4.3): combine boxes with hinges. Each object is a finger-jointed box that hangs off a
// face (a port) of an object before it, by a cross hinge, a pin hinge, a swivel or a fixed glue joint.
// Objects can hang off objects that hang off others, so chains (arm, forearm, hand) pose as a whole.
// The objects live in one hidden parameter (spec, JSON) that the Assembly card edits.

import { buildBox } from './fingerbox.js';
import { makeDesign, makePart } from '../geom/design.js';
import { HINGE_PARAMS, addHinge, portAt, posed, rangeOfMotion, fmtRange } from '../joints/hinge.js';
import { frameToFrame, movePlace, v3, toLocal } from '../geom/frame.js';

export const FACES = ['top', 'bottom', 'front', 'back', 'left', 'right'];
export const OPPOSITE = { top: 'bottom', bottom: 'top', front: 'back', back: 'front', left: 'right', right: 'left' };
export const JOINT_TYPES = [
  { value: 'cross', label: 'Cross hinge (2 axes)' },
  { value: 'pin', label: 'Pin hinge (1 axis)' },
  { value: 'swivel', label: 'Swivel (turns)' },
  { value: 'fixed', label: 'Fixed (glued)' },
];

export const DEFAULT_SPEC = {
  objects: [
    { id: 'base', name: 'Base', w: 120, d: 100, h: 50 },
    { id: 'o2', name: 'Post', w: 60, d: 60, h: 90, parent: 'base', face: 'top', joint: 'swivel', a1: 30 },
    { id: 'o3', name: 'Arm', w: 56, d: 56, h: 100, parent: 'o2', face: 'top', joint: 'cross', a1: 25, a2: 0 },
    { id: 'o4', name: 'Head', w: 80, d: 64, h: 56, parent: 'o3', face: 'top', joint: 'pin', a1: -35 },
  ],
};

/** A spec from the param text, cleaned up: unknown parents and faces are fixed, ids are unique. */
export function parseSpec(text) {
  let spec;
  try { spec = typeof text === 'string' && text ? JSON.parse(text) : text; } catch (e) { spec = null; }
  if (!spec || !Array.isArray(spec.objects) || !spec.objects.length) spec = DEFAULT_SPEC;
  const seen = new Set(), out = [];
  for (const [i, o] of spec.objects.entries()) {
    let id = String(o.id || 'o' + (i + 1));
    while (seen.has(id)) id += '_';
    seen.add(id);
    const q = {
      id,
      name: String(o.name || `Box ${i + 1}`).slice(0, 40),
      w: clamp(+o.w || 60, 30, 600), d: clamp(+o.d || 60, 30, 600), h: clamp(+o.h || 60, 30, 600),
    };
    if (out.length) {
      q.parent = out.some(p => p.id === o.parent) ? o.parent : out[0].id;
      q.face = FACES.includes(o.face) ? o.face : 'top';
      q.childFace = FACES.includes(o.childFace) ? o.childFace : OPPOSITE[q.face];
      q.joint = JOINT_TYPES.some(j => j.value === o.joint) ? o.joint : 'cross';
      q.du = +o.du || 0; q.dv = +o.dv || 0;
      q.spin = [0, 90, 180, 270].includes(+o.spin) ? +o.spin : 0;
      q.a1 = clamp(+o.a1 || 0, -180, 180); q.a2 = clamp(+o.a2 || 0, -180, 180);
    }
    out.push(q);
  }
  return { objects: out };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** The port turned about its normal by deg (0/90/180/270), so the child box can face another way. */
function spun(port, deg) {
  const k = Math.round(deg / 90) % 4;
  let { u, v } = port;
  for (let i = 0; i < k; i++) [u, v] = [v, v3.scale(u, -1)];
  return { ...port, u, v };
}

const romCache = new Map();

export function buildAssembly(spec, p, t) {
  const objs = spec.objects;
  const body = o => 'obj-' + o.id;
  const parts = [], hardware = [], joints = [], notes = [], ports = new Map(), children = new Map();
  for (const o of objs) if (o.parent) children.set(o.parent, [...(children.get(o.parent) || []), o]);
  // Every body that moves with object o: o, its descendants and the crosses between them.
  const below = o => (children.get(o.id) || []).flatMap(c => [body(c), 'x-' + c.id, ...below(c)]);
  for (const [i, o] of objs.entries()) {
    const box = buildBox([o.w, o.d, o.h], t, { finger: p.finger, labels: p.labels, prefix: o.id + '-', title: o.name });
    notes.push(...box.notes);
    if (i === 0) {
      parts.push(...box.parts.map(q => makePart({ ...q, body: body(o), holes: q.holes.slice() })));
      ports.set(o.id, box.ports);
      continue;
    }
    const pp = ports.get(o.parent).find(q => q.name === o.face);
    const portA = { ...pp, o: v3.madd(v3.madd(pp.o, pp.u, o.du), pp.v, o.dv) };
    const B = { ...box, ports: box.ports.map(q => (q.name === o.childFace ? spun(q, o.spin) : q)) };
    const where = `${o.name} on ${objs.find(q => q.id === o.parent).name}`;
    if (o.joint === 'fixed') {
      // Glue o's face flat against the parent's face.
      const pb = B.ports.find(q => q.name === o.childFace);
      const target = { o: portA.o, u: portA.u, v: v3.scale(portA.v, -1), n: v3.scale(portA.n, -1) };
      const M = frameToFrame(pb, target);
      parts.push(...B.parts.map(q => makePart({ ...q, body: body(o), holes: q.holes.slice(), place: movePlace(q.place, M) })));
      ports.set(o.id, box.ports.map(q => ({ ...movePlace(q, M), name: q.name, part: q.part, size: q.size })));
      notes.push(...offFace(pp, o, t, where));
      continue;
    }
    const r = addHinge({ partsA: parts, portA, B, portB: o.childFace, h: { ...p, hinge: o.joint }, t,
      bodies: { A: body(objs.find(q => q.id === o.parent)), B: body(o), X: 'x-' + o.id }, label: o.name });
    parts.push(...r.parts);
    hardware.push(...r.hardware);
    notes.push(...r.notes);
    ports.set(o.id, r.portsB);
    joints.push({ ...r.joint, key: o.id, name: where, carries: below(o), a1: o.a1, a2: o.joint === 'cross' ? o.a2 : 0 });
  }
  // Every face of every object, at rest, with its plate's rest placement (for picking faces in 3D).
  const allPorts = objs.flatMap(o => ports.get(o.id).map(q => ({ ...q, obj: o.id, plate: parts.find(pt => pt.id === q.part).place })));
  return { parts, hardware, joints, notes, ports: allPorts };
}

/** A glued box must sit on the face, not hang past its edge. */
function offFace(pp, o, t, where) {
  const [fu, fv] = pp.size;
  if (Math.abs(o.du) > fu / 2 + t || Math.abs(o.dv) > fv / 2 + t) return [`${where}: the joint point is off the face; bring the offsets back towards 0.`];
  return [];
}

export default {
  id: 'assembly',
  title: 'Assembly: boxes with hinges',
  category: 'Hinges',
  source: 'native',
  description: 'Combine boxes with hinges. Add boxes in the Assembly panel and hang each one off a face of another with a cross hinge, a pin hinge, a swivel or a glued joint. Chains pose as a whole, and every hinge shows how far it can move.',
  tags: ['assembly', 'combine', 'hinge', 'cross hinge', 'ports', 'posable'],
  params: [
    { key: 'spec', label: 'Objects', type: 'text', default: JSON.stringify(DEFAULT_SPEC), group: 'Assembly', hidden: true },
    { key: 'finger', label: 'Finger width', type: 'length', default: 10, min: 3, max: 50, group: 'Boxes' },
    { key: 'labels', label: 'Engrave part names', type: 'bool', default: false, group: 'Boxes' },
    ...HINGE_PARAMS.filter(q => q.key !== 'hinge'),
  ],
  generate(p, material) {
    const t = material.thickness;
    const spec = parseSpec(p.spec);
    const A = buildAssembly(spec, p, t);
    // Range of motion depends on everything but the poses.
    const key = JSON.stringify([t, spec.objects.map(o => ({ ...o, a1: 0, a2: 0 })), ...this.params.filter(q => q.key !== 'spec').map(q => p[q.key])]);
    let ranges = romCache.get(key);
    if (!ranges) {
      ranges = A.joints.map(j => rangeOfMotion(A.parts, j, t, { stepDeg: j.type === 'swivel' ? 10 : 5, maxDeg: 120 }));
      romCache.clear();
      romCache.set(key, ranges);
    }
    A.joints.forEach((j, i) => { j.range = ranges[i]; });
    const pose = posed(A.parts, A.hardware, A.joints);
    const info = A.joints.map(j => `${j.name}: ${j.type === 'swivel' ? 'turns' : j.type === 'cross' ? 'axis 1' : 'swings'} ${fmtRange(j.range.a1)}` + (j.range.a2 ? `, axis 2 ${fmtRange(j.range.a2)}.` : '.'));
    if (A.hardware.length) {
      const lens = new Map();
      for (const q of A.hardware) lens.set(q.len.toFixed(1), (lens.get(q.len.toFixed(1)) || 0) + 1);
      info.push(`Dowels (${p.pinD} mm): ` + [...lens].map(([l, n]) => `${n} x ${l} mm`).join(', ') + '.');
    }
    if (A.joints.some(j => j.type === 'cross')) info.push(`Cross hinges: the nubs turn in ${(Math.SQRT2 * t + p.pinClear).toFixed(1)} mm holes in the arms; slip the four arms onto each cross before pushing their tabs into the box faces.`);
    if (spec.objects.some(o => o.joint === 'fixed')) info.push('Glued joints: glue the two faces together after both boxes are closed.');
    info.push("Glue each hinge arm's tab into its slot before closing that box. Close the boxes from the ends of each chain inwards.");
    return makeDesign({
      title: `Hinged assembly, ${spec.objects.length} box${spec.objects.length === 1 ? '' : 'es'}`,
      generator: { id: 'assembly', params: p },
      material,
      parts: pose.parts,
      hardware: pose.hardware,
      joints: A.joints,
      ports: A.ports,
      notes: A.notes,
      info,
    });
  },
};

/**
 * Where a click on a (posed) part lands, as a spot on an object's face: {obj, face, du, dv}, or null
 * when the part is not a box face. design.ports holds the faces at rest.
 */
export function spotOn(design, part, point) {
  const port = (design.ports || []).find(q => q.part === part.id);
  if (!port) return null;
  const [x, y] = toLocal(part.place, point);
  const P = port.plate;
  const rest = v3.add(v3.add(P.o, v3.scale(P.u, x)), v3.scale(P.v, y));
  const d = v3.sub(rest, port.o);
  const snap = v => Math.round(v);
  return { obj: port.obj, face: port.name, du: snap(v3.dot(d, port.u)), dv: snap(v3.dot(d, port.v)) };
}

/** How far a joint reaches from its centre on the parent's face (slots or swivel disc), plus margin. */
export function jointHalf(joint, p, t) {
  const tabW = Math.max(t, Math.round(p.armW / 2));
  const m = Math.max(1, 0.6 * t) + 0.5;
  if (joint === 'swivel') return Math.max(p.disc || 30, p.pinD + p.pinClear + 4 * t) / 2 + m;
  if (joint === 'pin') return Math.max(1.5 * t + p.gap, tabW / 2) + m;
  if (joint === 'cross') return Math.max(p.cube / 2 + p.gap + t, tabW / 2) + m;
  return 0;
}

/** Keep a picked spot far enough inside the face for the joint to fit. */
export function fitSpot(spot, design, joint, p, t) {
  const port = (design.ports || []).find(q => q.obj === spot.obj && q.name === spot.face);
  if (!port || joint === 'fixed') return spot;
  const h = jointHalf(joint, p, t);
  const lim = k => Math.max(0, port.size[k] / 2 - h);
  const c = (v, k) => Math.max(-lim(k), Math.min(lim(k), v));
  return { ...spot, du: Math.round(c(spot.du, 0)), dv: Math.round(c(spot.dv, 1)) };
}
