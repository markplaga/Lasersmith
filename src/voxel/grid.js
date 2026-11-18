// Voxel grids for sculptures (PRD section 9): a box of nx x ny x nz cells, x right, y back, z up.

export function makeGrid(nx, ny, nz) {
  return { nx, ny, nz, cells: new Uint8Array(nx * ny * nz) };
}
export const idx = (g, x, y, z) => x + g.nx * (y + g.ny * z);
export function get(g, x, y, z) {
  return x >= 0 && y >= 0 && z >= 0 && x < g.nx && y < g.ny && z < g.nz ? g.cells[idx(g, x, y, z)] : 0;
}
export function set(g, x, y, z, v = 1) {
  if (x >= 0 && y >= 0 && z >= 0 && x < g.nx && y < g.ny && z < g.nz) g.cells[idx(g, x, y, z)] = v ? 1 : 0;
}
export const count = g => g.cells.reduce((a, b) => a + b, 0);
export function clone(g) { return { nx: g.nx, ny: g.ny, nz: g.nz, cells: g.cells.slice() }; }

/** Compact text form: "nx,ny,nz;" then run lengths, alternating empty/full, starting with empty. */
export function encode(g) {
  const runs = [];
  let cur = 0, n = 0;
  for (const c of g.cells) { if (c === cur) n++; else { runs.push(n); cur = c; n = 1; } }
  runs.push(n);
  return `${g.nx},${g.ny},${g.nz};${runs.join('.')}`;
}
export function decode(s) {
  const m = /^(\d+),(\d+),(\d+);([\d.]*)$/.exec(String(s || '').trim());
  if (!m) throw new Error('Not a voxel grid');
  const g = makeGrid(+m[1], +m[2], +m[3]);
  if (g.cells.length > 128 ** 3) throw new Error('Voxel grid too large');
  let i = 0, cur = 0;
  for (const r of m[4].split('.').filter(Boolean)) {
    const n = +r;
    if (cur) g.cells.fill(1, i, Math.min(g.cells.length, i + n));
    i += n; cur ^= 1;
  }
  return g;
}

/** Fill cells where f(x, y, z) is true; coordinates are cell centres. */
export function fromFunction(nx, ny, nz, f) {
  const g = makeGrid(nx, ny, nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (f(x + 0.5, y + 0.5, z + 0.5)) set(g, x, y, z);
  return g;
}

const ell = (x, y, z, cx, cy, cz, rx, ry, rz) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1;

/** Built-in figures, so the sculpture works without the editor or Claude. */
export const FIGURES = {
  cat: { label: 'Sitting cat', make: () => fromFunction(14, 12, 20, (x, y, z) =>
    ell(x, y, z, 7, 6.5, 5, 5.2, 4.6, 5.2) ||                       // body
    ell(x, y, z, 7, 5, 12.5, 4.2, 3.8, 3.6) ||                      // head
    (z > 14.5 && z < 18.5 && y > 3.5 && y < 6.5 && (Math.abs(x - 4.5) < 1.6 - (z - 14.5) * 0.35 || Math.abs(x - 9.5) < 1.6 - (z - 14.5) * 0.35)) || // ears
    (z < 3 && y < 4 && (Math.abs(x - 5) < 1.2 || Math.abs(x - 9) < 1.2)) || // front paws
    (z < 2 && x > 11 && y > 3 && y < 11)) },                       // tail curled at the base
  rocket: { label: 'Rocket', make: () => fromFunction(12, 12, 24, (x, y, z) => {
    const r = Math.hypot(x - 6, y - 6);
    if (z < 17) return r < 3.6 || (z < 6 && (Math.abs(x - 6) < 0.9 || Math.abs(y - 6) < 0.9) && r < 6);
    return r < 3.6 * (1 - (z - 17) / 7.2);
  }) },
  heart: { label: 'Heart', make: () => fromFunction(16, 8, 15, (x, y, z) => {
    const X = (x - 8) / 6.5, Z = (z - 6) / 6.5, Y = (y - 4) / 3.2;
    return (X * X + Z * Z - 1) ** 3 - X * X * Z * Z * Z <= 0 && Math.abs(Y) <= 1 - Math.max(0, X * X + Z * Z - 0.6) * 0.2;
  }) },
  tree: { label: 'Pine tree', make: () => fromFunction(13, 13, 22, (x, y, z) => {
    const r = Math.hypot(x - 6.5, y - 6.5);
    if (z < 4) return r < 1.6;
    const k = (z - 4) % 6, tier = Math.floor((z - 4) / 6);
    return r < (6 - tier * 1.4) * (1 - k / 7.5) + 0.5;
  }) },
};
