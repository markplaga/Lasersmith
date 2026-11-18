// Lasersmith build (Polysmith style: src/ is inlined into self-contained HTML).
//   dist/index.html      static site page (fetches dist/boxespy.zip when a boxes.py design is opened)
//   dist/boxespy.zip     boxes.py + deps + bridge.py, unpacked into Pyodide at runtime
//   dist/artifact.html   one self-contained file for Claude mode (the zip is inlined as base64)
// Usage: node build.js [--watch]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const VENDOR = path.join(ROOT, 'vendor', 'boxespy');

async function bundle(entry) {
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'iife', minify: true, write: false,
    target: ['es2020'], legalComments: 'none', logLevel: 'silent',
  });
  return r.outputFiles[0].text;
}

/* ---------- deflate zip of the Python bundle ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipDeflate(files) {
  const chunks = [], central = [];
  let off = 0;
  for (const f of files) {
    const nm = Buffer.from(f.name), raw = f.data, crc = crc32(raw), comp = zlib.deflateRawSync(raw, { level: 9 });
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    chunks.push(h, nm, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nm);
    off += 30 + nm.length + comp.length;
  }
  const cs = central.reduce((a, b) => a + b.length, 0), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cs, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...chunks, ...central, e]);
}
function walk(dir, base = dir, out = []) {
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n), st = fs.statSync(p);
    if (st.isDirectory()) { if (n !== '__pycache__') walk(p, base, out); }
    else if (/\.(py|txt|json|LICENSE)$/.test(n) || n.endsWith('LICENSE') || n === 'BOXES_COMMIT') out.push({ name: path.relative(base, p).split(path.sep).join('/'), data: fs.readFileSync(p) });
  }
  return out;
}
export function pythonBundle() {
  const files = walk(VENDOR);
  files.push({ name: 'bridge.py', data: fs.readFileSync(path.join(ROOT, 'src', 'boxespy', 'bridge.py')) });
  return zipDeflate(files);
}

const inlineScript = s => s.replace(/<\/script/gi, '<\\/script');

export async function build() {
  fs.mkdirSync(DIST, { recursive: true });
  const [app, worker, genWorker] = await Promise.all([bundle('src/main.js'), bundle('src/boxespy/worker.js'), bundle('src/claude/genworker.js')]);
  const zip = pythonBundle();
  const tpl = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  const page = (cfg, zipTag) => tpl
    .replace('<!--CONFIG-->', () => `<script>window.LASERSMITH_CONFIG=${JSON.stringify(cfg)}</script>`)
    .replace('<!--WORKER-->', () => `<script type="text/plain" id="ls-worker">${inlineScript(worker)}</script>`)
    .replace('<!--GENWORKER-->', () => `<script type="text/plain" id="ls-genworker">${inlineScript(genWorker)}</script>`)
    .replace('<!--BOXESZIP-->', () => zipTag)
    .replace('/*APP*/', () => inlineScript(app));
  const site = page({ boxesZip: 'boxespy.zip', build: 'site' }, '');
  const artifact = page({ build: 'artifact' }, `<script type="application/octet-stream" id="ls-boxes-zip">${zip.toString('base64')}</script>`);
  fs.writeFileSync(path.join(DIST, 'index.html'), site);
  fs.writeFileSync(path.join(DIST, 'boxespy.zip'), zip);
  fs.writeFileSync(path.join(DIST, 'artifact.html'), artifact);
  const kb = n => (n / 1024).toFixed(0) + ' KB';
  console.log(`built dist/index.html ${kb(site.length)}, dist/boxespy.zip ${kb(zip.length)}, dist/artifact.html ${kb(artifact.length)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
  if (process.argv.includes('--watch')) {
    console.log('watching src/ ...');
    let t = 0;
    fs.watch(path.join(ROOT, 'src'), { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => build().catch(e => console.error(e.message)), 150); });
  }
}
