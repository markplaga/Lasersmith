// Articulated robot (PRD 4.3 / 7): a torso box with a head, two arms and two legs, each on its own
// hinge (cross hinge with a nubbed cross by default, pin hinge optional; swivel neck on a dowel). Every joint gets a range of
// motion from a 3D collision sweep and a pair of pose sliders.

import { buildBox } from './fingerbox.js';
import { makeDesign, makePart } from '../geom/design.js';
import { circleLoop } from '../geom/poly.js';
import { HINGE_PARAMS, addHinge, portAt, posed, rangeOfMotion, fmtRange } from '../joints/hinge.js';
import { v3 } from '../geom/frame.js';

const JOINTS = [
  { key: 'neck', label: 'Neck', body: 'head', a1: 'turns / nods', a2: 'tilts' },
  { key: 'shoulderL', label: 'Left shoulder', body: 'armL', a1: 'raises / lowers', a2: 'swings' },
  { key: 'shoulderR', label: 'Right shoulder', body: 'armR', a1: 'raises / lowers', a2: 'swings' },
  { key: 'hipL', label: 'Left hip', body: 'legL', a1: 'steps', a2: 'spreads' },
  { key: 'hipR', label: 'Right hip', body: 'legR', a1: 'steps', a2: 'spreads' },
  { key: 'elbowL', label: 'Left elbow', body: 'foreL', a1: 'bends', axes: 1 },
  { key: 'elbowR', label: 'Right elbow', body: 'foreR', a1: 'bends', axes: 1 },
  { key: 'kneeL', label: 'Left knee', body: 'shinL', a1: 'bends', axes: 1 },
  { key: 'kneeR', label: 'Right knee', body: 'shinR', a1: 'bends', axes: 1 },
];

const POSE_DEFAULTS = { neck: [10, 0], shoulderL: [45, 0], shoulderR: [45, 20], hipL: [15, 0], hipR: [-15, 0], elbowL: [30], elbowR: [-20], kneeL: [-20], kneeR: [10] };

const len = (key, label, def, min, max, group, help) => ({ key, label, type: 'length', default: def, min, max, group, help });

const romCache = new Map();

export default {
  id: 'robot',
  title: 'Articulated robot',
  category: 'Hinges',
  source: 'native',
  description: 'A posable robot: torso, head, arms and legs are finger-jointed boxes joined by cross hinges (a flat cross with nubs) or pin hinges, with a swivel neck. Pose it with the sliders; each joint shows how far it can move before parts touch.',
  tags: ['robot', 'figure', 'hinge', 'cross hinge', 'posable', 'dowel'],
  params: [
    len('torsoW', 'Torso width', 110, 70, 400, 'Body'),
    len('torsoD', 'Torso depth', 60, 45, 300, 'Body'),
    len('torsoH', 'Torso height', 130, 70, 400, 'Body'),
    len('headW', 'Head width', 70, 40, 300, 'Body'),
    len('headD', 'Head depth', 56, 40, 300, 'Body'),
    len('headH', 'Head height', 56, 35, 300, 'Body'),
    len('armS', 'Arm thickness', 44, 40, 200, 'Limbs', 'Arms are square boxes this wide.'),
    len('armL', 'Arm length', 110, 40, 400, 'Limbs', 'Shoulder to hand, before the hinge gaps.'),
    len('legS', 'Leg thickness', 48, 40, 200, 'Limbs'),
    len('legL', 'Leg length', 120, 40, 400, 'Limbs', 'Hip to foot, before the hinge gaps.'),
    len('finger', 'Finger width', 10, 3, 50, 'Limbs'),
    { key: 'neck', label: 'Neck joint', type: 'select', default: 'swivel', group: 'Limbs', choices: [{ value: 'swivel', label: 'Swivel (head turns)' }, { value: 'hinge', label: 'Same hinge as the limbs' }] },
    { key: 'bends', label: 'Elbows and knees', type: 'bool', default: true, group: 'Limbs', help: 'Splits each arm and leg in two with a pin hinge in the middle.' },
    { key: 'face', label: 'Engrave a face', type: 'bool', default: true, group: 'Limbs' },
    ...HINGE_PARAMS.map(q => (q.key === 'cube' ? { ...q, default: 22 } : q.key === 'armW' ? { ...q, default: 18 } : q)),
    ...JOINTS.flatMap(j => [
      { key: j.key + '1', label: `${j.label} (${j.a1})`, type: 'angle', default: POSE_DEFAULTS[j.key][0], min: -150, max: 150, step: 1, group: 'Pose', help: j.axes === 1 ? 'Only with elbows and knees on.' : undefined },
      ...(j.axes === 1 ? [] : [{ key: j.key + '2', label: `${j.label} (${j.a2})`, type: 'angle', default: POSE_DEFAULTS[j.key][1], min: -150, max: 150, step: 1, group: 'Pose', help: 'Cross hinge only.' }]),
    ]),
  ],
  generate(p, material) {
    const t = material.thickness;
    const box = (L, title, prefix) => buildBox(L, t, { finger: p.finger, labels: false, title, prefix });
    const torso = box([p.torsoW, p.torsoD, p.torsoH], 'Torso', 'torso-');
    const parts = torso.parts.map(q => makePart({ ...q, body: 'torso' }));
    const hardware = [], joints = [], notes = [...torso.notes];
    const hingeAt = (jt, port, B, portB, nameB, h = p, bodyA = 'torso') => {
      const r = addHinge({ partsA: parts, portA: port, B, portB, h, t, bodies: { A: bodyA, B: jt.body, X: jt.key + '-x' }, label: jt.label, nameB });
      parts.push(...r.parts);
      hardware.push(...r.hardware);
      const joint = { ...r.joint, key: jt.key };
      joints.push(joint);
      notes.push(...B.notes, ...r.notes);
      return { ...r, joint };
    };
    const J = Object.fromEntries(JOINTS.map(j => [j.key, j]));
    // Head on the top face
    const head = box([p.headW, p.headD, p.headH], 'Head', 'head-');
    if (p.face) {
      const front = head.parts.find(q => q.id === 'head-front');
      const W = p.headW, H = p.headH, r = Math.min(W, H) * 0.09;
      front.engrave = [circleLoop(W * 0.32, H * 0.62, r, 0.05), circleLoop(W * 0.68, H * 0.62, r, 0.05)].map(l => l.concat([l[0]]));
      front.engrave.push([[W * 0.3, H * 0.32], [W * 0.38, H * 0.27], [W * 0.62, H * 0.27], [W * 0.7, H * 0.32]]);
    }
    hingeAt(J.neck, portAt(torso, 'top'), head, 'bottom', '', p.neck === 'swivel' ? { ...p, hinge: 'swivel' } : p);
    // A limb: one box, or (elbows and knees) an upper box with a lower box on a pin hinge below it.
    // axis: the pin's direction at rest, so the lower part bends forwards and back once the limb hangs
    // down (legs hang down at rest: x; arms stick out sideways at rest: z, which becomes x when lowered).
    const limb = (jt, port, side, size, length, upper, lower, bend, axis) => {
      const L1 = p.bends ? Math.max(40, Math.round(length / 2)) : length;
      const r = hingeAt(jt, port, box([size, size, L1], upper, side + '-'), 'top');
      if (!p.bends) return;
      let pb = r.portsB.find(q => q.name === 'bottom');
      if (Math.abs(v3.dot(pb.u, axis)) < 0.5) pb = { ...pb, u: pb.v, v: v3.scale(pb.u, -1) };
      const r2 = hingeAt(bend, pb, box([size, size, Math.max(40, length - L1)], lower, side + '-lo-'), 'top', '', { ...p, hinge: 'pin' }, jt.body);
      r.joint.carries = [bend.body, bend.key + '-x'];
      return r2;
    };
    // Arms near the top of the side faces (port v is up on side faces)
    const sh = Math.max(0, p.torsoH / 2 - t - Math.max(1, 0.6 * t) - Math.max(t, p.armW / 4) - 6);
    const up = p.bends ? ['Left upper arm', 'Right upper arm', 'Left thigh', 'Right thigh'] : ['Left arm', 'Right arm', 'Left leg', 'Right leg'];
    limb(J.shoulderL, portAt(torso, 'left', 0, sh), 'arm-l', p.armS, p.armL, up[0], 'Left forearm', J.elbowL, [0, 0, 1]);
    limb(J.shoulderR, portAt(torso, 'right', 0, sh), 'arm-r', p.armS, p.armL, up[1], 'Right forearm', J.elbowR, [0, 0, 1]);
    // Legs side by side under the torso (bottom port u is +x)
    limb(J.hipL, portAt(torso, 'bottom', -p.torsoW / 4), 'leg-l', p.legS, p.legL, up[2], 'Left shin', J.kneeL, [1, 0, 0]);
    limb(J.hipR, portAt(torso, 'bottom', p.torsoW / 4), 'leg-r', p.legS, p.legL, up[3], 'Right shin', J.kneeR, [1, 0, 0]);
    // Parents before children: shoulders and hips before elbows and knees.
    joints.sort((a, b) => JOINTS.findIndex(j => j.key === a.key) - JOINTS.findIndex(j => j.key === b.key));

    // Range of motion per joint (independent of the pose, so pose sliders reuse it)
    const key = JSON.stringify([t, ...this.params.filter(q => q.group !== 'Pose').map(q => p[q.key])]);
    let ranges = romCache.get(key);
    if (!ranges) {
      ranges = joints.map(j => rangeOfMotion(parts, j, t, { stepDeg: j.type === 'swivel' ? 10 : 5, maxDeg: 120 }));
      romCache.clear();
      romCache.set(key, ranges);
    }
    joints.forEach((j, i) => {
      j.range = ranges[i];
      j.a1 = p[j.key + '1'] || 0;
      j.a2 = j.type === 'cross' ? p[j.key + '2'] || 0 : 0;
    });
    const pose = posed(parts, hardware, joints);
    const verb = (j, k) => (j.type === 'swivel' ? 'turns' : J[j.key][k]);
    const info = joints.map(j => `${J[j.key].label}: ${verb(j, 'a1')} ${fmtRange(j.range.a1)}` + (j.range.a2 ? `, ${verb(j, 'a2')} ${fmtRange(j.range.a2)}.` : '.'));
    if (hardware.length) {
      const lens = new Map();
      for (const q of hardware) lens.set(q.len.toFixed(1), (lens.get(q.len.toFixed(1)) || 0) + 1);
      info.push(`Dowels (${p.pinD} mm): ` + [...lens].map(([l, n]) => `${n} x ${l} mm`).join(', ') + '.' + (p.hinge === 'pin' ? ' Glue them into the outer arms; they turn in the middle arms.' : '') + (p.neck === 'swivel' ? ' The neck dowel is glued into the keeper disc and the head.' : ''));
    }
    if (p.hinge === 'cross' || p.neck !== 'swivel') info.push(`Cross hinges: the nubs turn in ${(Math.SQRT2 * t + p.pinClear).toFixed(1)} mm holes in the arms; slip the four arms onto each cross before pushing their tabs into the box faces.`);
    info.push("Glue each hinge arm's tab into its slot before closing that box. " + (p.neck === 'swivel' ? 'Put the neck keeper disc inside the torso, then close the torso last.' : 'Close the torso last.'));
    return makeDesign({
      title: 'Articulated robot',
      generator: { id: 'robot', params: p },
      material,
      parts: pose.parts,
      hardware: pose.hardware,
      joints,
      notes,
      info,
    });
  },
};
