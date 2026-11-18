// boxes.py bridge + adapter. Runs the real generators through bridge.py with CPython when available
// (pip install shapely), so the same Python that ships to Pyodide is exercised in CI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOXES_CATALOG } from '../src/boxespy/catalog.js';
import { boxesToDesign, joinPaths } from '../src/boxespy/adapter.js';
import { validate } from '../src/geom/validate.js';
import { nest } from '../src/geom/nest.js';
import { sheetLBRN2 } from '../src/export/formats.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const material = { name: '3 mm birch ply', thickness: 3, kerf: 0.15 };

await test('joinPaths chains touching open polylines and closes loops', () => {
  const j = joinPaths([[[0, 0], [1, 0]], [[1, 1], [0, 1], [0, 0]], [[1, 0], [1, 1]]]);
  assert.equal(j.length, 1);
  assert.deepEqual(j[0][0], j[0][j[0].length - 1]);
});

let py = null;
try {
  execFileSync('python3', ['-c', 'import shapely'], { stdio: 'ignore' });
  py = 'python3';
} catch (e) {
  console.log('  skip boxes.py generators (python3 with shapely not found)');
}

if (py) {
  const script = `
import json, sys
sys.path[:0] = [${JSON.stringify(path.join(root, 'vendor', 'boxespy'))}, ${JSON.stringify(path.join(root, 'src', 'boxespy'))}]
import bridge
out = {}
for m, c in json.loads(sys.argv[1]):
    try:
        out[c] = {"schema": json.loads(bridge.schema(m, c)), "run": json.loads(bridge.run(m, c, "{}", 3, 0.15))}
    except Exception as e:
        out[c] = {"error": repr(e)}
print(json.dumps(out))
`;
  const res = JSON.parse(execFileSync(py, ['-c', script, JSON.stringify(BOXES_CATALOG.map(e => [e.module, e.cls]))], { maxBuffer: 1 << 28 }).toString());
  for (const entry of BOXES_CATALOG) {
    await test(`boxes.py ${entry.cls}: schema, render, adapt, validate, nest, export`, () => {
      const r = res[entry.cls];
      assert.ok(!r.error, r.error);
      assert.ok(r.schema.params.length > 0);
      for (const p of r.schema.params) assert.ok(['number', 'int', 'bool', 'select', 'text'].includes(p.type), p.key + ' ' + p.type);
      const d = boxesToDesign(r.run, { entry, params: {}, material });
      assert.ok(d.parts.length > 0);
      const errs = validate(d).filter(i => i.level === 'error');
      assert.deepEqual(errs.map(e => e.part + ": " + e.msg).slice(0, 4), []);
      const n = nest(d);
      assert.equal(n.oversize.length, 0);
      assert.match(sheetLBRN2(n.sheets[0], d), /<Shape /);
    });
  }
  await test('boxes.py: parameters reach the generator (ClosedBox x=200)', () => {
    const out = execFileSync(py, ['-c', `
import sys, json
sys.path[:0] = [${JSON.stringify(path.join(root, 'vendor', 'boxespy'))}, ${JSON.stringify(path.join(root, 'src', 'boxespy'))}]
import bridge
print(bridge.run('closedbox', 'ClosedBox', json.dumps({"x": 200, "y": 50, "h": 30, "outside": False}), 3, 0.15))
`]).toString();
    const d = boxesToDesign(JSON.parse(out), { entry: BOXES_CATALOG[0], params: {}, material });
    const widest = Math.max(...d.parts.map(p => Math.max(...p.outline.map(q => q[0])) - Math.min(...p.outline.map(q => q[0]))));
    assert.ok(widest > 200 && widest < 215, 'widest ' + widest);
  });
}
