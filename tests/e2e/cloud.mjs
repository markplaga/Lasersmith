// Browser test for accounts and the shared library (M4) with the in-memory store standing in for
// Supabase: node tests/e2e/cloud.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const url = `http://localhost:${server.address().port}/`;
const shots = process.env.SHOTS || path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
let fail = 0;
const check = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

const seed = {
  designs: [
    { id: 'pub1', owner: 'u-ada', author_name: 'Ada', title: 'Ada tea box', description: 'A wide box for tea', generator: 'finger-box', params: { width: 150 }, visibility: 'public', checked: true, version: 2, tags: [] },
    { id: 'hid1', owner: 'u-ada', author_name: 'Ada', title: 'Ada secret box', description: '', generator: 'finger-box', params: { width: 120 }, visibility: 'unlisted', checked: true, version: 1, tags: [] },
    { id: 'priv1', owner: 'u-ada', author_name: 'Ada', title: 'Ada private box', description: '', generator: 'finger-box', params: {}, visibility: 'private', checked: true, version: 1, tags: [] },
  ],
};
const open = async (q = '') => {
  const page = await (await browser.newContext()).newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await page.addInitScript(s => { window.__LASERSMITH_MEMORY_CLOUD__ = s; }, seed);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url + q);
  await page.waitForFunction(() => window.__lasersmith && window.__lasersmith.design);
  await page.waitForTimeout(500);
  return { page, errors };
};
const lib = page => page.evaluate(() => [...document.querySelectorAll('#lib .lib-item')].map(b => b.textContent));

// 1. Signed out: the community library lists public designs only, and they open
{
  const { page, errors } = await open();
  const items = await lib(page);
  check(items.some(t => t.includes('Ada tea box') && t.includes('by Ada')), 'community design listed with its author');
  check(!items.some(t => t.includes('secret') || t.includes('private')), 'unlisted and private designs are not listed');
  check(await page.isVisible('#acctBtn') && (await page.textContent('#acctBtn')).includes('Sign in'), 'sign-in button shows');
  await page.click('.lib-item[data-id="cloud-pub1"]');
  await page.waitForFunction(() => window.__lasersmith.state.entry === 'cloud-pub1' && window.__lasersmith.design.title.includes('150'));
  check(true, 'opening a shared design uses its saved parameters');
  check((await page.textContent('#cloudTools')).includes('Sign in'), 'signed out: invited to sign in to save');

  // 2. Sign in, save a copy, share it
  await page.click('#acctBtn');
  await page.fill('#acctEmail', 'mark@example.com');
  await page.click('#acctForm button[type=submit]');
  await page.waitForTimeout(400);
  check((await page.textContent('#acctBtn')).includes('mark'), 'signed in');
  await page.click('#cloudTools [data-ct=fork]');
  await page.waitForTimeout(700);
  let st = await page.evaluate(() => ({ entry: window.__lasersmith.state.entry, rows: window.__lasersmith.store._rows.filter(r => r.owner === 'u-mark@example.com') }));
  check(st.rows.length === 1 && st.rows[0].fork_of === 'pub1' && st.rows[0].params.width === 150 && st.entry === 'cloud-' + st.rows[0].id, 'save a copy: private fork with the parameters ' + JSON.stringify(st.rows.map(r => r.title)));
  await page.selectOption('#cloudTools select[data-ct=vis]', 'public');
  await page.waitForTimeout(400);
  st = await page.evaluate(() => window.__lasersmith.store._rows.find(r => r.owner === 'u-mark@example.com'));
  check(st.visibility === 'public' && st.version === 2, 'shared publicly, as a new version');
  check(await page.isVisible('#cloudTools [data-ct=link]'), 'copy link offered once shared');
  await page.screenshot({ path: path.join(shots, 'cloud-shared.png') });

  // 3. Save a library design as your own variant, then change it
  await page.click('.lib-item[data-id="finger-box"]');
  await page.waitForTimeout(300);
  await page.fill('#params input[data-key=height]', '90');
  await page.waitForTimeout(400);
  await page.click('#cloudTools [data-ct=save]');
  await page.waitForTimeout(700);
  st = await page.evaluate(() => window.__lasersmith.store._rows.filter(r => r.owner === 'u-mark@example.com' && r.generator === 'finger-box' && !r.fork_of));
  check(st.length === 1 && st[0].params.height === 90, 'library design saved with its parameters');
  check((await lib(page)).some(t => t.includes('Finger-jointed box') && t.includes('Saved')), 'listed under your account');

  // 4. Data export and sign out
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('#acctBtn'); await page.click('#acctExport'); })()]);
  const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check(data.designs.length === 2, 'download all my data');
  await page.click('#acctBtn').catch(() => {});
  if (await page.isHidden('#acctPop')) await page.click('#acctBtn');
  await page.click('#acctOut');
  await page.waitForTimeout(400);
  check((await page.textContent('#acctBtn')).includes('Sign in'), 'signed out');
  check(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await page.close();
}

// 5. An unlisted design opens from its link; a private one does not
{
  const { page } = await open('?d=hid1');
  await page.waitForFunction(() => window.__lasersmith.state.entry === 'cloud-hid1', null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => window.__lasersmith.state.entry === 'cloud-hid1' && window.__lasersmith.design.title.includes('120')), 'unlisted design opens from its link');
  await page.close();
  const p2 = await open('?d=priv1');
  await p2.page.waitForTimeout(400);
  check(await p2.page.evaluate(() => window.__lasersmith.state.entry !== 'cloud-priv1'), "someone else's private design does not open");
  await p2.page.close();
}

// 6. Without a store (no Supabase configured) nothing about accounts shows
{
  const page = await (await browser.newContext()).newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await page.goto(url);
  await page.waitForFunction(() => window.__lasersmith && window.__lasersmith.design);
  check(await page.isHidden('#acctBtn') && await page.isHidden('#cloudTools'), 'no account UI without a backend');
  await page.close();
}

await browser.close();
server.close();
console.log(fail ? `cloud e2e: ${fail} failed` : 'cloud e2e passed');
process.exit(fail ? 1 : 0);
