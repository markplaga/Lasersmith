// Sandboxed worker for user/Claude generators. The page builds the worker script as:
//   <this bundle> + "self.__gen = (function (api) { 'use strict'; <generator source> })(self.LS_API);"
// so the generator source never goes through eval. Before the generator's code runs, this bundle
// removes network, storage and nested-worker APIs from the worker scope.
import { API, runCompiled } from './api.js';

const post = self.postMessage.bind(self);
self.LS_API = API;

self.onmessage = e => {
  const { id, params, material } = e.data || {};
  try {
    if (self.__genError) throw self.__genError;
    if (!self.__gen) throw new Error('The generator did not return anything: end it with `return { title, params, generate }`');
    const r = runCompiled(self.__gen, params, material);
    post({ id, ok: true, ...r });
  } catch (err) {
    post({ id, ok: false, error: (err && err.message) || String(err), stack: (err && err.stack) || '' });
  }
};

// Lock the scope down: no network, storage, nested workers or script loading for generator code.
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'RTCPeerConnection', 'postMessage']) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) { /* not present */ }
}
