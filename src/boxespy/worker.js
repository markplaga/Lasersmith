/* Lasersmith boxes.py worker: runs Pyodide off the main thread.
 * Messages in:  {id, op: 'init', indexURL, zip: ArrayBuffer} | {id, op: 'schema', module, cls}
 *               | {id, op: 'run', module, cls, args, thickness, kerf}
 * Messages out: {id, ok: true, result} | {id, ok: false, error} | {op: 'progress', msg}
 * The zip holds bridge.py, the boxes package and its pure-Python deps (see build.js). Only shapely
 * (with numpy) is fetched from the Pyodide package index.
 */
/* global loadPyodide, importScripts */
let py = null;
let bridge = null;

const progress = msg => self.postMessage({ op: 'progress', msg });

async function init({ indexURL, zip }) {
  if (bridge) return true;
  progress('Loading Python runtime');
  if (typeof loadPyodide === 'undefined') importScripts(indexURL + 'pyodide.js');
  py = await loadPyodide({ indexURL });
  progress('Loading shapely');
  await py.loadPackage(['shapely'], { messageCallback: () => {}, errorCallback: () => {} });
  progress('Unpacking boxes.py');
  py.unpackArchive(zip, 'zip', { extractDir: '/lib/lasersmith' });
  py.runPython("import sys\nif '/lib/lasersmith' not in sys.path: sys.path.insert(0, '/lib/lasersmith')");
  bridge = py.pyimport('bridge');
  progress('boxes.py ready');
  return true;
}

self.onmessage = async e => {
  const m = e.data;
  try {
    let result;
    if (m.op === 'init') result = await init(m);
    else if (m.op === 'schema') result = JSON.parse(bridge.schema(m.module, m.cls));
    else if (m.op === 'run') result = JSON.parse(bridge.run(m.module, m.cls, JSON.stringify(m.args || {}), m.thickness, m.kerf));
    else throw new Error('unknown op ' + m.op);
    self.postMessage({ id: m.id, ok: true, result });
  } catch (err) {
    let msg = String((err && err.message) || err);
    // Python tracebacks: keep the last line, which carries the actual error
    const lines = msg.trim().split('\n');
    if (lines.length > 3) msg = lines.slice(-1)[0];
    self.postMessage({ id: m.id, ok: false, error: msg });
  }
};
