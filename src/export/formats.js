// SVG, DXF (R12) and LightBurn .lbrn2 writers for one nested sheet, plus a tiny ZIP writer.

import { sheetGeometry, LAYERS, r3 } from './sheetgeom.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const d = (pts, closed) => 'M' + pts.map(p => r3(p[0]) + ' ' + r3(p[1])).join('L') + (closed ? 'Z' : '');

/**
 * mm-accurate SVG. Layers are groups with LightBurn's palette colours.
 * opts.preview adds a sheet background and part labels for on-screen use (never in exported files).
 */
export function sheetSVG(sheet, design, opts = {}) {
  const g = sheetGeometry(sheet, design);
  const pv = !!opts.preview;
  const sw = pv ? Math.max(0.4, sheet.w / 600) : 0.1;
  const st = c => `fill="none" stroke="${c}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"`;
  const grp = (id, attrs, body) => (body ? `<g id="${id}" ${attrs}>${body}</g>` : '');
  const fill = g.fill.map(loops => `<path d="${loops.map(l => d(l, true)).join('')}"/>`).join('');
  const line = arr => arr.map(p => `<path d="${d(p.pts, p.closed)}"/>`).join('');
  const circles = g.circles.map(c => `<circle cx="${r3(c.cx)}" cy="${r3(c.cy)}" r="${r3(c.r)}"/>`).join('');
  let labels = '';
  if (pv) {
    for (const l of g.labels) {
      const fs = Math.max(4, Math.min(14, l.w / 10, l.h / 4));
      labels += `<text x="${r3(l.x)}" y="${r3(l.y)}" font-size="${r3(fs)}" text-anchor="middle" dominant-baseline="central">${esc(l.text)}</text>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(sheet.w)}mm" height="${r3(sheet.h)}mm" viewBox="0 0 ${r3(sheet.w)} ${r3(sheet.h)}">`
    + (pv ? `<rect width="${r3(sheet.w)}" height="${r3(sheet.h)}" fill="#f6efe2" stroke="#b9ab92" stroke-width="${sw}"/>` : '')
    + (pv ? '' : `<title>${esc(design.title)}</title><desc>Lasersmith export. Units mm. Material ${esc(design.material.name)} ${design.material.thickness} mm, kerf ${design.material.kerf} mm${design.kerfApplied ? ' (applied by generator)' : ' (applied)'}.</desc>`)
    + grp('fill-engrave', `fill="${pv ? '#3a3a3a' : LAYERS.fill.color}" fill-rule="evenodd" stroke="none"`, fill)
    + grp('line-engrave', st(LAYERS.engrave.color), line(g.engrave))
    + grp('score', st(LAYERS.score.color), line(g.score))
    + grp('cut-inner', st(LAYERS.cut.color), line(g.cutInner) + circles)
    + grp('cut-outer', st(LAYERS.cut.color), line(g.cutOuter))
    + (pv ? `<g fill="#8a7f6c" font-family="IBM Plex Sans, system-ui, sans-serif" style="pointer-events:none">${labels}</g>` : '')
    + '</svg>';
}

/** DXF R12 (POLYLINE/CIRCLE), millimetres, y-up. One layer per operation. */
export function sheetDXF(sheet, design) {
  const g = sheetGeometry(sheet, design);
  const H = sheet.h, L = [];
  const P = (...a) => L.push(...a);
  P('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC');
  P('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '4');
  for (const k of ['cut', 'score', 'engrave', 'fill']) P('0', 'LAYER', '2', LAYERS[k].dxfLayer, '70', '0', '62', String(LAYERS[k].dxfColor), '6', 'CONTINUOUS');
  P('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  const poly = (pts, closed, layer) => {
    P('0', 'POLYLINE', '8', layer, '66', '1', '10', '0', '20', '0', '30', '0', '70', closed ? '1' : '0');
    for (const p of pts) P('0', 'VERTEX', '8', layer, '10', r3(p[0]), '20', r3(H - p[1]), '30', '0');
    P('0', 'SEQEND', '8', layer);
  };
  g.fill.forEach(loops => loops.forEach(l => poly(l, true, LAYERS.fill.dxfLayer)));
  g.engrave.forEach(p => poly(p.pts, p.closed, LAYERS.engrave.dxfLayer));
  g.score.forEach(p => poly(p.pts, p.closed, LAYERS.score.dxfLayer));
  g.cutInner.forEach(p => poly(p.pts, p.closed, LAYERS.cut.dxfLayer));
  for (const c of g.circles) P('0', 'CIRCLE', '8', LAYERS.cut.dxfLayer, '10', r3(c.cx), '20', r3(H - c.cy), '30', '0', '40', r3(c.r));
  g.cutOuter.forEach(p => poly(p.pts, p.closed, LAYERS.cut.dxfLayer));
  P('0', 'ENDSEC', '0', 'EOF');
  return L.join('\r\n') + '\r\n';
}

/**
 * LightBurn project. Coordinates are y-up from the bottom-left of the sheet.
 * Cut is priority last so engraves and scores run before parts drop out.
 */
export function sheetLBRN2(sheet, design) {
  const g = sheetGeometry(sheet, design);
  const H = sheet.h;
  const y = v => r3(H - v);
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<LightBurnProject AppVersion="1.0.06" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">');
  const settings = [['fill', 'Scan', 0], ['engrave', 'Cut', 1], ['score', 'Cut', 2], ['cut', 'Cut', 3]];
  for (const [k, type, pri] of settings) {
    const Ly = LAYERS[k];
    out.push(`  <CutSetting Type="${type}"><index Value="${Ly.lbIndex}"/><name Value="${Ly.name}"/><priority Value="${pri}"/></CutSetting>`);
  }
  const path = (pts, closed, idx) => {
    const verts = pts.map(p => `V${r3(p[0])} ${y(p[1])}`).join('');
    const prims = closed ? 'LineClosed' : pts.slice(1).map((_, i) => `L${i} ${i + 1}`).join('');
    out.push(`  <Shape Type="Path" CutIndex="${idx}"><VertList>${verts}</VertList><PrimList>${prims}</PrimList></Shape>`);
  };
  g.fill.forEach(loops => loops.forEach(l => path(l, true, LAYERS.fill.lbIndex)));
  g.engrave.forEach(p => path(p.pts, p.closed, LAYERS.engrave.lbIndex));
  g.score.forEach(p => path(p.pts, p.closed, LAYERS.score.lbIndex));
  g.cutInner.forEach(p => path(p.pts, p.closed, LAYERS.cut.lbIndex));
  for (const c of g.circles) out.push(`  <Shape Type="Ellipse" CutIndex="${LAYERS.cut.lbIndex}" Rx="${r3(c.r)}" Ry="${r3(c.r)}"><XForm>1 0 0 1 ${r3(c.cx)} ${y(c.cy)}</XForm></Shape>`);
  g.cutOuter.forEach(p => path(p.pts, p.closed, LAYERS.cut.lbIndex));
  out.push(`  <Notes ShowOnLoad="0" Notes="${esc(`${design.title}. Made with Lasersmith. ${design.material.name} ${design.material.thickness} mm, kerf ${design.material.kerf} mm.`)}"/>`);
  out.push('</LightBurnProject>');
  return out.join('\n') + '\n';
}

/* ---------- ZIP (stored, no compression) ---------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** @param files [{name, data: string | Uint8Array}] @returns Uint8Array */
export function makeZip(files) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    chunks.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const csz = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csz, true); e.setUint32(16, off, true);
  const all = [...chunks, ...central, new Uint8Array(e.buffer)];
  const total = all.reduce((a, b) => a + b.length, 0), buf = new Uint8Array(total);
  let p = 0;
  for (const a of all) { buf.set(a, p); p += a.length; }
  return buf;
}

/** All sheets in every format plus a README, as one zip. */
export function exportBundle(nested, design, { formats = ['svg', 'dxf', 'lbrn2'] } = {}) {
  const base = slug(design.title);
  const files = [];
  nested.sheets.forEach((s, i) => {
    const n = nested.sheets.length > 1 ? `-sheet${i + 1}` : '';
    if (formats.includes('svg')) files.push({ name: `${base}${n}.svg`, data: sheetSVG(s, design) });
    if (formats.includes('dxf')) files.push({ name: `${base}${n}.dxf`, data: sheetDXF(s, design) });
    if (formats.includes('lbrn2')) files.push({ name: `${base}${n}.lbrn2`, data: sheetLBRN2(s, design) });
  });
  files.push({ name: 'README.txt', data: readme(nested, design) });
  files.push({ name: `${base}.lasersmith.json`, data: JSON.stringify({ format: design.format, version: design.version, title: design.title, generator: design.generator, material: design.material }, null, 2) });
  return makeZip(files);
}

export function readme(nested, design) {
  const lines = [
    design.title, '',
    `Material: ${design.material.name}, ${design.material.thickness} mm thick, kerf ${design.material.kerf} mm.`,
    design.kerfApplied ? 'Kerf compensation was applied by the generator (boxes.py burn).' : 'Kerf compensation is already applied: outlines are grown and holes shrunk by half the kerf.',
    `Sheets: ${nested.sheets.length} at ${nested.sheets[0] ? nested.sheets[0].w + ' x ' + nested.sheets[0].h : '-'} mm.`, '',
    'Layers (LightBurn palette): red = cut, blue = score, green = line engrave, black = fill engrave.',
    'Run engrave and score layers before cut. Inner cuts are listed before outer cuts.', '',
    'Parts:', ...design.parts.map(p => `  ${p.qty} x ${p.name}`), '',
    'Made with Lasersmith (GPL-3.0).',
  ];
  return lines.join('\n') + '\n';
}

export const slug = s => String(s || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'design';
