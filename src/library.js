// The M1 library: native generators plus the curated boxes.py catalogue.
import fingerBox from './generators/fingerbox.js';
import fitCoupon from './generators/fitcoupon.js';
import hingeCoupon from './generators/hingecoupon.js';
import robot from './generators/robot.js';
import voxel from './generators/voxel.js';
import assembly from './generators/assembly.js';
import { BOXES_CATALOG } from './boxespy/catalog.js';

export const NATIVE = [fingerBox, fitCoupon, hingeCoupon, robot, assembly, voxel];

export const LIBRARY = [
  ...NATIVE.map(g => ({ id: g.id, title: g.title, category: g.category, source: 'native', description: g.description, tags: g.tags, gen: g })),
  ...BOXES_CATALOG,
];

export const byId = id => LIBRARY.find(e => e.id === id);

export const MATERIALS = [
  { id: 'birch3', name: '3 mm birch ply', thickness: 3, kerf: 0.15, color: '#e2c08d', side: '#b98a58' },
  { id: 'birch6', name: '6 mm birch ply', thickness: 6, kerf: 0.18, color: '#e2c08d', side: '#b98a58' },
  { id: 'mdf3', name: '3 mm MDF', thickness: 3, kerf: 0.15, color: '#a87c52', side: '#7a5434' },
  { id: 'acrylic3', name: '3 mm acrylic', thickness: 3, kerf: 0.12, color: '#bfe3ec', side: '#8cc3d1', opacity: 0.55 },
];

/** Mark's machine: 24" x 36" bed (X 36", Y 24"), LightBurn. */
export const MACHINE = { bedW: 914.4, bedH: 609.6, margin: 5, gap: 3, stock: 'bed', stockW: 609.6, stockH: 304.8, grain: 'free' };

/** Common stock sheet sizes (inches, as sold), plus the full bed and a custom size. */
export const STOCK = [
  { id: 'bed', label: 'Full bed' },
  { id: '12x12', label: '12 x 12 in', w: 304.8, h: 304.8 },
  { id: '12x24', label: '24 x 12 in', w: 609.6, h: 304.8 },
  { id: '18x24', label: '24 x 18 in', w: 609.6, h: 457.2 },
  { id: '24x24', label: '24 x 24 in', w: 609.6, h: 609.6 },
  { id: 'custom', label: 'Custom size' },
];

/** The sheet the parts are nested on: the stock size, never larger than the bed. */
export function sheetSize(m) {
  const st = STOCK.find(s => s.id === m.stock) || STOCK[0];
  let w = +m.bedW, h = +m.bedH;
  if (st.id === 'custom') { w = +m.stockW || w; h = +m.stockH || h; }
  else if (st.w) { w = st.w; h = st.h; }
  return { w: Math.min(w, +m.bedW), h: Math.min(h, +m.bedH), stock: st.id !== 'bed', label: st.id === 'bed' ? 'bed' : 'stock sheet' };
}
