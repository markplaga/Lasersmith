// Small 3D helpers for rigid placements: vectors are [x, y, z]; a rotation is a 3x3 matrix given as
// its three columns [c0, c1, c2] (so R·p = p0*c0 + p1*c1 + p2*c2).

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  /** a + b*k */
  madd: (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k],
};

export const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** R·p */
export function mul(R, p) {
  return [0, 1, 2].map(k => R[0][k] * p[0] + R[1][k] * p[1] + R[2][k] * p[2]);
}
/** A·B */
export function mulM(A, B) { return B.map(c => mul(A, c)); }
export function transpose(R) { return [0, 1, 2].map(k => [R[0][k], R[1][k], R[2][k]]); }

/** Rotation by angle (radians) about a unit axis (Rodrigues). */
export function rotAxis(axis, ang) {
  const [x, y, z] = v3.norm(axis), c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [
    [c + x * x * C, y * x * C + z * s, z * x * C - y * s],
    [x * y * C - z * s, c + y * y * C, z * y * C + x * s],
    [x * z * C + y * s, y * z * C - x * s, c + z * z * C],
  ];
}

/** A rigid motion {R, T}: p -> R·p + T. */
export const rigid = (R, T) => ({ R, T });
export const applyRigid = (M, p) => v3.add(mul(M.R, p), M.T);
export function composeRigid(A, B) { return { R: mulM(A.R, B.R), T: applyRigid(A, B.T) }; }
/** Rotation R about the point c. */
export function rotateAbout(R, c) { return { R, T: v3.sub(c, mul(R, c)) }; }

/** Move a part placement {o, u, v, n} by a rigid motion. */
export function movePlace(place, M) {
  return { o: applyRigid(M, place.o), u: mul(M.R, place.u), v: mul(M.R, place.v), n: mul(M.R, place.n) };
}

/** Move a frame {o, u, v, n} (a port) the same way. */
export const moveFrame = movePlace;

/**
 * The rigid motion that takes frame F (o, u, v, n) onto frame G: F.o -> G.o, F.u -> G.u, ...
 * Both frames must be right-handed orthonormal.
 */
export function frameToFrame(F, G) {
  const RF = [F.u, F.v, F.n], RG = [G.u, G.v, G.n];
  const R = mulM(RG, transpose(RF));
  return { R, T: v3.sub(G.o, mul(R, F.o)) };
}

/** World point -> a placement's local (x, y, w). */
export function toLocal(place, p) {
  const d = v3.sub(p, place.o);
  return [v3.dot(d, place.u), v3.dot(d, place.v), v3.dot(d, place.n)];
}
