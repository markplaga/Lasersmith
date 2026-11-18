// "Create with Claude" panel (PRD 4.2): a short chat that writes or changes a generator. Shown in
// Claude mode only; on the standalone site it explains that this part needs Claude.

import { askClaude } from '../claude/session.js';
import { proseOf } from '../claude/prompt.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ERRORS = {
  not_granted: 'Claude was not allowed for this page. You can still edit and cut every design.',
  sampling_disabled: 'Claude is not available on this account.',
  rate_limited: 'Claude is busy or you have hit a usage limit. Try again in a little while.',
  refused: 'Claude declined that request. Try describing it differently.',
  session_expired: 'Your Claude session expired. Sign in again, then retry.',
  prompt_too_large: 'That request was too long. Try a shorter description.',
  image_rejected: 'That image could not be used. Try a JPEG or PNG under 20 MB.',
};
const PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);

/**
 * @param el root element
 * @param host {currentEntry(), currentParams(), material(), machine(), run(src, params), check(design),
 *              onResult({ok, source, meta, prose, problems, changing, chat}), toast(msg)}
 */
export function mountClaudePanel(el, host) {
  el.innerHTML = `
    <h2>Create with Claude</h2>
    <p class="muted" id="cpOff">Describe something new, like "a posable dog with a swivel head", or ask for a change to a design Claude made. This needs Claude: open Lasersmith inside Claude to use it. Everything else here works without it.</p>
    <div id="cpOn" hidden>
      <div class="seg cp-mode" role="group" aria-label="What to ask for"><button data-m="new" class="on">New design</button><button data-m="change">Change this one</button></div>
      <ol id="cpLog" aria-live="polite"></ol>
      <textarea id="cpAsk" rows="3" placeholder="Describe a design for Claude to make"></textarea>
      <div class="cp-row">
        <label class="btn ghost cp-img" id="cpImgLbl" hidden>Add sketch<input type="file" id="cpImg" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
        <span id="cpImgName" class="muted"></span>
        <span class="grow"></span>
        <button class="btn ghost" id="cpStop" hidden>Stop</button>
        <button class="btn" id="cpGo">Create</button>
      </div>
      <p id="cpStatus" class="muted" hidden></p>
    </div>`;
  const $ = s => el.querySelector(s);
  let sample = null, mode = 'new', ctl = null, image = null, draft = [], disabled = false;

  function changeable() { const e = host.currentEntry(); return e && e.source === 'claude'; }
  function sync() {
    const can = changeable();
    if (!can && mode === 'change') mode = 'new';
    el.querySelectorAll('.cp-mode button').forEach(b => {
      b.classList.toggle('on', b.dataset.m === mode);
      if (b.dataset.m === 'change') { b.disabled = !can; b.title = can ? '' : 'Only designs made with Claude can be changed by Claude'; }
    });
    $('#cpAsk').placeholder = mode === 'change' ? `What should change in "${host.currentEntry().title}"?` : 'Describe a design for Claude to make';
    $('#cpGo').textContent = mode === 'change' ? 'Change' : 'Create';
    renderLog();
  }
  function renderLog() {
    const chat = mode === 'change' && changeable() ? host.currentEntry().chat || [] : draft;
    $('#cpLog').innerHTML = chat.slice(-8).map(t => `<li class="${t.role}">${esc(t.content)}</li>`).join('');
    $('#cpLog').hidden = !chat.length;
  }
  function status(msg) { $('#cpStatus').textContent = msg || ''; $('#cpStatus').hidden = !msg; }
  function busy(on) {
    $('#cpGo').disabled = on || disabled; $('#cpStop').hidden = !on; $('#cpAsk').disabled = on;
    el.querySelectorAll('.cp-mode button').forEach(b => { b.disabled = on || (b.dataset.m === 'change' && !changeable()); });
  }

  el.querySelectorAll('.cp-mode button').forEach(b => b.addEventListener('click', () => { mode = b.dataset.m; sync(); }));
  $('#cpImg').addEventListener('change', e => { image = e.target.files[0] || null; $('#cpImgName').textContent = image ? image.name : ''; });
  $('#cpStop').addEventListener('click', () => ctl && ctl.abort());
  $('#cpAsk').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(); });
  $('#cpGo').addEventListener('click', go);

  async function go() {
    const request = $('#cpAsk').value.trim();
    if (!request || !sample || disabled) return;
    const changing = mode === 'change' && changeable();
    const entry = changing ? host.currentEntry() : null;
    const chat = changing ? (entry.chat || []) : draft;
    const history = chat.slice();
    chat.push({ role: 'user', content: request });
    renderLog();
    const live = document.createElement('li');
    live.className = 'assistant pending';
    live.textContent = 'Thinking…';
    $('#cpLog').appendChild(live);
    $('#cpLog').hidden = false;
    $('#cpAsk').value = '';
    ctl = new AbortController();
    busy(true);
    const params = changing ? host.currentParams() : {};
    try {
      const r = await askClaude({
        sample, request, history,
        current: changing ? { source: entry.code, params } : null,
        material: host.material(), machine: host.machine(),
        run: src => host.run(src, params),
        check: host.check,
        images: image ? [image] : undefined,
        signal: ctl.signal,
        onText: ({ text }) => { const p = proseOf(text); live.textContent = p || 'Writing the generator…'; },
        onStatus: status,
      });
      chat.push({ role: 'assistant', content: r.prose || (r.ok ? 'Done.' : '') });
      if (r.question) { status(''); renderLog(); return; }
      if (r.source) host.onResult({ ...r, changing, chat: chat.slice() });
      if (!changing) draft = [];
      image = null; $('#cpImg').value = ''; $('#cpImgName').textContent = '';
      status(r.ok ? '' : `Claude could not fix every problem after ${r.rounds} tries. The design is open with its problems listed under Checks; ask for a fix in your own words, or change a parameter.`);
    } catch (err) {
      chat.pop();
      $('#cpAsk').value = request;
      const code = err && err.code;
      if (code === 'cancelled') status('Stopped.');
      else status(ERRORS[code] || 'Something went wrong talking to Claude. Try again.');
      if (PERMANENT.has(code)) { disabled = true; $('#cpGo').disabled = true; }
    } finally {
      ctl = null;
      busy(false);
      sync();
    }
  }

  return {
    /** Called once Claude is detected. */
    async enable(s) {
      sample = s;
      $('#cpOff').hidden = true;
      $('#cpOn').hidden = false;
      try { const lim = await s.limits(); $('#cpImgLbl').hidden = !(lim && lim.images); } catch (e) { /* no images */ }
      sync();
    },
    /** The selected design changed. */
    refresh() { if (sample) { mode = changeable() ? 'change' : 'new'; sync(); } },
  };
}
