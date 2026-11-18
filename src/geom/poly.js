// Lasersmith 2D geometry: pure functions, no DOM. Lengths in mm, 2D coords y-up.
// A "loop" is an array of [x, y] points, implicitly closed. A "polyline" is an open array of points.

export const EPS = 1e-9;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = a => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const rot = (a, t) => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)];

/** Signed area, positive for counter-clockwise loops. */
export function area(loop) {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i], q = loop[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function bbox(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, x1, y1 };
}

export function rect(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/** Points of a circle as a CCW loop; segment count chosen so chord error stays under tol mm. */
export function circleLoop(cx, cy, r, tol = 0.02) {
  const n = Math.max(12, Math.min(256, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol / Math.max(r, tol))))));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

/** Remove duplicate and collinear points from a closed loop. */
export function clean(loop, tol = 1e-6) {
  let pts = loop.filter((p, i) => dist(p, loop[(i + 1) % loop.length]) > tol);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const ab = sub(b, a), bc = sub(c, b);
      if (Math.abs(cross(ab, bc)) <= tol * Math.max(len(ab), len(bc), 1) && dot(ab, bc) > 0) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export function pointInLoop(pt, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Distance from point p to segment ab. */
export function segDist(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, mul(ab, t)));
}

export function segSegDist(a, b, c, d) {
  if (segsIntersect(a, b, c, d)) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}

/** Proper or touching intersection of segments ab and cd. */
export function segsIntersect(a, b, c, d) {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
  const on = (p, q, r) => Math.min(p[0], q[0]) - EPS <= r[0] && r[0] <= Math.max(p[0], q[0]) + EPS && Math.min(p[1], q[1]) - EPS <= r[1] && r[1] <= Math.max(p[1], q[1]) + EPS;
  if (Math.abs(d1) <= EPS && on(a, b, c)) return true;
  if (Math.abs(d2) <= EPS && on(a, b, d)) return true;
  if (Math.abs(d3) <= EPS && on(c, d, a)) return true;
  if (Math.abs(d4) <= EPS && on(c, d, b)) return true;
  return false;
}

/** Uniform-grid bucket of segments so pairwise checks stay near-linear on big outlines. */
export function segmentGrid(segs, cell) {
  const grid = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  segs.forEach((s, idx) => {
    const i0 = Math.floor(Math.min(s[0][0], s[1][0]) / cell), i1 = Math.floor(Math.max(s[0][0], s[1][0]) / cell);
    const j0 = Math.floor(Math.min(s[0][1], s[1][1]) / cell), j1 = Math.floor(Math.max(s[0][1], s[1][1]) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let b = grid.get(k);
      if (!b) grid.set(k, (b = []));
      b.push(idx);
    }
  });
  return grid;
}

/** Returns the first self-intersection of a closed loop as {i, j, at}, or null. Adjacent edges are allowed to touch. */
export function selfIntersection(loop) {
  const n = loop.length;
  if (n < 4) return null;
  const segs = loop.map((p, i) => [p, loop[(i + 1) % n]]);
  const bb = bbox(loop);
  const cell = Math.max(bb.w, bb.h, 1) / Math.max(4, Math.sqrt(n));
  const grid = segmentGrid(segs, cell);
  const seen = new Set();
  for (const bucket of grid.values()) {
    for (let x = 0; x < bucket.length; x++) for (let y = x + 1; y < bucket.length; y++) {
      let i = bucket[x], j = bucket[y];
      if (i > j) [i, j] = [j, i];
      if (j - i === 1 || (i === 0 && j === n - 1)) continue;
      const k = i * n + j;
      if (seen.has(k)) continue;
      seen.add(k);
      if (segsIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) return { i, j, at: segs[i][0] };
    }
  }
  return null;
}

/** Line intersection of p + t*r and q + u*s; returns point or null if parallel. */
export function lineIntersect(p, r, q, s) {
  const d = cross(r, s);
  if (Math.abs(d) < 1e-12) return null;
  const t = cross(sub(q, p), s) / d;
  return add(p, mul(r, t));
}

/**
 * Offset a closed loop by d mm. Positive d grows the enclosed area regardless of winding.
 * Mitred corners (exact for the right-angle geometry of finger joints); very sharp corners are clamped.
 */
export function offsetLoop(loop, d) {
  if (!d) return loop.map(p => [p[0], p[1]]);
  const pts = clean(loop);
  const n = pts.length;
  const s = area(pts) > 0 ? -1 : 1; // outward normal sign for CCW is right-hand (dy, -dx)
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    const e1 = sub(b, a), e2 = sub(c, b);
    const n1 = mul([e1[1], -e1[0]], (-s * d) / len(e1));
    const n2 = mul([e2[1], -e2[0]], (-s * d) / len(e2));
    const hit = lineIntersect(add(a, n1), e1, add(b, n2), e2);
    if (!hit || dist(hit, b) > Math.abs(d) * 4) {
      // near-parallel or very sharp: bevel with two points
      if (!hit) out.push(add(b, n1));
      else { out.push(add(b, n1)); out.push(add(b, n2)); }
    } else out.push(hit);
  }
  return out;
}

/** Transform helper: rotate by deg about origin, then translate. */
export function transformLoop(loop, { dx = 0, dy = 0, deg = 0, flipX = false } = {}) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return loop.map(([x, y]) => {
    if (flipX) x = -x;
    return [x * c - y * s + dx, x * s + y * c + dy];
  });
}

/** Flatten a cubic Bézier from p0 to p3 into points (excluding p0). */
export function flattenCubic(p0, p1, p2, p3, tol = 0.02) {
  const est = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(2, Math.min(200, Math.ceil(Math.sqrt(est / tol) * 0.5)));
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
  }
  return out;
}

export function perimeter(pts, closed = true) {
  let L = 0;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) L += dist(pts[i], pts[(i + 1) % pts.length]);
  return L;
}

/**
 * Remove small self-crossing loops (e.g. the inner-corner "burn loops" boxes.py draws when it applies
 * kerf). Each crossing whose smaller side has perimeter under maxPerim is cut at the crossing point.
 */
export function untangle(loop, maxPerim = 3, maxIter = 500) {
  let pts = despike(loop);
  for (let it = 0; it < maxIter; it++) {
    pts = despike(pts);
    const si = selfIntersection(pts);
    if (!si) return pts;
    const { i, j } = si, n = pts.length;
    const a = pts[i], b = pts[(i + 1) % n], c = pts[j], d = pts[(j + 1) % n];
    const x = lineIntersect(a, sub(b, a), c, sub(d, c)) || b;
    const inner = [x, ...pts.slice(i + 1, j + 1)];          // between the two crossing segments
    const outer = [x, ...pts.slice(j + 1), ...pts.slice(0, i + 1)];
    const pi = perimeter(inner), po = perimeter(outer);
    if (Math.min(pi, po) > maxPerim) return pts;             // a real crossing: leave it for validation
    pts = pi <= po ? outer : inner;
  }
  return pts;
}

/** Drop repeated points and zero-width spikes (a -> b -> a) from a closed loop. */
export function despike(loop, tol = 1e-6) {
  let pts = loop.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const n = pts.length, prev = pts[(i + n - 1) % n], cur = pts[i], next = pts[(i + 1) % n];
      if (dist(cur, next) < tol) { pts.splice(i, 1); changed = true; i--; continue; }
      // spike: the path doubles back on itself through cur
      const u = sub(cur, prev), v = sub(next, cur);
      if (Math.abs(cross(u, v)) < tol * Math.max(len(u), len(v), 1e-9) && dot(u, v) < 0) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts;
}
