// The user's own designs (made with Claude or opened from a generator file), kept in this browser
// until accounts arrive in M4. Each is a library entry whose generator source runs in the sandbox.

const KEY = 'lasersmith-mine-v1';

export function loadMine() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(e => e && e.id && typeof e.code === 'string') : [];
  } catch (e) { return []; }
}

export function saveMine(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}

export function newEntry({ code, meta, chat = [], origin = 'claude' }) {
  return {
    id: 'mine-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: meta.title || 'Untitled design',
    description: meta.description || '',
    category: 'Your designs',
    source: 'claude',
    origin,
    tags: ['yours', origin],
    code,
    params: meta.params,
    chat,
    versions: [],
    created: new Date().toISOString(),
  };
}

/** Header comment for a downloaded generator file, so it can be opened again later. */
export function generatorFile(entry) {
  const head = `// Lasersmith generator: ${entry.title}\n// ${entry.description.replace(/\n/g, ' ')}\n// Open it in Lasersmith (Library > Open generator) to edit its parameters and cut it.\n// Runs as the body of function (api) { ... } and returns { title, description, params, generate }.\n\n`;
  return head + entry.code + '\n';
}

/** Strip the header we add on download. */
export function codeFromFile(text) {
  return String(text).replace(/^(\/\/[^\n]*\n)+\n?/, '').trim();
}
