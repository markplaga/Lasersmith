// Hinge test coupon (PRD 7.3): two small finger-jointed boxes joined by one hinge, so the fit
// and the range of motion can be checked before cutting a whole robot.

import { buildBox } from './fingerbox.js';
import { makeDesign } from '../geom/design.js';
import { HINGE_PARAMS, joinBoxes, posed, rangeOfMotion, fmtRange } from '../joints/hinge.js';

export const POSE_PARAMS = [
  { key: 'pose1', label: 'Pose, axis 1', type: 'angle', default: 0, min: -150, max: 150, step: 1, group: 'Pose', help: 'Turns the lower box about the first pin axis. The 3D view shows it; the cut files are the same at any pose.' },
  { key: 'pose2', label: 'Pose, axis 2', type: 'angle', default: 0, min: -150, max: 150, step: 1, group: 'Pose', help: 'Cross hinge only: turns about the second pin axis.' },
];

const romCache = new Map();

function assemblyNotes(type, hw, p, t) {
  if (type === 'cross') return [
    `The cross's nubs turn in ${(Math.SQRT2 * t + p.pinClear).toFixed(1)} mm holes in the arms. No dowels needed.`,
    'Assembly: slip all four arms onto the cross\'s nubs first, then push the arm tabs into the slots in the two box faces and glue them before closing the boxes.',
  ];
  const n = hw.length;
  return [
    `Dowels: ${n} ${n === 1 ? 'piece' : 'pieces'} of ${p.pinD} mm dowel, ${hw[0].len.toFixed(1)} mm long. ` + (type === 'swivel'
      ? "Glue it into the keeper disc and the lower box's face; it turns in the upper face and the washer."
      : 'Glue or press it into the outer arms; it turns in the middle arm.'),
    type === 'swivel' ? 'Fit the keeper disc inside the upper box before closing it.' : 'Arm tabs go through the slots in the box faces; glue them before closing the boxes.',
  ];
}

export default {
  id: 'hinge-coupon',
  title: 'Hinge test coupon',
  category: 'Hinges',
  source: 'native',
  description: 'Two small boxes joined by a cross hinge (a flat cross with nubs, two axes), a pin hinge or a swivel (both on dowels). Cut this first to check the fit before a bigger build; the range of motion is worked out in 3D.',
  tags: ['hinge', 'cross hinge', 'universal joint', 'dowel', 'test'],
  params: [
    { key: 'box', label: 'Box size', type: 'length', default: 60, min: 40, max: 300, group: 'Boxes', help: 'Each box is a cube this size.' },
    { key: 'height', label: 'Box height', type: 'length', default: 40, min: 25, max: 300, group: 'Boxes' },
    { key: 'finger', label: 'Finger width', type: 'length', default: 10, min: 3, max: 50, group: 'Boxes' },
    { key: 'labels', label: 'Engrave part names', type: 'bool', default: true, group: 'Boxes' },
    ...HINGE_PARAMS,
    ...POSE_PARAMS,
  ],
  generate(p, material) {
    const t = material.thickness;
    const L = [p.box, p.box, p.height];
    const A = buildBox(L, t, { finger: p.finger, labels: p.labels, prefix: 'a-', title: 'Upper' });
    const B = buildBox(L, t, { finger: p.finger, labels: p.labels, prefix: 'b-', title: 'Lower' });
    const J = joinBoxes(A, 'bottom', B, 'top', p, t);
    // The range of motion does not depend on the pose, so dragging a pose slider reuses it.
    const key = JSON.stringify([material.thickness, ...this.params.filter(q => q.group !== 'Pose').map(q => p[q.key])]);
    let range = romCache.get(key);
    if (!range) { range = rangeOfMotion(J.parts, J.joint, t); romCache.clear(); romCache.set(key, range); }
    const joint = { ...J.joint, a1: p.pose1 || 0, a2: J.joint.type === 'cross' ? p.pose2 || 0 : 0, range };
    const pose = posed(J.parts, J.hardware, [joint]);
    const info = [
      J.joint.type === 'swivel' ? `Range of motion: ${fmtRange(range.a1)}.` : `Range of motion, axis 1: ${fmtRange(range.a1)}` + (range.a2 ? `; axis 2: ${fmtRange(range.a2)}.` : '.'),
      ...assemblyNotes(J.joint.type, J.hardware, p, t),
    ];
    return makeDesign({
      title: { cross: 'Cross hinge coupon', pin: 'Pin hinge coupon', swivel: 'Swivel coupon' }[J.joint.type],
      generator: { id: 'hinge-coupon', params: p },
      material,
      parts: pose.parts,
      hardware: pose.hardware,
      joints: [joint],
      notes: [...A.notes, ...B.notes, ...J.notes],
      info,
    });
  },
};
