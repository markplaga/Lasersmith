// Voxel sculpture (PRD section 9): a figure from the built-in set or the voxel editor, sliced into two
// families of interlocking flat pieces.

import { FIGURES, decode, count } from '../voxel/grid.js';
import { sculpt } from '../voxel/slice.js';
import { makeDesign } from '../geom/design.js';

const FAM = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };

export function gridFor(p) {
  if (p.figure === 'custom' && p.grid) {
    try { return decode(p.grid); } catch (e) { /* fall back */ }
  }
  return (FIGURES[p.figure] || FIGURES.cat).make();
}

export default {
  id: 'voxel-sculpture',
  title: 'Voxel sculpture',
  category: 'Sculptures',
  source: 'native',
  description: 'A figure built from flat pieces at right angles that slot together. Pick a figure or draw your own in the voxel editor, choose the voxel size and which way the pieces run.',
  tags: ['voxel', 'sculpture', 'egg crate', 'slice', 'figure'],
  params: [
    { key: 'figure', label: 'Figure', type: 'select', default: 'rocket', group: 'Figure', choices: [...Object.entries(FIGURES).map(([value, f]) => ({ value, label: f.label })), { value: 'custom', label: 'My drawing (voxel editor)' }] },
    { key: 'grid', label: 'Voxels', type: 'text', default: '', group: 'Figure', hidden: true },
    { key: 'voxel', label: 'Voxel size', type: 'length', default: 15, min: 5, max: 60, group: 'Figure', help: 'Size of one cube. The figure is this times the grid size.' },
    { key: 'families', label: 'Pieces run', type: 'select', default: 'xy', group: 'Pieces', choices: [{ value: 'xy', label: 'Side to side and front to back (stand up)' }, { value: 'xz', label: 'Side to side and flat layers' }, { value: 'yz', label: 'Front to back and flat layers' }] },
    { key: 'spacing', label: 'Plane spacing', type: 'int', default: 2, min: 1, max: 6, group: 'Pieces', help: 'A piece every N voxel layers. 1 = every layer: most detail, but pieces become combs; 2 or 3 is usually best.' },
    { key: 'labels', label: 'Engrave piece numbers', type: 'bool', default: true, group: 'Pieces' },
  ],
  generate(p, material) {
    const g = gridFor(p);
    const t = material.thickness;
    const r = sculpt(g, { voxel: p.voxel, families: FAM[p.families] || FAM.xy, spacing: p.spacing, t, labels: p.labels });
    const notes = [...r.notes];
    if (!count(g)) notes.push('The figure is empty: draw some voxels in the editor.');
    const name = p.figure === 'custom' ? 'My voxel figure' : (FIGURES[p.figure] || FIGURES.cat).label;
    return makeDesign({
      title: `${name} sculpture`,
      generator: { id: 'voxel-sculpture', params: p },
      material,
      parts: r.parts,
      notes,
      info: r.info,
      view: { bounds: [g.nx * p.voxel, g.ny * p.voxel, g.nz * p.voxel] },
    });
  },
};
