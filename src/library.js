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
export const MACHINE = { bedW: 914.4, bedH: 609.6, margin: 5, gap: 3 };
