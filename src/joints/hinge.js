// Moving joints between two boxes (PRD section 7): the cross hinge (Mark's universal joint) and the
// pin hinge (clevis). Everything is built in a joint frame first:
//
//   origin = pivot, ez points from the pivot towards body A, ex = axis 1, ey = axis 2.
//   Body A's face is the plane z = +R, body B's face the plane z = -R.
//
//   Cross hinge: a small open cube (4 finger-jointed walls) sits at the pivot. A's two arms (plates with
//   normal ex) hang down either side of the cube; a dowel pin through each arm and the cube's x-wall
//   gives axis 1. B's two arms (normal ey) come up the other two sides; pins give axis 2.
//   Pin hinge: A's two arms straddle one arm of B; one pin through all three gives a single axis.
//
// Pins are snug in the arm (nominal hole: glue or press them) and loose in the part that turns
// (hole + clearance). Arms end in a tab that passes through a slot in the body's face plate.

import { v3, rotAxis, mulM, mul, rotateAbout, movePlace, applyRigid, frameToFrame, toLocal } from '../geom/frame.js';
import { buildBox } from '../generators/fingerbox.js';
import { collisionsBetween } from '../geom/validate.js';
import { bbox, pointInLoop, circleLoop } from '../geom/poly.js';
import { makePart } from '../geom/design.js';

const DEG = Math.PI / 180;

export const HINGE_PARAMS = [
  { key: 'hinge', label: 'Hinge', type: 'select', default: 'cross', group: 'Hinge', choices: [{ value: 'cross', label: 'Cross hinge (2 axes)' }, { value: 'pin', label: 'Pin hinge (1 axis)' }, { value: 'swivel', label: 'Swivel (turns)' }] },
  { key: 'pinD', label: 'Dowel diameter', type: 'length', default: 6, min: 2, max: 20, group: 'Hinge', help: 'Round wood dowel. Arm holes are cut at this size (snug); the turning part gets the clearance below.' },
  { key: 'pinClear', label: 'Turning clearance', type: 'length', default: 0.3, min: 0, max: 2, step: 0.05, group: 'Hinge', help: 'Added to the hole the dowel turns in.' },
  { key: 'cube', label: 'Cross block size', type: 'length', default: 24, min: 12, max: 120, group: 'Hinge', help: 'Outside size of the small cube at the centre of a cross hinge.' },
  { key: 'armW', label: 'Arm width', type: 'length', default: 20, min: 8, max: 120, group: 'Hinge' },
  { key: 'gap', label: 'Arm gap', type: 'length', default: 1, min: 0.2, max: 5, step: 0.1, group: 'Hinge', help: 'Air gap between an arm and the part it turns against.' },
  { key: 'disc', label: 'Swivel disc diameter', type: 'length', default: 30, min: 12, max: 200, group: 'Hinge', help: 'Swivel only: the washer between the two faces and the keeper disc inside the fixed box.' },
  { key: 'reach', label: 'Extra reach', type: 'length', default: 0, min: 0, max: 100, group: 'Hinge', help: 'Moves the boxes further from the pivot: more range of motion, longer arms.' },
];

/** Arm outline in its own plane: hole at the origin, round tip below, tab of width tabW from v = R to R + t. */
export function armOutline(w, R, t, tabW) {
  const pts = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (Math.PI * i) / n;
    pts.push([(w / 2) * Math.cos(a), (w / 2) * Math.sin(a)]);
  }
  pts.push([w / 2, R], [tabW / 2, R], [tabW / 2, R + t], [-tabW / 2, R + t], [-tabW / 2, R], [-w / 2, R]);
  return pts;
}

/**
 * The hinge's own parts in the joint frame.
 * @returns {parts (with body 'A' | 'B' | 'X'), pins, R, tabs: [{body, part, place, tabW}], notes}
 */
export function hingeParts(h, t) {
  const type = h.hinge || 'cross';
  const s = h.cube, w = h.armW, g = h.gap, dS = h.pinD, dL = h.pinD + h.pinClear;
  const tabW = Math.max(t, Math.round(w / 2));
  const notes = [];
  const EX = [1, 0, 0], EY = [0, 1, 0], EZ = [0, 0, 1], NZ = [0, 0, -1];
  const parts = [], pins = [], faceHoles = [];
  let R;
  if (type === 'cross') {
    if (w > s + 2 * g - 0.5) notes.push(`Arm width ${w} mm is too wide for a ${s} mm cross block: the two pairs of arms would rub. Use at most ${(s + 2 * g - 0.5).toFixed(1)} mm.`);
    if (s / 2 - t - 1 <= dL / 2 + 0.5) notes.push(`The cross block is too small for ${dS} mm dowels.`);
    const xa = s / 2 + g + t / 2;
    R = Math.max((s / 2) * Math.SQRT2, Math.hypot(xa + t / 2, w / 2)) + 1.5 + (h.reach || 0);
    // Cross block: a 4-walled tube s x s x s centred on the pivot, loose holes in every wall.
    const cube = buildBox([s, s, s], t, { faces: ['front', 'back', 'left', 'right'], finger: s / 3 + 0.01, prefix: 'xb-' });
    for (const p of cube.parts) {
      p.place = movePlace(p.place, { R: [EX, EY, EZ], T: [-s / 2, -s / 2, -s / 2] });
      p.circles = [{ cx: s / 2, cy: s / 2, r: dL / 2 }];
      p.name = 'Cross block ' + p.meta.face;
      p.body = 'X';
      parts.push(p);
    }
    for (const sg of [-1, 1]) {
      parts.push({ id: 'armA' + (sg > 0 ? 'R' : 'L'), name: `Arm A ${sg > 0 ? 'right' : 'left'}`, body: 'A', outline: armOutline(w, R, t, tabW), circles: [{ cx: 0, cy: 0, r: dS / 2 }], place: { o: [sg * xa, 0, 0], u: EY, v: EZ, n: EX } });
      parts.push({ id: 'armB' + (sg > 0 ? 'R' : 'L'), name: `Arm B ${sg > 0 ? 'back' : 'front'}`, body: 'B', outline: armOutline(w, R, t, tabW), circles: [{ cx: 0, cy: 0, r: dS / 2 }], place: { o: [0, sg * xa, 0], u: EX, v: NZ, n: EY } });
      // Pin: from 1 mm inside the block wall to 1 mm outside the arm
      const a = s / 2 - t - 1, b = s / 2 + g + t + 1;
      pins.push({ kind: 'dowel', name: 'Dowel (axis 1)', d: dS, len: b - a, c: [sg * (a + b) / 2, 0, 0], axis: EX, body: 'A' });
      pins.push({ kind: 'dowel', name: 'Dowel (axis 2)', d: dS, len: b - a, c: [0, sg * (a + b) / 2, 0], axis: EY, body: 'B' });
    }
  } else if (type === 'swivel') {
    // Stacked discs on one dowel along ez: keeper disc inside A (snug), A's face (loose), washer (loose),
    // B's face (snug). B, the dowel and the keeper turn together.
    const D = Math.max(h.disc || 30, dL + 4 * t);
    R = t / 2;
    const disc = (id, name, z, r, body) => ({ id, name, body, outline: circleLoop(0, 0, D / 2, 0.05), circles: [{ cx: 0, cy: 0, r }], place: { o: [0, 0, z], u: EX, v: EY, n: EZ } });
    parts.push(disc('washer', 'Swivel washer', 0, dL / 2, 'B'));
    parts.push(disc('keeper', 'Swivel keeper', R + 1.5 * t, dS / 2, 'B'));
    const top = R + 2 * t + 1, bot = -R - t - 1;
    pins.push({ kind: 'dowel', name: 'Dowel (swivel)', d: dS, len: top - bot, c: [0, 0, (top + bot) / 2], axis: EZ, body: 'B' });
    faceHoles.push({ body: 'A', c: [0, 0, R + t / 2], r: dL / 2, D }, { body: 'B', c: [0, 0, -R - t / 2], r: dS / 2, D });
  } else {
    const xa = t + g;
    R = Math.hypot(xa + t / 2, w / 2) + 1.5 + (h.reach || 0);
    for (const sg of [-1, 1]) parts.push({ id: 'armA' + (sg > 0 ? 'R' : 'L'), name: `Arm A ${sg > 0 ? 'right' : 'left'}`, body: 'A', outline: armOutline(w, R, t, tabW), circles: [{ cx: 0, cy: 0, r: dS / 2 }], place: { o: [sg * xa, 0, 0], u: EY, v: EZ, n: EX } });
    parts.push({ id: 'armB', name: 'Arm B', body: 'B', outline: armOutline(w, R, t, tabW), circles: [{ cx: 0, cy: 0, r: dL / 2 }], place: { o: [0, 0, 0], u: EY, v: NZ, n: [-1, 0, 0] } });
    const half = 1.5 * t + g + 1;
    pins.push({ kind: 'dowel', name: 'Dowel (hinge pin)', d: dS, len: 2 * half, c: [0, 0, 0], axis: EX, body: 'A' });
  }
  for (let i = 0; i < parts.length; i++) parts[i] = makePart(parts[i]);
  const tabs = parts.filter(p => p.id.startsWith('arm')).map(p => ({ body: p.body, part: p, tabW }));
  return { type, parts, pins, R, tabs, faceHoles, notes, tabW };
}

/** The tab of an arm, as the four corners of its cross-section through the face plate (joint frame). */
function tabCorners(arm, R, t, tabW) {
  const out = [];
  for (const x of [-tabW / 2, tabW / 2]) for (const w of [-t / 2, t / 2]) {
    const p = arm.place;
    out.push(v3.add(v3.add(v3.add(p.o, v3.scale(p.u, x)), v3.scale(p.v, R + t / 2)), v3.scale(p.n, w)));
  }
  return out;
}

/** A box's face port, optionally moved along the face (du along port.u, dv along port.v). */
export function portAt(box, face, du = 0, dv = 0) {
  const p = box.ports.find(q => q.name === face);
  if (!p) throw new Error(`No port "${face}"`);
  return { ...p, o: v3.madd(v3.madd(p.o, p.u, du), p.v, dv) };
}

/**
 * Hang box B off already-placed parts with a hinge.
 * @param o.partsA  placed parts of the fixed side; the face plate named by portA.part gets the arm slots (mutated)
 * @param o.portA   a port frame on that side (see portAt)
 * @param o.B       a buildBox result (box coordinates)   @param o.portB  face name on B
 * @param o.h       hinge params (HINGE_PARAMS keys)      @param o.t  material thickness
 * @param o.bodies  {A, B, X} body names: the fixed side, the moving box, the cross block
 * @param o.label   prefix for hinge part names and ids, e.g. 'Neck'
 * @returns {parts (hinge parts + box B), hardware, joint, notes}
 */
export function addHinge({ partsA, portA, B, portB, h, t, bodies = { A: 'A', B: 'B', X: 'X' }, label = '', nameB = '' }) {
  const pa = portA, pb = B.ports.find(p => p.name === portB);
  const H = hingeParts(h, t);
  const ex = pa.u, ez = v3.scale(pa.n, -1), ey = v3.cross(ez, ex);
  const pivot = v3.madd(pa.o, pa.n, H.R);
  const J = { R: [ex, ey, ez], T: pivot };
  const pre = label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' : '';
  for (const p of H.parts) {
    p.place = movePlace(p.place, J);
    p.body = bodies[p.body];
    p.id = pre + p.id;
    if (label) p.name = `${label} ${p.name[0].toLowerCase()}${p.name.slice(1)}`;
  }
  const pins = H.pins.map(q => ({ ...q, name: label ? `${label} ${q.name.toLowerCase()}` : q.name, body: bodies[q.body], c: applyRigid(J, q.c), axis: mul(J.R, q.axis) }));
  // Box B: its port frame goes onto the joint's B face (z = -R), outward normal towards the pivot.
  const target = { o: v3.madd(pivot, ez, -H.R), u: ex, v: ey, n: ez };
  const MB = frameToFrame(pb, target);
  const partsB = B.parts.map(p => makePart({ ...p, body: bodies.B, holes: p.holes.slice(), place: movePlace(p.place, MB), name: nameB && !p.name.startsWith(nameB) ? `${nameB} ${p.name.toLowerCase()}` : p.name }));
  const notes = [...H.notes];
  // Slots for the arm tabs in each face plate
  for (const tab of H.tabs) {
    const onA = tab.body === 'A'; // hingeParts' own body tag, before renaming
    const face = (onA ? partsA : partsB).find(p => p.id === (onA ? pa.part : pb.part));
    const loc = tabCorners(tab.part, H.R, t, H.tabW).map(c => toLocal(face.place, c));
    const xs = loc.map(c => c[0]), ys = loc.map(c => c[1]);
    const r = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const slot = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    // The slot must sit in the plate's solid middle, clear of the finger joints and other slots.
    const bb = bbox(face.outline);
    const m = t + Math.max(1, 0.6 * t);
    if (r[0] < bb.x + m || r[1] < bb.y + m || r[2] > bb.x1 - m || r[3] > bb.y1 - m || !slot.every(q => pointInLoop(q, face.outline))) {
      notes.push(`${face.name} is too small for the ${label ? label.toLowerCase() + ' ' : ''}hinge arms: make that face larger or the hinge smaller.`);
    }
    face.holes.push(slot);
    face.engrave = []; // the name would run across the slots
  }
  for (const fh of H.faceHoles) {
    const onA = fh.body === 'A';
    const face = (onA ? partsA : partsB).find(p => p.id === (onA ? pa.part : pb.part));
    const [cx, cy] = toLocal(face.place, applyRigid(J, fh.c));
    const bb = bbox(face.outline), m = t + Math.max(1, 0.6 * t);
    if (cx - fh.D / 2 < bb.x + m || cy - fh.D / 2 < bb.y + m || cx + fh.D / 2 > bb.x1 - m || cy + fh.D / 2 > bb.y1 - m) {
      notes.push(`${face.name} is too small for the ${label ? label.toLowerCase() + ' ' : ''}swivel discs: make that face larger or the discs smaller.`);
    }
    face.circles = face.circles.concat([{ cx, cy, r: fh.r }]);
    face.engrave = [];
  }
  const joint = { type: H.type, label, pivot, ex, ey, ez, R: H.R, a1: 0, a2: 0, bodyA: bodies.A, bodyB: bodies.B, bodyX: bodies.X };
  return { parts: [...H.parts, ...partsB], hardware: pins, joint, notes };
}

/** Coupon helper: join box B under box A (both buildBox results), A fixed. */
export function joinBoxes(A, portA, B, portB, h, t) {
  const partsA = A.parts.map(p => makePart({ ...p, body: 'A', holes: p.holes.slice() }));
  const r = addHinge({ partsA, portA: portAt(A, portA), B, portB, h, t });
  return { ...r, parts: [...partsA, ...r.parts] };
}

/** World rotations for a pose: the cross block turns about ex, body B about ex then ey. */
export function poseMotions(joint, a1, a2) {
  if (joint.type === 'swivel') { const RS = rotAxis(joint.ez, a1 * DEG); return { X: rotateAbout(RS, joint.pivot), B: rotateAbout(RS, joint.pivot) }; }
  const R1 = rotAxis(joint.ex, a1 * DEG);
  const RB = joint.type === 'cross' ? mulM(R1, rotAxis(joint.ey, a2 * DEG)) : R1;
  return { X: rotateAbout(R1, joint.pivot), B: rotateAbout(RB, joint.pivot) };
}

/** Pose parts and pins: each joint moves its body B and its cross block by the joint's own (a1, a2). */
export function posed(parts, hardware, joints) {
  const mv = new Map();
  for (const j of joints) {
    if (!j.a1 && !j.a2) continue;
    const M = poseMotions(j, j.a1 || 0, j.type === 'cross' ? j.a2 || 0 : 0);
    mv.set(j.bodyB, M.B);
    if (j.type === 'cross') mv.set(j.bodyX, M.X);
  }
  return {
    parts: parts.map(p => { const m = mv.get(p.body); return m ? { ...p, place: movePlace(p.place, m) } : p; }),
    hardware: hardware.map(q => { const m = mv.get(q.body); return m ? { ...q, c: applyRigid(m, q.c), axis: mul(m.R, q.axis) } : q; }),
  };
}

/**
 * Range of motion of one joint: sweep each axis (the other at 0, every other joint at rest) until the
 * moving box or cross block touches anything else.
 * @returns {a1: [min, max], a2: [min, max] | null}
 */
export function rangeOfMotion(parts, joint, t, { stepDeg = 3, maxDeg = 150 } = {}) {
  if (joint.type === 'swivel') maxDeg = 180;
  const sweep = (axis, dir) => {
    let ok = 0;
    for (let a = stepDeg; a <= maxDeg; a += stepDeg) {
      const ang = dir * a;
      const P = posed(parts, [], [{ ...joint, a1: axis === 1 ? ang : 0, a2: axis === 2 ? ang : 0 }]).parts;
      const B = P.filter(p => p.body === joint.bodyB), X = P.filter(p => p.body === joint.bodyX);
      const rest = P.filter(p => p.body !== joint.bodyB && p.body !== joint.bodyX);
      const o = { step: 1.5, first: true };
      const hit = collisionsBetween(t, B, rest, o).length || (X.length && (collisionsBetween(t, X, rest, o).length || collisionsBetween(t, B, X, o).length));
      if (hit) break;
      ok = ang;
    }
    return ok;
  };
  const r1 = [sweep(1, -1), sweep(1, 1)];
  const r2 = joint.type === 'cross' ? [sweep(2, -1), sweep(2, 1)] : null;
  return { a1: r1, a2: r2 };
}

export const fmtRange = r => (r[0] <= -180 && r[1] >= 180 ? 'all the way round' : `${r[0]}° to +${r[1]}°`);
