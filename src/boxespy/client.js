// Main-thread client for the boxes.py worker. Lazily starts Pyodide the first time a boxes.py design
// is opened (about 10 MB, cached by the browser after that).

export const PYODIDE_VERSION = '0.29.5';
export const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

function b64ToBytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param cfg {workerSource: string, zipURL?: string, zipBase64?: string, indexURL?: string, onProgress?: fn}
 */
export function createBoxesClient(cfg) {
  let worker = null, seq = 0, ready = null;
  const pending = new Map();
  const schemaCache = new Map();
  const start = () => {
    if (worker) return;
    const blob = new Blob([cfg.workerSource], { type: 'text/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = e => {
      const m = e.data;
      if (m.op === 'progress') { cfg.onProgress && cfg.onProgress(m.msg); return; }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    };
    worker.onerror = e => {
      const err = new Error(e.message || 'boxes.py worker failed');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
  };
  const call = (msg, transfer = []) => new Promise((resolve, reject) => {
    start();
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
  const ensure = () => {
    if (!ready) {
      ready = (async () => {
        let zip;
        if (cfg.zipBase64) zip = b64ToBytes(cfg.zipBase64).buffer;
        else {
          cfg.onProgress && cfg.onProgress('Downloading boxes.py');
          const r = await fetch(cfg.zipURL);
          if (!r.ok) throw new Error('Could not load boxes.py bundle (' + r.status + ')');
          zip = await r.arrayBuffer();
        }
        await call({ op: 'init', indexURL: cfg.indexURL || PYODIDE_INDEX, zip }, [zip]);
      })().catch(e => { ready = null; throw e; });
    }
    return ready;
  };
  return {
    get started() { return !!ready; },
    async schema(entry) {
      if (schemaCache.has(entry.id)) return schemaCache.get(entry.id);
      await ensure();
      const s = await call({ op: 'schema', module: entry.module, cls: entry.cls });
      schemaCache.set(entry.id, s);
      return s;
    },
    async run(entry, args, material) {
      await ensure();
      return call({ op: 'run', module: entry.module, cls: entry.cls, args, thickness: material.thickness, kerf: material.kerf });
    },
  };
}
