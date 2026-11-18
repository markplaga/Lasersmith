// Runs a generator's source in a sandboxed Web Worker (no DOM, network or storage; time limit).
// One worker per source; parameter changes reuse it. A syntax error, a throw, or a run over the time
// limit comes back as an Error whose message names the generator line where possible.

export const TIME_LIMIT_MS = 10000;

/** Generator line from a worker error/stack, given how many lines precede the source. */
export function sourceLine(stack, offset) {
  const m = /blob:\S*?:(\d+):\d+/.exec(stack || '');
  if (!m) return null;
  const n = +m[1] - offset;
  return n > 0 ? n : null;
}

export function wrapSource(bundle, src) {
  const head = bundle + '\n;try { self.__gen = (function (api) { "use strict";\n';
  const text = head + src + '\n})(self.LS_API); } catch (e) { self.__genError = e; }\n';
  return { text, offset: head.split('\n').length - 1 };
}

export function createSandbox(bundle) {
  let cur = null; // {src, worker, offset, pending: Map, seq}
  const kill = () => {
    if (!cur) return;
    cur.worker.terminate();
    for (const p of cur.pending.values()) p.reject(new Error('The generator was stopped.'));
    cur = null;
  };
  const start = src => {
    kill();
    const { text, offset } = wrapSource(bundle, src);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    const w = new Worker(url);
    const me = { src, worker: w, offset, pending: new Map(), seq: 0, url };
    w.onmessage = e => {
      const m = e.data || {};
      const p = me.pending.get(m.id);
      if (!p) return;
      me.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve({ design: m.design, meta: m.meta });
      else {
        const line = sourceLine(m.stack, offset);
        p.reject(new Error(m.error + (line ? ` (generator line ${line})` : '')));
      }
    };
    w.onerror = e => {
      e.preventDefault && e.preventDefault();
      const line = e.lineno ? e.lineno - offset : null;
      const err = new Error((e.message || 'The generator failed to load').replace(/^Uncaught /, '') + (line > 0 ? ` (generator line ${line})` : ''));
      for (const p of me.pending.values()) { clearTimeout(p.timer); p.reject(err); }
      me.pending.clear();
      me.broken = err;
    };
    cur = me;
    return me;
  };
  return {
    /** Run src with params on material. Resolves {design, meta}. */
    run(src, params, material, { timeLimit = TIME_LIMIT_MS } = {}) {
      const me = cur && cur.src === src && !cur.broken ? cur : start(src);
      return new Promise((resolve, reject) => {
        const id = ++me.seq;
        const timer = setTimeout(() => {
          me.pending.delete(id);
          reject(new Error(`The generator took longer than ${timeLimit / 1000} s and was stopped.`));
          if (cur === me) kill();
        }, timeLimit);
        me.pending.set(id, { resolve, reject, timer });
        me.worker.postMessage({ id, params, material });
      });
    },
    dispose: kill,
  };
}
