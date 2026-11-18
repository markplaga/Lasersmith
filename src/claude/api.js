// The geometry API that Claude-made (and other user) generators are written against (PRD 6.2).
// It is handed to the generator as `api`; the generator sees nothing else.

import * as poly from '../geom/poly.js';
import { rectRegion } from '../geom/rectunion.js';
import { makeDesign, makePart, toWorld } from '../geom/design.js';
import { strokeText, textWidth } from '../geom/strokefont.js';
import { buildBox, fingerSegments } from '../generators/fingerbox.js';
import { v3, rotAxis, movePlace, frameToFrame, toLocal, rotateAbout, applyRigid, mul as mulR } from '../geom/frame.js';
import { addHinge, portAt, posed, rangeOfMotion, fmtRange, HINGE_PARAMS } from '../joints/hinge.js';

export const API = Object.freeze({
  // 2D
  rect: poly.rect, circleLoop: poly.circleLoop, offsetLoop: poly.offsetLoop, transformLoop: poly.transformLoop,
  area: poly.area, bbox: poly.bbox, pointInLoop: poly.pointInLoop, flattenCubic: poly.flattenCubic, clean: poly.clean,
  rectRegion,
  // text (single-stroke, for engraving)
  strokeText, textWidth,
  // parts and the design document
  makePart, makeDesign, toWorld,
  // finger-jointed boxes with ports
  buildBox, fingerSegments,
  // 3D placements
  v3, rotAxis, movePlace, frameToFrame, toLocal, rotateAbout, applyRigid, mulR,
  // joints
  addHinge, portAt, posed, rangeOfMotion, fmtRange, HINGE_PARAMS,
});

/**
 * Run a compiled generator: fill parameter defaults, call generate, and normalise the result into a
 * Design document. `gen` is what the generator source returns: {title, description, params, generate}.
 */
export function runCompiled(gen, values, material) {
  checkShape(gen);
  const p = {};
  for (const q of gen.params) p[q.key] = values && q.key in values ? values[q.key] : q.default;
  let d = gen.generate(p, { ...material }, API);
  if (!d || typeof d !== 'object') throw new Error('generate() must return a design (use api.makeDesign) or {parts: [...]}');
  if (d.format !== 'lasersmith/design') {
    if (!Array.isArray(d.parts)) throw new Error('generate() returned no parts array');
    d = makeDesign({ title: gen.title, material, ...d, generator: undefined });
  }
  d.generator = { id: 'claude', params: p, source: 'claude' };
  d.title = d.title || gen.title;
  for (const part of d.parts) {
    if (!Array.isArray(part.outline) || part.outline.length < 3) throw new Error(`Part "${part.name}" has no outline (a list of [x, y] points)`);
    for (const pt of part.outline) if (!Array.isArray(pt) || !isFinite(pt[0]) || !isFinite(pt[1])) throw new Error(`Part "${part.name}" has a bad outline point: ${JSON.stringify(pt)}`);
  }
  return { design: JSON.parse(JSON.stringify(d)), meta: { title: gen.title, description: gen.description || '', params: gen.params } };
}

const TYPES = new Set(['length', 'number', 'int', 'bool', 'select', 'text', 'angle']);
export function checkShape(gen) {
  if (!gen || typeof gen !== 'object') throw new Error('The generator must end with `return { title, params, generate }`');
  if (typeof gen.generate !== 'function') throw new Error('The generator has no generate(p, material, api) function');
  if (!Array.isArray(gen.params)) throw new Error('The generator has no params array');
  for (const q of gen.params) {
    if (!q || typeof q.key !== 'string') throw new Error('Every param needs a string key');
    if (!TYPES.has(q.type)) throw new Error(`Param "${q.key}" has unknown type "${q.type}" (use ${[...TYPES].join(', ')})`);
    if (q.type === 'select' && !Array.isArray(q.choices)) throw new Error(`Select param "${q.key}" needs choices: [{value, label}]`);
  }
}

/** Compile in the current realm (tests, Node). The browser runs generators in a sandboxed worker instead. */
export function compileHere(src) {
  // eslint-disable-next-line no-new-func
  return new Function('api', '"use strict";\n' + src)(API);
}
