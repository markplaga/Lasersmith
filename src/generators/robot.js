// Articulated robot (PRD 4.3 / 7): a torso box with a head, two arms and two legs, each on its own
// hinge (cross hinge by default, pin hinge optional), with dowel pins. Every joint gets a range of
// motion from a 3D collision sweep and a pair of pose sliders.

import { buildBox } from './fingerbox.js';
import { makeDesign, makePart } from '../geom/design.js';
import { circleLoop } from '../geom/poly.js';
import { HINGE_PARAMS, addHinge, portAt, posed, rangeOfMotion, fmtRange } from '../joints/hinge.js';

const JOINTS = [
  { key: 'neck', label: 'Neck', body: 'head', a1: 'turns / nods', a2: 'tilts' },
  { key: 'shoulderL', label: 'Left shoulder', body: 'armL', a1: 'raises / lowers', a2: 'swings' },
  { key: 'shoulderR', label: 'Right shoulder', body: 'armR', a1: 'raises / lowers', a2: 'swings' },
  { key: 'hipL', label: 'Left hip', body: 'legL', a1: 'steps', a2: 'spreads' },
  { key: 'hipR', label: 'Right hip', body: 'legR', a1: 'steps', a2: 'spreads' },
];

const POSE_DEFAULTS = { neck: [10, 0], shoulderL: [45, 0], shoulderR: [45, 20], hipL: [15, 0], hipR: [-15, 0] };

const len = (key, label, def, min, max, group, help) => ({ key, label, type: 'length', default: def, min, max, group, help });

const romCache = new Map();

export default {
  id: 'robot',
  title: 'Articulated robot',
  category: 'Hinges',
  source: 'native',
  description: 'A posable robot: torso, head, arms and legs are finger-jointed boxes joined by cross hinges (or pin hinges) on wood dowels. Pose it with the sliders; each joint shows how far it can move before parts touch.',
  tags: ['robot', 'figure', 'hinge', 'cross hinge', 'posable', 'dowel'],
  params: [
    len('torsoW', 'Torso width', 110, 70, 400, 'Body'),
    len('torsoD', 'Torso depth', 60, 45, 300, 'Body'),
    len('torsoH', 'Torso height', 130, 70, 400, 'Body'),
    len('headW', 'Head width', 70, 40, 300, 'Body'),
    len('headD', 'Head depth', 56, 40, 300, 'Body'),
    len('headH', 'Head height', 56, 35, 300, 'Body'),
    len('armS', 'Arm thickness', 44, 40, 200, 'Limbs', 'Arms are square boxes this wide.'),
    len('armL', 'Arm length', 90, 40, 400, 'Limbs'),
    len('legS', 'Leg thickness', 48, 40, 200, 'Limbs'),
    len('legL', 'Leg length', 100, 40, 400, 'Limbs'),
    len('finger', 'Finger width', 10, 3, 50, 'Limbs'),
    { key: 'neck', label: 'Neck joint', type: 'select', default: 'swivel', group: 'Limbs', choices: [{ value: 'swivel', label: 'Swivel (head turns)' }, { value: 'hinge', label: 'Same hinge as the limbs' }] },
    { key: 'face', label: 'Engrave a face', type: 'bool', default: true, group: 'Limbs' },
    ...HINGE_PARAMS.map(q => (q.key === 'cube' ? { ...q, default: 20 } : q.key === 'armW' ? { ...q, default: 18 } : q)),
    ...JOINTS.flatMap(j => [
      { key: j.key + '1', label: `${j.label} (${j.a1})`, type: 'angle', default: POSE_DEFAULTS[j.key][0], min: -150, max: 150, step: 1, group: 'Pose' },
      { key: j.key + '2', label: `${j.label} (${j.a2})`, type: 'angle', default: POSE_DEFAULTS[j.key][1], min: -150, max: 150, step: 1, group: 'Pose', help: 'Cross hinge only.' },
    ]),
  ],
  generate(p, material) {
    const t = material.thickness;
    const box = (L, title, prefix) => buildBox(L, t, { finger: p.finger, labels: false, title, prefix });
    const torso = box([p.torsoW, p.torsoD, p.torsoH], 'Torso', 'torso-');
    const parts = torso.parts.map(q => makePart({ ...q, body: 'torso' }));
    const hardware = [], joints = [], notes = [...torso.notes];
    const hingeAt = (jt, port, B, portB, nameB, h = p) => {
      const r = addHinge({ partsA: parts, portA: port, B, portB, h, t, bodies: { A: 'torso', B: jt.body, X: jt.key + '-x' }, label: jt.label, nameB });
      parts.push(...r.parts);
      hardware.push(...r.hardware);
      joints.push({ ...r.joint, key: jt.key });
      notes.push(...B.notes, ...r.notes);
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
    // Arms near the top of the side faces (port v is up on side faces)
    const sh = Math.max(0, p.torsoH / 2 - t - Math.max(1, 0.6 * t) - Math.max(t, p.armW / 4) - 6);
    hingeAt(J.shoulderL, portAt(torso, 'left', 0, sh), box([p.armS, p.armS, p.armL], 'Left arm', 'arm-l-'), 'top');
    hingeAt(J.shoulderR, portAt(torso, 'right', 0, sh), box([p.armS, p.armS, p.armL], 'Right arm', 'arm-r-'), 'top');
    // Legs side by side under the torso (bottom port u is +x)
    hingeAt(J.hipL, portAt(torso, 'bottom', -p.torsoW / 4), box([p.legS, p.legS, p.legL], 'Left leg', 'leg-l-'), 'top');
    hingeAt(J.hipR, portAt(torso, 'bottom', p.torsoW / 4), box([p.legS, p.legS, p.legL], 'Right leg', 'leg-r-'), 'top');

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
    const lens = new Map();
    for (const q of hardware) lens.set(q.len.toFixed(1), (lens.get(q.len.toFixed(1)) || 0) + 1);
    info.push(`Dowels (${p.pinD} mm): ` + [...lens].map(([l, n]) => `${n} x ${l} mm`).join(', ') + '. Glue or press them into the arms; they turn in the ' + (p.hinge === 'cross' ? 'cross blocks.' : 'middle arms.') + (p.neck === 'swivel' ? ' The neck dowel is glued into the keeper disc and the head.' : ''));
    info.push('Glue each hinge arm\'s tab into its slot before closing that box. ' + (p.neck === 'swivel' ? 'Put the neck keeper disc inside the torso, then close the torso last.' : 'Close the torso last.'));
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
