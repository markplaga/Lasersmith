// What Claude reads when it writes or changes a generator (PRD 6.5): the geometry API reference,
// two example generators, the joint catalogue, and the user's material and machine.

export const API_REFERENCE = `
GENERATOR FORMAT
A generator is the BODY of a JavaScript function that receives \`api\` and ends with
  return { title, description, params, generate };
- title: short name. description: one or two sentences for the library.
- params: [{key, label, type, default, min?, max?, step?, group?, help?, choices?}]
  type: 'length' (mm; shown in mm or inches), 'number', 'int', 'bool', 'select' (choices: [{value, label}]),
  'text', 'angle' (degrees, shown as a slider; use for poses). Group related params with group: 'Size' etc.
- generate(p, material, api) returns api.makeDesign({...}). p holds every param value.
  material = {name, thickness, kerf} (mm). ALWAYS use material.thickness (t) for slots, tabs and joints.
It runs in a sandboxed worker: no DOM, network, storage, imports or randomness that changes between runs
(use a 'seed' int param if you need variety). Plain modern JavaScript only. Keep it under ~250 lines.

COORDINATES AND PARTS
Units are mm. A part is drawn flat in its own 2D coordinates, y up:
  { id, name, outline: [[x,y],...] (closed, no repeated last point),
    holes: [loop,...], circles: [{cx,cy,r}], cuts: [polyline] (open cut lines),
    score: [polyline], engrave: [polyline] (single-line engrave), fill: [loop] (filled engrave),
    qty?: n, place?: {o, u, v, n} }
Holes and circles are inner cuts. Draw NOMINAL geometry: the app applies kerf compensation on export.
place puts the part in 3D for the preview and the 3D collision check: 2D point (x, y) maps to
o + x*u + y*v; the sheet's thickness spans n in [-t/2, +t/2] (o is on the MID-plane). u, v, n are unit
vectors, n = u x v. World axes: x right, y back (front face is y = 0), z up. Give every part a place
when the design is an assembled 3D object, so parts must interlock with no overlap and no gaps.

API (all on \`api\`)
2D:   rect(x, y, w, h) -> loop;  circleLoop(cx, cy, r, tol=0.02) -> loop;  offsetLoop(loop, d) (d>0 grows a CCW loop);
      transformLoop(loop, {dx, dy, deg, flipX});  area(loop) (>0 = CCW);  bbox(points) -> {x, y, x1, y1, w, h};
      pointInLoop(pt, loop);  flattenCubic(p0, p1, p2, p3, tol) -> points;  clean(loop)
      rectRegion(keep, cut) -> {outer: [loop], holes: [loop]}: union of keep rectangles [x0,y0,x1,y1] minus
      cut rectangles. Ideal for tabbed/slotted outlines built from axis-aligned rectangles.
Text: strokeText(text, x, y, size, align='center', angleDeg=0) -> [polyline] single-stroke letters for
      engrave (A-Z 0-9 punctuation); textWidth(text, size).
Doc:  makeDesign({title, material, parts, notes?: [warning strings], info?: [note strings], hardware?, joints?})
      makePart(p) (makeDesign calls it for you).
Boxes: buildBox([X, Y, Z], t, {faces?, finger=10, labels=false, prefix='', title=''}) -> {parts, ports, notes}
      A finger-jointed box with its corner at the origin, outer size X (x) by Y (y) by Z (z).
      faces default ['bottom','top','front','back','left','right']; leave one out for an open box.
      Parts are already placed in 3D (ids prefix + face). ports: one per face {name, part, o (centre of
      the OUTER face), u, v, n (outward)}. To move a whole box: parts.map(q => ({...q, place:
      movePlace(q.place, {R: [[1,0,0],[0,1,0],[0,0,1]], T: [dx, dy, dz]})})), and move its ports the same way.
      fingerSegments(a, b, fw, t) -> [[s0, s1, i]] odd finger split of [a, b].
3D:   v3 {add, sub, scale, dot, cross, len, norm, madd(a, b, k) = a + b*k};  rotAxis(axis, radians) -> R
      (3 column vectors);  movePlace(place, {R, T});  rotateAbout(R, point) -> {R, T};  toLocal(place, worldPt)
      -> [x, y, w];  toWorld(place, x, y, w).
Joints (moving parts between boxes):
      portAt(box, face, du=0, dv=0) -> a port on that face moved du along its u and dv along its v.
      addHinge({partsA, portA, B, portB, h, t, bodies: {A, B, X}, label}) hangs box B (a buildBox result in
      its own coordinates) off placed parts partsA at portA with a hinge. It cuts the arm slots into the
      face plates, places B and returns {parts (hinge parts + B's parts), hardware, joint, notes}.
      h: {hinge: 'cross'|'pin'|'swivel', cube (cross size, 24), armW (20), gap (1), reach (0), pinD (6),
      pinClear (0.3), disc (swivel disc diameter, 30)}. Spread HINGE_PARAMS into params to expose them.
      Cross hinge = flat square cross with a t x t nub on each edge turning in round arm holes (2 axes).
      Pin hinge = clevis on a dowel (1 axis). Swivel = discs on a dowel, turns about the face normal.
      Faces that take a hinge need room: about (cube + 2*gap + 2*t + 2*1.6t) square for a cross hinge.
      Give every part a body name: the fixed side keeps its own (e.g. 'torso'), B gets bodies.B.
      Posing: set joint.a1 / joint.a2 (degrees) then posed(parts, hardware, joints) -> {parts, hardware}.
      rangeOfMotion(parts, joint, t, {stepDeg: 5, maxDeg: 120}) -> {a1: [min, max], a2: [min,max]|null}
      (slow-ish: once per joint); fmtRange(r) -> text.
      Pass joints and hardware to makeDesign so the 3D view shows dowels.

Voxel sculptures (figures made of flat pieces at right angles that slot together):
      voxels.makeGrid(nx, ny, nz); voxels.set(g, x, y, z, 1); voxels.get(g, x, y, z);
      voxels.fromFunction(nx, ny, nz, (x, y, z) => bool) (cell centres, e.g. ellipsoids for body parts);
      voxels.sculpt(g, {voxel: mm, families: [0, 1] (axes of the two piece families: 0 x, 1 y, 2 z),
      spacing: 1, t, labels: true}) -> {parts, notes, info}: half-lapped pieces, already placed in 3D.
      Grids up to ~40 cells a side; figure size = cells x voxel. Keep features at least 2 cells thick.
      For a described figure ("a sitting cat") build it from simple solids with fromFunction and expose
      size, voxel, families and spacing as params.

RULES THE APP CHECKS (errors block export)
- Outlines closed and not self-intersecting; holes inside their outline.
- Parts fit the bed (with margin); wood between cuts at least 0.6 x t (min 1 mm).
- In 3D, placed parts must not overlap (touching is fine). Slots for tabs must be exactly t wide.
- Notes (warnings) you add appear to the user; use info for assembly tips.
`;

export const EXAMPLE_SIMPLE = `const { buildBox, rect, makeDesign, strokeText } = api;
return {
  title: 'Pencil cup',
  description: 'An open-top finger-jointed cup with a name engraved on the front.',
  params: [
    { key: 'w', label: 'Width', type: 'length', default: 80, min: 40, max: 300, group: 'Size' },
    { key: 'h', label: 'Height', type: 'length', default: 100, min: 40, max: 300, group: 'Size' },
    { key: 'name', label: 'Name', type: 'text', default: 'PENCILS', group: 'Style' },
  ],
  generate(p, material) {
    const t = material.thickness;
    const box = buildBox([p.w, p.w, p.h], t, { faces: ['bottom', 'front', 'back', 'left', 'right'], finger: 10 });
    const front = box.parts.find(q => q.id === 'front');
    const size = Math.min(10, p.w / (p.name.length * 0.7 + 1));
    front.engrave = strokeText(p.name.toUpperCase(), p.w / 2, p.h * 0.55, size);
    return makeDesign({ title: 'Pencil cup', material, parts: box.parts, notes: box.notes });
  },
};`;

export const EXAMPLE_HINGED = `const { buildBox, addHinge, portAt, posed, makeDesign, makePart, HINGE_PARAMS } = api;
return {
  title: 'Nodding head',
  description: 'A body box with a head on a cross hinge.',
  params: [
    { key: 'body', label: 'Body size', type: 'length', default: 80, min: 60, max: 300, group: 'Size' },
    { key: 'head', label: 'Head size', type: 'length', default: 60, min: 50, max: 300, group: 'Size' },
    ...HINGE_PARAMS,
    { key: 'nod', label: 'Nod', type: 'angle', default: 15, min: -90, max: 90, group: 'Pose' },
  ],
  generate(p, material) {
    const t = material.thickness;
    const body = buildBox([p.body, p.body, p.body], t, { prefix: 'body-', title: 'Body' });
    const parts = body.parts.map(q => makePart({ ...q, body: 'body' }));
    const head = buildBox([p.head, p.head, p.head], t, { prefix: 'head-', title: 'Head' });
    const j = addHinge({ partsA: parts, portA: portAt(body, 'top'), B: head, portB: 'bottom', h: p, t,
      bodies: { A: 'body', B: 'head', X: 'neck-x' }, label: 'Neck' });
    parts.push(...j.parts);
    const joint = { ...j.joint, a1: p.nod, a2: 0 };
    const pose = posed(parts, j.hardware, [joint]);
    return makeDesign({ title: 'Nodding head', material, parts: pose.parts, hardware: pose.hardware, joints: [joint],
      notes: [...body.notes, ...head.notes, ...j.notes] });
  },
};`;

const RESPONSE_FORMAT = `
HOW TO ANSWER
Reply with one or two short sentences for the user saying what you made or changed (plain words, no
code talk), then the COMPLETE generator in a single \`\`\`js code block. Always send the whole generator,
never a diff. If the request is unclear in a way that changes the design a lot (size, posable or not),
make sensible choices, say which in your sentence, and expose them as params so the user can change them.
Prefer params for every dimension a person might want to change.`;

export function machineText(material, machine) {
  return `USER'S SETUP
Material: ${material.name}, ${material.thickness} mm thick, kerf ${material.kerf} mm.
Laser bed: ${machine.bedW} x ${machine.bedH} mm (margin ${machine.margin} mm), LightBurn. Large designs are nested onto several sheets.`;
}

/** The standing instructions turn (first user turn of every conversation). */
export function systemTurn(material, machine) {
  return [
    'You write parametric laser-cut designs for Lasersmith as JavaScript generators. The app runs your generator, shows the parts in 3D and on cut sheets, checks them, and exports LightBurn files.',
    API_REFERENCE,
    'EXAMPLE 1\n```js\n' + EXAMPLE_SIMPLE + '\n```',
    'EXAMPLE 2 (two boxes joined by a hinge)\n```js\n' + EXAMPLE_HINGED + '\n```',
    machineText(material, machine),
    RESPONSE_FORMAT,
  ].join('\n\n');
}

/** A user turn asking for a change to an existing generator. */
export function changeTurn(request, source, params) {
  return `Here is the current generator${params ? ' (the user has these parameter values: ' + JSON.stringify(params) + ')' : ''}:\n\`\`\`js\n${source}\n\`\`\`\n\nChange it as follows: ${request}`;
}

/** A user turn that sends problems back for repair. */
export function repairTurn(problems) {
  return `The app ran your generator and found problems:\n${problems.map(p => '- ' + p).join('\n')}\n\nFix them and send the complete corrected generator. Keep the user's request; do not drop features to make the errors go away.`;
}

/** The generator source from a reply: the last fenced js block (or the last fenced block). */
export function extractCode(text) {
  const blocks = [...String(text).matchAll(/```([a-zA-Z]*)[ \t]*\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  const js = blocks.filter(b => /^(js|javascript|)$/i.test(b[1]));
  return (js.length ? js : blocks)[(js.length ? js : blocks).length - 1][2].trim();
}

/** The reply text without code, for the chat transcript. */
export function proseOf(text) {
  return String(text).replace(/```[\s\S]*?(```|$)/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
