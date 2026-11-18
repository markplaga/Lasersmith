import assert from 'node:assert/strict';
import { compileHere, runCompiled } from '../src/claude/api.js';
import { EXAMPLE_SIMPLE, EXAMPLE_HINGED, extractCode, proseOf, systemTurn } from '../src/claude/prompt.js';
import { askClaude } from '../src/claude/session.js';
import { sourceLine, wrapSource } from '../src/claude/sandbox.js';
import { validate } from '../src/geom/validate.js';

const mat = { name: 'ply', thickness: 3, kerf: 0.15 };
const machine = { bedW: 914.4, bedH: 609.6, margin: 5 };
const run = async src => runCompiled(compileHere(src), {}, mat);
const check = d => validate(d, machine).filter(i => i.level === 'error').map(i => (i.part ? i.part + ': ' : '') + i.msg);

await test('claude: the prompt examples are valid generators that pass validation', async () => {
  for (const src of [EXAMPLE_SIMPLE, EXAMPLE_HINGED]) {
    const { design, meta } = await run(src);
    assert.ok(meta.params.length > 0 && design.parts.length > 0);
    assert.deepEqual(check(design), []);
  }
  const { design } = await run(EXAMPLE_HINGED);
  assert.equal(design.joints.length, 1);
  assert.ok(systemTurn(mat, machine).includes('914.4'));
});

await test('claude: code and prose are pulled out of a reply', () => {
  const reply = 'I made a cup.\n\n```js\nreturn 1;\n```\n';
  assert.equal(extractCode(reply), 'return 1;');
  assert.equal(proseOf(reply), 'I made a cup.');
  assert.equal(extractCode('no code here'), null);
  assert.equal(extractCode('```python\nx\n```\n```javascript\ny\n```'), 'y');
});

await test('claude: params are filled from defaults and a bare {parts} result is wrapped', async () => {
  const src = `return { title: 'Plate', params: [{key: 'w', label: 'W', type: 'length', default: 50}],
    generate(p, m, api) { return { parts: [{ id: 'a', name: 'A', outline: api.rect(0, 0, p.w, 20) }] }; } };`;
  const r = runCompiled(compileHere(src), { w: 70 }, mat);
  assert.equal(r.design.format, 'lasersmith/design');
  assert.equal(r.design.parts[0].outline[2][0], 70);
  assert.equal(r.design.generator.source, 'claude');
  assert.throws(() => runCompiled(compileHere('return { title: "x", params: [{key: "a", type: "colour"}], generate() {} };'), {}, mat), /unknown type/);
  assert.throws(() => runCompiled(compileHere('return { title: "x", params: [], generate() { return { parts: [{ name: "P", outline: [[0, 0], [1, NaN], [1, 1]] }] }; } };'), {}, mat), /bad outline point/);
});

await test('claude: repair loop sends errors back and stops when the design is clean', async () => {
  const bad = "Here you go.\n```js\nreturn { title: 'T', params: [], generate(p, m, api) { throw new Error('boom'); } };\n```";
  const overlap = "Fixed.\n```js\nreturn { title: 'T', params: [], generate(p, m, api) { const r = api.rect(0,0,40,40); const pl = { o: [0,0,0], u: [1,0,0], v: [0,1,0], n: [0,0,1] }; return api.makeDesign({ title: 'T', material: m, parts: [{ id: 'a', name: 'A', outline: r, place: pl }, { id: 'b', name: 'B', outline: r, place: pl }] }); } };\n```";
  const good = "Fixed again.\n```js\n" + EXAMPLE_SIMPLE + "\n```";
  const replies = [bad, overlap, good], seen = [];
  const sample = async (turns, opts) => { seen.push(turns.slice()); assert.equal(opts.cache, false); return { text: replies.shift() }; };
  const statuses = [];
  const r = await askClaude({ sample, request: 'a cup', material: mat, machine, run, check, onStatus: s => statuses.push(s) });
  assert.equal(r.ok, true);
  assert.equal(r.rounds, 3);
  assert.equal(r.prose, 'Here you go.');
  assert.match(seen[1].at(-1).content, /boom/);
  assert.match(seen[2].at(-1).content, /overlap in 3D/);
  assert.equal(seen[0][0].role, 'user');
  assert.ok(statuses.some(s => /round 2 of 3/.test(s)));
});

await test('claude: gives up after 3 repairs, and a reply with no code is a question', async () => {
  const bad = "```js\nreturn { title: 'T', params: [], generate() { throw new Error('still broken'); } };\n```";
  let n = 0;
  const r = await askClaude({ sample: async () => { n++; return { text: bad }; }, request: 'x', material: mat, machine, run, check });
  assert.equal(r.ok, false);
  assert.equal(n, 4);
  assert.match(r.problems[0], /still broken/);
  const q = await askClaude({ sample: async () => ({ text: 'How tall should it be?' }), request: 'x', material: mat, machine, run, check });
  assert.equal(q.question, true);
  assert.equal(q.prose, 'How tall should it be?');
});

await test('claude: a change request carries the current source', async () => {
  let turns;
  await askClaude({ sample: async t => { turns = t; return { text: 'ok' }; }, request: 'taller', current: { source: 'return 42;', params: { h: 1 } }, material: mat, machine, run, check });
  assert.match(turns.at(-1).content, /return 42;/);
  assert.match(turns.at(-1).content, /taller/);
});

await test('sandbox: worker script wraps the source and maps line numbers back', () => {
  const { text, offset } = wrapSource('BUNDLE();\nmore();', 'line1\nline2');
  assert.equal(text.split('\n')[offset], 'line1');
  assert.equal(sourceLine(`Error: x\n    at generate (blob:http://localhost:1234/abc-def:${offset + 2}:7)`, offset), 2);
  assert.equal(sourceLine('nothing', offset), null);
});
