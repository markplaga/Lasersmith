import assert from 'node:assert/strict';
import box from '../src/generators/fingerbox.js';
import { defaults } from '../src/ui/params.js';
import { nest, sheetTransform } from '../src/geom/nest.js';
import { sheetSVG, sheetDXF, sheetLBRN2, exportBundle, makeZip } from '../src/export/formats.js';
import { sheetGeometry } from '../src/export/sheetgeom.js';
import { bbox, area } from '../src/geom/poly.js';
import zlib from 'node:zlib';

const mat = { name: '3 mm birch ply', thickness: 3, kerf: 0.15 };

await test('nesting fits every part inside the sheet margin without overlaps', () => {
  const des = box.generate({ ...defaults(box.params), width: 400, depth: 300, height: 200 }, mat);
  const n = nest(des, { sheetW: 914.4, sheetH: 609.6, margin: 5, gap: 3 });
  assert.equal(n.oversize.length, 0);
  assert.ok(n.sheets.length >= 1);
  for (const sh of n.sheets) {
    const boxes = sh.items.map(it => { const T = sheetTransform(it); return bbox(it.part.outline.map(T)); });
    for (const b of boxes) assert.ok(b.x >= 5 - 1e-9 && b.y >= 5 - 1e-9 && b.x1 <= 914.4 - 5 + 1e-9 && b.y1 <= 609.6 - 5 + 1e-9, JSON.stringify(b));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(a.x1 <= b.x || b.x1 <= a.x || a.y1 <= b.y || b.y1 <= a.y, 'overlap');
    }
  }
  assert.equal(n.sheets.reduce((a, s) => a + s.items.length, 0), des.parts.length);
});

await test('rotated nesting keeps parts unmirrored (det of sheet transform matches)', () => {
  const des = box.generate(defaults(box.params), mat);
  const it = { ...nest(des).sheets[0].items[0] };
  const a0 = area(it.part.outline.map(sheetTransform({ ...it, rot: false })));
  const a1 = area(it.part.outline.map(sheetTransform({ ...it, rot: true })));
  assert.equal(Math.sign(a0), Math.sign(a1));
});

await test('export: kerf grows outlines by exactly the kerf', () => {
  const des = box.generate(defaults(box.params), mat);
  const n = nest(des);
  const g = sheetGeometry(n.sheets[0], des);
  const it = n.sheets[0].items[0];
  const nominal = bbox(it.part.outline), cut = bbox(g.cutOuter[0].pts);
  const [w, h] = it.rot ? [nominal.h, nominal.w] : [nominal.w, nominal.h];
  assert.ok(Math.abs(cut.w - (w + 0.15)) < 1e-6 && Math.abs(cut.h - (h + 0.15)) < 1e-6);
});

await test('SVG is mm-accurate with LightBurn colours; DXF and LBRN2 are well formed', () => {
  const des = box.generate(defaults(box.params), mat);
  const sh = nest(des).sheets[0];
  const svg = sheetSVG(sh, des);
  assert.match(svg, /width="914\.4mm" height="609\.6mm" viewBox="0 0 914\.4 609\.6"/);
  assert.match(svg, /stroke="#FF0000"/);
  assert.ok(svg.indexOf('id="cut-inner"') === -1 || svg.indexOf('id="cut-inner"') < svg.indexOf('id="cut-outer"'));
  const dxf = sheetDXF(sh, des);
  assert.ok(dxf.startsWith('0\r\nSECTION') && dxf.trim().endsWith('EOF'));
  assert.equal((dxf.match(/\nPOLYLINE\r/g) || []).length, (dxf.match(/\nSEQEND\r/g) || []).length);
  const lb = sheetLBRN2(sh, des);
  assert.match(lb, /<LightBurnProject /);
  assert.equal((lb.match(/<Shape /g) || []).length, sh.items.length + des.parts.reduce((a, p) => a + p.engrave.length, 0));
});

await test('zip bundle round-trips (stored entries, valid CRC)', () => {
  const des = box.generate(defaults(box.params), mat);
  const z = exportBundle(nest(des), des);
  assert.equal(new DataView(z.buffer).getUint32(0, true), 0x04034b50);
  const tiny = makeZip([{ name: 'a.txt', data: 'hello' }]);
  // local header 30 + name 5, then the 5 data bytes
  assert.equal(new TextDecoder().decode(tiny.slice(35, 40)), 'hello');
  assert.equal(new DataView(tiny.buffer).getUint32(14, true), zlib.crc32 ? zlib.crc32('hello') : 0x3610a686);
});

await test('assembly guide: parts in assembly order with drawings, sheets, notes', async () => {
  const { assemblyGuide } = await import('../src/export/formats.js');
  const { assemblyOrder } = await import('../src/geom/order.js');
  const { default: robot } = await import('../src/generators/robot.js');
  const { defaults } = await import('../src/ui/params.js');
  const { nest } = await import('../src/geom/nest.js');
  const d = robot.generate(defaults(robot.params), { name: 'ply', thickness: 3, kerf: 0.15 });
  const n = nest(d, { sheetW: 914.4, sheetH: 609.6, margin: 5, gap: 3 });
  const order = assemblyOrder(d);
  assert.equal(order.length, d.parts.filter(p => p.place).length);
  // bottom up: the first part is no higher than the last
  const low = p => Math.min(...p.outline.map(([x, y]) => p.place.o[2] + x * p.place.u[2] + y * p.place.v[2]));
  assert.ok(low(order[0]) <= low(order[order.length - 1]));
  const html = assemblyGuide(n, d, { image: 'data:image/png;base64,AAAA' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Step 1') && html.includes('Cut sheets') && html.includes('data:image/png;base64,AAAA'));
  assert.equal((html.match(/<figure class="sheet">/g) || []).length, n.sheets.length);
  assert.ok(html.includes('wood dowel'));
});
