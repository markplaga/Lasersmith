// Minimal test runner (Polysmith style: plain Node, no framework). Runs every tests/*.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
let pass = 0, fail = 0;
globalThis.test = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n').slice(0, 12).join('\n       ') : e)); }
};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.test.js') && (!only || f.includes(only))).sort()) {
  console.log(f);
  await import(pathToFileURL(path.join(dir, f)).href);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
