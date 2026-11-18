// Browser test for Claude mode with a stand-in for window.claude: node tests/e2e/claude.mjs
// Checks the create -> repair -> change flow, the sandbox locks, and that the panel hides without Claude.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { EXAMPLE_SIMPLE } from '../../src/claude/prompt.js';
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

// 1. Standalone: panel explains it needs Claude
{
  const page = await (await browser.newContext()).newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await page.goto(url);
  await page.waitForFunction(() => window.__lasersmith && window.__lasersmith.design);
  check(await page.isVisible('#cpOff') && !(await page.isVisible('#cpOn')), 'standalone: Claude panel explains it needs Claude');
  await page.close();
}

// 2. Claude mode with a scripted stand-in
const broken = "Here is a pencil cup.\n```js\nreturn { title: 'Cup', params: [], generate(p, m, api) { return api.makeDesign({ title: 'Cup', material: m, parts: [{ name: 'Bad', outline: [[0,0],[10,10],[10,0],[0,10]] }] }); } };\n```";
const good = 'Fixed the crossing outline.\n```js\n' + EXAMPLE_SIMPLE + '\n```';
const taller = 'Made it taller.\n```js\n' + EXAMPLE_SIMPLE.replace("default: 100", "default: 160") + '\n```';
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(({ replies }) => {
  const calls = [];
  const sample = async (turns, opts) => {
    calls.push(turns.map(t => t.content));
    const last = turns[turns.length - 1].content;
    const text = /taller/.test(last) ? replies.taller : /found problems/.test(last) ? replies.good : replies.broken;
    await new Promise(r => setTimeout(r, 50));
    opts && opts.onText && opts.onText({ text, delta: text });
    return { text, truncated: false };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144 });
  window.__calls = calls;
  window.claude = { use: async name => (name === 'sample' ? sample : null) };
}, { replies: { broken, good, taller } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.route(/fonts\.(googleapis|gstatic)\.com|jsdelivr/, r => r.fulfill({ status: 200, body: '' }));
await page.goto(url);
await page.waitForFunction(() => window.__lasersmith && window.__lasersmith.design);
await page.waitForSelector('#cpOn:not([hidden])');
check(await page.textContent('#mode') === 'Claude connected', 'Claude detected');

await page.fill('#cpAsk', 'a pencil cup with my name');
await page.click('#cpGo');
await page.waitForFunction(() => __lasersmith.mine.length === 1 && __lasersmith.design && __lasersmith.design.generator.source === 'claude', null, { timeout: 30000 });
let st = await page.evaluate(() => ({ calls: __calls.length, title: __lasersmith.mine[0].title, errs: __lasersmith.issues.filter(i => i.level === 'error').length, chat: __lasersmith.mine[0].chat.map(c => c.role) }));
check(st.calls === 2 && st.title === 'Pencil cup' && st.errs === 0, 'create: broken first try is repaired automatically ' + JSON.stringify(st));
check(JSON.stringify(st.chat) === '["user","assistant"]', 'chat kept with the design');
check((await page.textContent('#lib')).includes('Your designs'), 'design listed under Your designs');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(shots, 'claude-create.png') });

// params from the generator work without Claude
await page.fill('input[data-key=w]', '120');
await page.waitForFunction(() => __lasersmith.design.parts.find(p => p.id === 'bottom') && Math.abs(__lasersmith.design.parts.find(p => p.id === 'bottom').outline.reduce((a, q) => Math.max(a, q[0]), 0) - 120) < 1e-6, null, { timeout: 10000 });
check(true, 'generator parameters regenerate in the sandbox');

// change it
check(await page.getAttribute('.cp-mode [data-m=change]', 'class') === 'on', 'panel switches to "Change this one" for a Claude design');
await page.fill('#cpAsk', 'make it taller');
await page.click('#cpGo');
await page.waitForFunction(() => __lasersmith.mine[0].versions.length === 1 && __lasersmith.mine[0].params.find(p => p.key === 'h').default === 160, null, { timeout: 30000 });
st = await page.evaluate(() => ({ last: __calls[__calls.length - 1].slice(-1)[0] }));
check(/return \{/.test(st.last) && /taller/.test(st.last), 'change request sends the current generator');
check(await page.isVisible('[data-mt=undo]'), 'undo offered after a change');

// sandbox locks
const sb = await page.evaluate(async () => {
  const m = { name: 'x', thickness: 3, kerf: 0.1 };
  const tryRun = async (src, o) => { try { await __lasersmith.sandbox.run(src, {}, m, o); return 'ran'; } catch (e) { return e.message; } };
  return {
    fetch: await tryRun("return { title: 'x', params: [], generate() { fetch('https://example.com'); } };"),
    dom: await tryRun("return { title: 'x', params: [], generate() { document.title = 'x'; } };"),
    syntax: await tryRun("const a = ;\nreturn {};"),
    loop: await tryRun("return { title: 'x', params: [], generate() { for (;;) {} } };", { timeLimit: 800 }),
    after: await tryRun("return { title: 'x', params: [], generate(p, m, api) { return { parts: [{ name: 'A', outline: api.rect(0,0,5,5) }] }; } };"),
  };
});
check(/fetch is not a function/.test(sb.fetch), 'sandbox: no network ' + sb.fetch);
check(/document is not defined/.test(sb.dom), 'sandbox: no DOM ' + sb.dom);
check(/generator line 1/.test(sb.syntax), 'sandbox: syntax error names the line ' + sb.syntax);
check(/took longer/.test(sb.loop), 'sandbox: time limit stops an endless loop ' + sb.loop);
check(sb.after === 'ran', 'sandbox: works again after a stopped run');
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close();
server.close();
console.log(fail ? `claude e2e: ${fail} failed` : 'claude e2e passed');
process.exit(fail ? 1 : 0);
