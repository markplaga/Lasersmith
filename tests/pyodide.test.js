// Runs bridge.py inside real Pyodide with the built bundle. Opt-in, since it needs a local Pyodide
// distribution: LASERSMITH_PYODIDE=/path/to/pyodide/ npm test  (after npm run build)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const dir = process.env.LASERSMITH_PYODIDE;
const zipPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'boxespy.zip');
if (!dir || !fs.existsSync(zipPath)) {
  console.log('  skip (set LASERSMITH_PYODIDE to a Pyodide dist folder and run npm run build first)');
} else {
  await test('Pyodide: bundle unpacks and ClosedBox renders', async () => {
    const { loadPyodide } = await import(pathToFileURL(path.join(dir, 'pyodide.mjs')).href);
    const py = await loadPyodide({ indexURL: dir.endsWith('/') ? dir : dir + '/' });
    await py.loadPackage(['shapely'], { messageCallback: () => {} });
    const zip = fs.readFileSync(zipPath);
    py.unpackArchive(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length), 'zip', { extractDir: '/lib/lasersmith' });
    py.runPython("import sys\nsys.path.insert(0, '/lib/lasersmith')");
    const bridge = py.pyimport('bridge');
    const r = JSON.parse(bridge.run('closedbox', 'ClosedBox', '{"x": 80}', 3, 0.15));
    assert.equal(r.parts.length, 6);
  });
}
