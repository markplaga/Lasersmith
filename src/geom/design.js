// The Design document: the one data shape every generator produces and everything downstream
// (validation, preview, nesting, export) reads.
//
// Design {
//   format: 'lasersmith/design', version: 1,
//   title, units: 'mm', generator: {id, params},
//   material: {name, thickness, kerf},
//   kerfApplied: bool          // true when geometry is already kerf-compensated (e.g. boxes.py with burn)
//   parts: [Part], notes: [string] (warnings), info: [string] (shown as notes),
//   ports: [{name, part, o, u, v, n, size}]   // mounting frames on faces: o on the outer face, n outward
//   hardware: [{kind: 'dowel', name, d, len, c, axis, body}]   // bought parts, shown in 3D and listed in the README
//   joints: [{type, pivot, ex, ey, ez, a1, a2, range}]          // moving joints (posing, range of motion)
// }
// Part {
//   id, name, qty,
//   outline: loop (y-up mm, closed),
//   holes: [loop], circles: [{cx, cy, r}],     // inner cuts
//   cuts: [polyline],                         // open cut lines (living-hinge slits)
//   score: [polyline], engrave: [polyline],   // blue score lines, green line engrave
//   fill: [loop],                             // black fill engrave
//   place: {o, u, v, n} | null,               // 3D: point (x, y) maps to o + x*u + y*v, slab spans n in [-t/2, t/2]
//   thickness, kerfApplied,
//   body?: string                              // rigid group that moves together when a joint is posed
// }

import { area, bbox, offsetLoop } from './poly.js';

export const FORMAT = 'lasersmith/design';

export function makePart(p) {
  const outline = area(p.outline) < 0 ? p.outline.slice().reverse() : p.outline;
  return {
    id: p.id || p.name,
    name: p.name || p.id || 'part',
    qty: p.qty || 1,
    outline,
    holes: (p.holes || []).map(h => (area(h) > 0 ? h.slice().reverse() : h)),
    circles: p.circles || [],
    cuts: p.cuts || [],
    score: p.score || [],
    engrave: p.engrave || [],
    fill: p.fill || [],
    place: p.place || null,
    thickness: p.thickness,
    kerfApplied: !!p.kerfApplied,
    ...(p.body ? { body: p.body } : {}),
    ...(p.meta ? { meta: p.meta } : {}),
  };
}

export function makeDesign({ title, generator, material, parts, notes = [], info = [], ports = [], hardware = [], joints = [], kerfApplied = false, view = {}, order }) {
  return {
    format: FORMAT,
    version: 1,
    title,
    units: 'mm',
    generator,
    material: { ...material },
    kerfApplied,
    parts: parts.map(p => makePart({ thickness: material.thickness, ...p, kerfApplied: p.kerfApplied ?? kerfApplied })),
    notes,
    info,
    ports,
    hardware,
    joints,
    view,
    ...(order && order.length ? { order } : {}),
  };
}

/** Every loop of a part that is cut (outline, holes, circles), as nominal geometry. */
export function partBBox(part) {
  return bbox(part.outline);
}

/**
 * Cut-ready geometry: outline grown by kerf/2, holes and circles shrunk by kerf/2,
 * unless the part says its geometry is already compensated.
 */
export function compensate(part, kerf) {
  const h = part.kerfApplied ? 0 : kerf / 2;
  return {
    outline: offsetLoop(part.outline, h),
    holes: part.holes.map(l => offsetLoop(l, -h)),
    circles: part.circles.map(c => ({ cx: c.cx, cy: c.cy, r: Math.max(0.01, c.r - h) })),
    cuts: part.cuts,
    score: part.score,
    engrave: part.engrave,
    fill: part.fill,
  };
}

/** 4x4 column-major matrix (three.js order) for a part placement. */
export function placeMatrix(place) {
  const { o, u, v, n } = place;
  return [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, o[0], o[1], o[2], 1];
}

export function toWorld(place, x, y, w = 0) {
  const { o, u, v, n } = place;
  return [o[0] + x * u[0] + y * v[0] + w * n[0], o[1] + x * u[1] + y * v[1] + w * n[1], o[2] + x * u[2] + y * v[2] + w * n[2]];
}

/** Expand qty into individual part instances (used by nesting and export). */
export function instances(design) {
  const out = [];
  design.parts.forEach((p, pi) => {
    for (let k = 0; k < p.qty; k++) out.push({ part: p, pi, k, label: p.qty > 1 ? `${p.name} ${k + 1}` : p.name });
  });
  return out;
}
