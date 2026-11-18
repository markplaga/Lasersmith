// Single-stroke font for engraved labels (part IDs, coupon values). Glyphs on a 4 wide x 6 tall grid.
// Strokes are polylines, so labels engrave as fast vector lines rather than raster fills.

const G = {
  '0': ['0,0 4,0 4,6 0,6 0,0', '0,0 4,6'],
  '1': ['1,5 2,6 2,0', '1,0 3,0'],
  '2': ['0,5 1,6 3,6 4,5 4,4 0,0 4,0'],
  '3': ['0,6 4,6 2,3.5 3,3.5 4,2.5 4,1 3,0 1,0 0,1'],
  '4': ['3,0 3,6 0,2 4,2'],
  '5': ['4,6 0,6 0,3.5 3,3.5 4,2.5 4,1 3,0 0,0'],
  '6': ['3.5,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2.5 3,3.5 0,3.5'],
  '7': ['0,6 4,6 1.5,0'],
  '8': ['1,3.5 0,4.5 0,5 1,6 3,6 4,5 4,4.5 3,3.5 1,3.5 0,2.5 0,1 1,0 3,0 4,1 4,2.5 3,3.5'],
  '9': ['4,2.5 1,2.5 0,3.5 0,5 1,6 3,6 4,5 4,1 3,0 0.5,0'],
  'A': ['0,0 0,4 2,6 4,4 4,0', '0,3 4,3'],
  'B': ['0,0 0,6 3,6 4,5 4,4 3,3 0,3', '3,3 4,2 4,1 3,0 0,0'],
  'C': ['4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5'],
  'D': ['0,0 0,6 3,6 4,5 4,1 3,0 0,0'],
  'E': ['4,0 0,0 0,6 4,6', '0,3 3,3'],
  'F': ['0,0 0,6 4,6', '0,3 3,3'],
  'G': ['4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3'],
  'H': ['0,0 0,6', '4,0 4,6', '0,3 4,3'],
  'I': ['1,0 3,0', '2,0 2,6', '1,6 3,6'],
  'J': ['0,1 1,0 2,0 3,1 3,6', '2,6 4,6'],
  'K': ['0,0 0,6', '4,6 0,2', '1.3,3.3 4,0'],
  'L': ['0,6 0,0 4,0'],
  'M': ['0,0 0,6 2,3 4,6 4,0'],
  'N': ['0,0 0,6 4,0 4,6'],
  'O': ['1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0'],
  'P': ['0,0 0,6 3,6 4,5 4,4 3,3 0,3'],
  'Q': ['1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0', '2.5,1.5 4,0'],
  'R': ['0,0 0,6 3,6 4,5 4,4 3,3 0,3', '2,3 4,0'],
  'S': ['4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1'],
  'T': ['0,6 4,6', '2,6 2,0'],
  'U': ['0,6 0,1 1,0 3,0 4,1 4,6'],
  'V': ['0,6 2,0 4,6'],
  'W': ['0,6 1,0 2,3 3,0 4,6'],
  'X': ['0,0 4,6', '0,6 4,0'],
  'Y': ['0,6 2,3 4,6', '2,3 2,0'],
  'Z': ['0,6 4,6 0,0 4,0'],
  '.': ['1.8,0 2.2,0 2.2,0.4 1.8,0.4 1.8,0'],
  ',': ['2,0.6 1.5,-0.8'],
  '-': ['0.5,3 3.5,3'],
  '+': ['0.5,3 3.5,3', '2,1.5 2,4.5'],
  '/': ['0,0 4,6'],
  ':': ['2,1 2,1.4', '2,4 2,4.4'],
  '=': ['0.5,2 3.5,2', '0.5,4 3.5,4'],
  '(': ['3,6 2,5 2,1 3,0'],
  ')': ['1,6 2,5 2,1 1,0'],
  '#': ['1,0 1.5,6', '2.5,0 3,6', '0,2 4,2', '0,4 4,4'],
  '"': ['1.3,6 1.3,4.8', '2.7,6 2.7,4.8'],
  "'": ['2,6 2,4.8'],
  ' ': [],
};
const parsed = {};
for (const ch in G) parsed[ch] = G[ch].map(s => s.split(' ').map(p => p.split(',').map(Number)));

export const GLYPH_W = 4, GLYPH_H = 6, ADVANCE = 5.5;

/** Width in mm of text at a given cap height. */
export function textWidth(text, size) {
  const n = String(text).length;
  return n ? ((n - 1) * ADVANCE + GLYPH_W) * (size / GLYPH_H) : 0;
}

/**
 * Polylines for text. (x, y) is the anchor; align 'left' | 'center' | 'right'; baseline at y.
 * Lowercase letters are drawn as capitals.
 */
export function strokeText(text, x, y, size, align = 'center', angleDeg = 0) {
  const s = size / GLYPH_H, str = String(text).toUpperCase();
  const w = textWidth(str, size);
  const x0 = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
  const t = (angleDeg * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  const out = [];
  [...str].forEach((ch, i) => {
    const g = parsed[ch] || parsed['#'];
    for (const stroke of g) {
      out.push(stroke.map(([gx, gy]) => {
        const lx = x0 + (i * ADVANCE + gx) * s, ly = gy * s;
        return [x + lx * c - ly * sn, y + lx * sn + ly * c];
      }));
    }
  });
  return out;
}
