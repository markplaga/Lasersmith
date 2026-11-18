// Voxel editor (PRD section 9): paint cubes one layer at a time, seen from above (x right, front at
// the bottom), with mirror symmetry, fill, copy-from-below and undo. Edits go to the sculpture's
// hidden `grid` parameter.

import { makeGrid, get, set, encode, decode, clone, count } from '../voxel/grid.js';

const MAX = 64;

export function mountVoxelEditor(el, { getGrid, onChange }) {
  el.innerHTML = `
    <h2>Voxel editor</h2>
    <p class="muted">Paint cubes one layer at a time, seen from above (front at the bottom). The sculpture updates as you draw.</p>
    <div class="vx-bar">
      <div class="seg" id="vxTool" role="group" aria-label="Tool"><button data-t="draw" class="on">Draw</button><button data-t="erase">Erase</button></div>
      <label class="vx-chk"><input type="checkbox" id="vxMirror" checked> Mirror left/right</label>
    </div>
    <div class="vx-layer"><button class="btn ghost" id="vxDown" aria-label="Layer down">−</button><input type="range" id="vxZ" min="0" value="0" aria-label="Layer"><button class="btn ghost" id="vxUp" aria-label="Layer up">+</button><span id="vxZl"></span></div>
    <canvas id="vxCanvas" aria-label="Voxel layer"></canvas>
    <div class="vx-bar">
      <button class="btn ghost" id="vxCopy">Copy layer below</button>
      <button class="btn ghost" id="vxFill">Fill layer</button>
      <button class="btn ghost" id="vxClear">Clear layer</button>
      <button class="btn ghost" id="vxUndo" disabled>Undo</button>
    </div>
    <div class="vx-bar vx-size">
      <span>Grid</span><input type="number" id="vxNX" min="2" max="${MAX}" aria-label="Grid width"><span>×</span><input type="number" id="vxNY" min="2" max="${MAX}" aria-label="Grid depth"><span>×</span><input type="number" id="vxNZ" min="2" max="${MAX}" aria-label="Grid height">
      <button class="btn ghost" id="vxResize">Resize</button>
    </div>
    <p class="muted" id="vxCount"></p>`;
  const $ = s => el.querySelector(s);
  const cv = $('#vxCanvas'), ctx = cv.getContext('2d');
  let g = null, z = 0, tool = 'draw', undo = [], painting = false, paintVal = 1, strokeStarted = false;

  function load() {
    g = clone(getGrid());
    z = Math.min(z, g.nz - 1);
    $('#vxZ').max = g.nz - 1; $('#vxZ').value = z;
    $('#vxNX').value = g.nx; $('#vxNY').value = g.ny; $('#vxNZ').value = g.nz;
    draw();
  }
  function cell() { return Math.max(8, Math.min(26, Math.floor((el.clientWidth - 8) / g.nx))); }
  function draw() {
    const c = cell(), W = g.nx * c, H = g.ny * c, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(el);
    const ink = css.getPropertyValue('--ink').trim() || '#222', wood = css.getPropertyValue('--wood').trim() || '#b57a3c', line = css.getPropertyValue('--line').trim() || '#ccc';
    ctx.clearRect(0, 0, W, H);
    for (let y = 0; y < g.ny; y++) for (let x = 0; x < g.nx; x++) {
      const px = x * c, py = (g.ny - 1 - y) * c;
      if (get(g, x, y, z)) { ctx.fillStyle = wood; ctx.fillRect(px + 1, py + 1, c - 2, c - 2); }
      else if (z > 0 && get(g, x, y, z - 1)) { ctx.globalAlpha = 0.22; ctx.fillStyle = ink; ctx.fillRect(px + 1, py + 1, c - 2, c - 2); ctx.globalAlpha = 1; }
    }
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let x = 0; x <= g.nx; x++) { ctx.beginPath(); ctx.moveTo(x * c + 0.5, 0); ctx.lineTo(x * c + 0.5, H); ctx.stroke(); }
    for (let y = 0; y <= g.ny; y++) { ctx.beginPath(); ctx.moveTo(0, y * c + 0.5); ctx.lineTo(W, y * c + 0.5); ctx.stroke(); }
    if ($('#vxMirror').checked) { ctx.strokeStyle = wood; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.setLineDash([]); }
    $('#vxZl').textContent = `Layer ${z + 1} of ${g.nz}`;
    $('#vxCount').textContent = `${count(g)} cubes in a ${g.nx} × ${g.ny} × ${g.nz} grid.`;
    $('#vxUndo').disabled = !undo.length;
  }
  function push() { undo.push(encode(g)); if (undo.length > 50) undo.shift(); }
  function commit() { onChange(encode(g)); draw(); }
  function paint(ev) {
    const r = cv.getBoundingClientRect(), c = cell();
    const x = Math.floor((ev.clientX - r.left) / c), y = g.ny - 1 - Math.floor((ev.clientY - r.top) / c);
    if (x < 0 || y < 0 || x >= g.nx || y >= g.ny) return;
    if (!strokeStarted) { push(); strokeStarted = true; paintVal = tool === 'draw' ? 1 : 0; }
    set(g, x, y, z, paintVal);
    if ($('#vxMirror').checked) set(g, g.nx - 1 - x, y, z, paintVal);
    draw();
  }
  cv.addEventListener('pointerdown', ev => { painting = true; strokeStarted = false; cv.setPointerCapture(ev.pointerId); paint(ev); });
  cv.addEventListener('pointermove', ev => { if (painting) paint(ev); });
  const end = () => { if (painting && strokeStarted) commit(); painting = false; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  el.querySelectorAll('#vxTool button').forEach(b => b.addEventListener('click', () => { tool = b.dataset.t; el.querySelectorAll('#vxTool button').forEach(x => x.classList.toggle('on', x === b)); }));
  $('#vxMirror').addEventListener('change', draw);
  const setZ = v => { z = Math.max(0, Math.min(g.nz - 1, v)); $('#vxZ').value = z; draw(); };
  $('#vxZ').addEventListener('input', e => setZ(+e.target.value));
  $('#vxUp').addEventListener('click', () => setZ(z + 1));
  $('#vxDown').addEventListener('click', () => setZ(z - 1));
  const layerOp = f => { push(); for (let y = 0; y < g.ny; y++) for (let x = 0; x < g.nx; x++) set(g, x, y, z, f(x, y)); commit(); };
  $('#vxCopy').addEventListener('click', () => { if (z > 0) layerOp((x, y) => get(g, x, y, z - 1)); });
  $('#vxFill').addEventListener('click', () => layerOp(() => 1));
  $('#vxClear').addEventListener('click', () => layerOp(() => 0));
  $('#vxUndo').addEventListener('click', () => { if (!undo.length) return; g = decode(undo.pop()); onChange(encode(g)); load(); });
  $('#vxResize').addEventListener('click', () => {
    const n = ['#vxNX', '#vxNY', '#vxNZ'].map(s => Math.max(2, Math.min(MAX, Math.round(+$(s).value || 2))));
    push();
    const ng = makeGrid(n[0], n[1], n[2]);
    // keep the figure centred left/right and front/back, on the floor
    const dx = Math.floor((n[0] - g.nx) / 2), dy = Math.floor((n[1] - g.ny) / 2);
    for (let zz = 0; zz < g.nz; zz++) for (let y = 0; y < g.ny; y++) for (let x = 0; x < g.nx; x++) if (get(g, x, y, zz)) set(ng, x + dx, y + dy, zz);
    g = ng; commit(); load();
  });
  return { load, get grid() { return g; } };
}
