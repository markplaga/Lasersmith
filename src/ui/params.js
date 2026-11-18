// Parameter panel built from a schema: [{key, label, type, default, min, max, step, choices, group, help, unit}]
// type 'angle' is a slider plus a number box in degrees.
// type 'length' shows in the chosen display unit (mm or inch) and is stored in mm.

const IN = 25.4;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function defaults(schema) {
  const o = {};
  for (const p of schema) o[p.key] = p.default;
  return o;
}

export function fmtLen(mm, units) {
  if (units === 'in') return +(mm / IN).toFixed(3) + '';
  return +(+mm).toFixed(2) + '';
}

/**
 * Render the panel. onChange(key, value) fires on every edit.
 * opts: {units, openGroups: Set, primaryGroup}
 */
export function renderParams(el, schema, values, onChange, opts = {}) {
  const units = opts.units || 'mm';
  const groups = new Map();
  for (const p of schema) {
    if (p.hidden) continue;
    const g = p.group || 'Settings';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  const first = opts.primaryGroup || [...groups.keys()][0];
  let html = '';
  let gi = 0;
  for (const [g, ps] of groups) {
    const open = g === first || (opts.openGroups && opts.openGroups.has(g)) || groups.size <= 3;
    html += `<details class="pgroup" data-group="${esc(g)}" ${open ? 'open' : ''}><summary>${esc(g)} <small>${ps.length}</small></summary>`;
    for (const p of ps) html += row(p, values[p.key], units, gi++);
    html += '</details>';
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-key]').forEach(inp => {
    const p = schema.find(s => s.key === inp.dataset.key);
    const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      let v;
      if (p.type === 'bool') v = inp.checked;
      else if (p.type === 'select' || p.type === 'text') v = inp.value;
      else {
        v = parseFloat(inp.value);
        if (!isFinite(v)) { inp.setAttribute('aria-invalid', 'true'); return; }
        if (p.type === 'length' && units === 'in') v *= IN;
        if (p.type === 'int') v = Math.round(v);
        const bad = (p.min != null && v < p.min) || (p.max != null && v > p.max);
        inp.toggleAttribute('aria-invalid', bad);
        if (bad) return;
      }
      if (p.type === 'angle') el.querySelectorAll(`[data-key="${p.key}"]`).forEach(o => { if (o !== inp) o.value = v; });
      onChange(p.key, v);
    });
  });
  el.querySelectorAll('details.pgroup').forEach(d => d.addEventListener('toggle', () => {
    if (!opts.openGroups) return;
    d.open ? opts.openGroups.add(d.dataset.group) : opts.openGroups.delete(d.dataset.group);
  }));
}

function row(p, v, units, i) {
  const id = 'p_' + i;
  const help = p.help ? `<small>${esc(p.help.length > 160 ? p.help.slice(0, 157) + '…' : p.help)}</small>` : '';
  const label = `<label for="${id}">${esc(p.label)}${help}</label>`;
  if (p.type === 'bool') return `<div class="row">${label}<input id="${id}" type="checkbox" data-key="${esc(p.key)}" ${v ? 'checked' : ''}></div>`;
  if (p.type === 'select') {
    const opts = p.choices.map(c => `<option value="${esc(c.value)}" ${String(c.value) === String(v) ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
    return `<div class="row">${label}<select id="${id}" data-key="${esc(p.key)}">${opts}</select></div>`;
  }
  if (p.type === 'text') {
    if (p.multiline) return `<div class="row col">${label}<textarea id="${id}" rows="3" data-key="${esc(p.key)}">${esc(v)}</textarea></div>`;
    return `<div class="row">${label}<span class="num"><input id="${id}" type="text" data-key="${esc(p.key)}" value="${esc(v)}"></span></div>`;
  }
  if (p.type === 'angle') {
    const a = `min="${p.min ?? -180}" max="${p.max ?? 180}" step="${p.step ?? 1}" data-key="${esc(p.key)}" value="${esc(v)}"`;
    return `<div class="row col">${label}<span class="angle"><input type="range" ${a} aria-label="${esc(p.label)}"><span class="num"><input id="${id}" type="number" inputmode="decimal" ${a}><i>°</i></span></span></div>`;
  }
  const isLen = p.type === 'length';
  const shown = isLen ? fmtLen(v, units) : v;
  const u = isLen ? units : p.unit || '';
  const step = p.step ?? (p.type === 'int' ? 1 : isLen ? (units === 'in' ? 0.0625 : 0.5) : 'any');
  const min = p.min != null ? `min="${isLen ? fmtLen(p.min, units) : p.min}"` : '';
  const max = p.max != null ? `max="${isLen ? fmtLen(p.max, units) : p.max}"` : '';
  return `<div class="row">${label}<span class="num"><input id="${id}" type="number" inputmode="decimal" step="${step}" ${min} ${max} data-key="${esc(p.key)}" value="${esc(shown)}"><i>${esc(u)}</i></span></div>`;
}
