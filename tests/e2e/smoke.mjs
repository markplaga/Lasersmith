// Browser smoke test: node tests/e2e/smoke.mjs [pyodideDir]
// Serves dist/, opens the app in Chromium (Playwright), checks the native box renders and exports,
// then (if a local Pyodide folder is given) opens a boxes.py design with Pyodide served locally.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const pyDir = process.argv[2];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.zip': 'application/zip', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const shots = process.env.SHOTS || path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
if (pyDir) {
  await ctx.route(/cdn\.jsdelivr\.net\/pyodide\/v[^/]+\/full\/(.*)$/, (route, req) => {
    const f = path.join(pyDir, new URL(req.url()).pathname.split('/full/')[1]);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404 });
    route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
  });
}
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let fail = 0;
const check = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.__lasersmith && window.__lasersmith.design);
let st = await page.evaluate(() => ({ parts: __lasersmith.design.parts.length, issues: __lasersmith.issues, sheets: __lasersmith.nested.sheets.length }));
check(st.parts === 6, 'finger box has 6 parts');
check(!st.issues.some(i => i.level === 'error'), 'finger box has no errors');
check(await page.locator('#sheet svg path').count() > 6, 'sheet preview drawn');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(shots, 'finger-box.png') });

// edit a parameter
await page.fill('[data-key=width]', '200');
await page.waitForFunction(() => __lasersmith.design.view.bounds[0] === 200);
check(true, 'width parameter regenerates the design');

// export LBRN2
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export=lbrn2]')]);
const body = fs.readFileSync(await dl.path(), 'utf8');
check(body.includes('<LightBurnProject'), 'LBRN2 download');
const [dz] = await Promise.all([page.waitForEvent('download'), page.click('[data-export=zip]')]);
check(fs.statSync(await dz.path()).size > 1000, 'zip download');

// inches
await page.click('#unitSeg [data-u=in]');
const w = await page.inputValue('[data-key=width]');
check(Math.abs(parseFloat(w) - 200 / 25.4) < 0.01, 'inch display ' + w);
await page.click('#unitSeg [data-u=mm]');

// coupon
await page.click('[data-id=fit-coupon]');
await page.waitForFunction(() => __lasersmith.design && __lasersmith.design.generator.id === 'fit-coupon');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(shots, 'coupon.png') });
check(true, 'kerf coupon opens');

if (pyDir) {
  await page.click('[data-id=bx-flexbox]');
  await page.waitForFunction(() => __lasersmith.design && __lasersmith.design.generator.id === 'bx-flexbox', null, { timeout: 120000 });
  st = await page.evaluate(() => ({ parts: __lasersmith.design.parts.length, issues: __lasersmith.issues }));
  check(st.parts >= 3, 'boxes.py FlexBox renders in the browser (' + st.parts + ' parts)');
  check(!st.issues.some(i => i.level === 'error'), 'FlexBox has no errors ' + JSON.stringify(st.issues.slice(0, 2)));
  await page.fill('[data-key=x]', '150');
  await page.waitForFunction(() => __lasersmith.design.generator.params.x === 150, null, { timeout: 30000 });
  check(true, 'boxes.py parameter edit re-renders');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, 'flexbox.png') });
}
check(errors.length === 0, 'no console errors ' + errors.slice(0, 3).join(' | '));
await page.setViewportSize({ width: 390, height: 844 });
await page.click('[data-id=finger-box]');
await page.waitForTimeout(600);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 0, 'no horizontal scroll at phone width (' + overflow + ')');
await page.screenshot({ path: path.join(shots, 'phone.png'), fullPage: false });
await browser.close();
server.close();
console.log(fail ? `${fail} failed` : 'smoke passed');
process.exit(fail ? 1 : 0);
