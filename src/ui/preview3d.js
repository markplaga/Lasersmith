// three.js preview of a Design document. Assembled view uses each part's 3D placement; parts without
// one (boxes.py designs) and the "flat" view lie on their nested sheets.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { placeMatrix, toWorld } from '../geom/design.js';
import { sheetTransform } from '../geom/nest.js';
import { bbox } from '../geom/poly.js';

export function createPreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3326, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(0.6, -0.9, 1.4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffe2c0, 0.6);
  fill.position.set(-1, 0.7, 0.3);
  scene.add(fill);
  const root = new THREE.Group();
  scene.add(root);
  let meshes = [], dowels = [], lastKey = '', explode = 0, center = new THREE.Vector3();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
  let raf = 0;
  // Stereo (as in Boxsmith): two pictures side by side for 3D without glasses.
  // cross: left picture is the RIGHT eye's view; parallel: left picture is the left eye's.
  // Eyes are offset along the camera's right vector so the convergence angle is `stereoDeg`.
  let stereo = 'off', stereoDeg = 3.5;
  const right = new THREE.Vector3(), base = new THREE.Vector3();
  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (stereo === 'off' || !w || !h) {
      camera.aspect = w / h || 1; camera.updateProjectionMatrix();
      renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h); renderer.render(scene, camera);
      return;
    }
    const vw = w / 2;
    base.copy(camera.position);
    const dist = base.distanceTo(controls.target);
    const e = dist * Math.tan((stereoDeg / 2) * Math.PI / 180);
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    camera.aspect = vw / h; camera.updateProjectionMatrix();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    renderer.setScissorTest(true);
    (stereo === 'cross' ? [1, -1] : [-1, 1]).forEach((eye, i) => {
      camera.position.copy(base).addScaledVector(right, eye * e);
      camera.lookAt(controls.target);
      renderer.setViewport(i * vw, 0, vw, h); renderer.setScissor(i * vw, 0, vw, h);
      renderer.render(scene, camera);
    });
    renderer.setScissorTest(false);
    camera.position.copy(base); camera.lookAt(controls.target);
  }
  const loop = () => { raf = requestAnimationFrame(loop); resize(); controls.update(); draw(); };
  loop();

  function clear() {
    root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    root.clear();
    meshes = [];
    dowels = [];
  }

  function shapeFrom(outline, holes, circles, T = p => p) {
    const s = new THREE.Shape(outline.map(p => new THREE.Vector2(...T(p))));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(...T(p)))));
    for (const c of circles) {
      const p = new THREE.Path();
      const q = T([c.cx, c.cy]);
      p.absarc(q[0], q[1], c.r, 0, Math.PI * 2, true);
      s.holes.push(p);
    }
    return s;
  }

  function mats(material) {
    const op = material.opacity ?? 1;
    const face = new THREE.MeshStandardMaterial({ color: material.color || '#e2c08d', roughness: 0.82, metalness: 0, transparent: op < 1, opacity: op, side: THREE.DoubleSide });
    const side = new THREE.MeshStandardMaterial({ color: material.side || '#b98a58', roughness: 0.9, metalness: 0, transparent: op < 1, opacity: op, side: THREE.DoubleSide });
    return [face, side];
  }
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x3b2a18, transparent: true, opacity: 0.35 });
  const engraveMat = new THREE.LineBasicMaterial({ color: 0x5a3a1c });

  function addPart(part, t, mm, matrix, T) {
    const geo = new THREE.ExtrudeGeometry(shapeFrom(part.outline, part.holes, part.circles, T), { depth: t, bevelEnabled: false, curveSegments: 24 });
    geo.translate(0, 0, -t / 2);
    const mesh = new THREE.Mesh(geo, mm);
    const g = new THREE.Group();
    g.add(mesh);
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat));
    const lines = [...part.engrave, ...part.score, ...part.cuts];
    if (lines.length) {
      const pts = [];
      for (const l of lines) for (let i = 0; i < l.length - 1; i++) {
        const a = T(l[i]), b = T(l[i + 1]);
        pts.push(a[0], a[1], t / 2 + 0.05, b[0], b[1], t / 2 + 0.05);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(lg, engraveMat));
    }
    if (matrix) { g.matrixAutoUpdate = false; g.matrix.fromArray(matrix); g.userData.base = g.matrix.clone(); }
    root.add(g);
    meshes.push({ g, part });
    return g;
  }

  const dowelMat = new THREE.MeshStandardMaterial({ color: 0xd8b47a, roughness: 0.6, metalness: 0 });
  const Y = new THREE.Vector3(0, 1, 0);
  function addDowel(hw) {
    const geo = new THREE.CylinderGeometry(hw.d / 2, hw.d / 2, hw.len, 20);
    const m = new THREE.Mesh(geo, dowelMat);
    m.quaternion.setFromUnitVectors(Y, new THREE.Vector3(...hw.axis).normalize());
    m.position.set(...hw.c);
    m.userData.base = m.position.clone();
    m.userData.dowel = hw;
    root.add(m);
    dowels.push(m);
  }

  /**
   * @param design Design document
   * @param nested nesting result (for the flat view and unplaced parts)
   * @param opts {mode: '3d'|'flat', material: {color, side, opacity}}
   */
  function show(design, nested, opts = {}) {
    clear();
    const t = design.material.thickness;
    const mm = mats(opts.material || {});
    const assembled = opts.mode !== 'flat' && design.parts.some(p => p.place);
    const sheetLines = [];
    if (assembled) {
      for (const p of design.parts) if (p.place) addPart(p, p.thickness || t, mm, placeMatrix(p.place), q => q);
      for (const hw of design.hardware || []) if (hw.kind === 'dowel') addDowel(hw);
    } else {
      let ox = 0;
      for (const sh of nested.sheets) {
        for (const it of sh.items) {
          const T0 = sheetTransform(it);
          const T = p => { const q = T0(p); return [q[0] + ox, -q[1]]; };
          const g = addPart(it.part, it.part.thickness || t, mm, null, T);
          g.position.z = t / 2;
        }
        // faint sheet outline
        const sg = new THREE.BufferGeometry().setFromPoints([[0, 0], [sh.w, 0], [sh.w, sh.h], [0, sh.h], [0, 0]].map(([x, y]) => new THREE.Vector3(x + ox, -y, 0)));
        const sl = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0x8a7f6c, transparent: true, opacity: 0.5 }));
        sl.userData.frameIgnore = true;
        sheetLines.push(sl);
        ox += sh.w + 40;
      }
    }
    const box = new THREE.Box3().setFromObject(root); // parts only: sheet outlines are added after
    for (const l of sheetLines) root.add(l);
    box.getCenter(center);
    // Re-frame only when the design's footprint changes noticeably, so tweaking a parameter keeps the view.
    const size = box.getSize(new THREE.Vector3());
    const key = (assembled ? 'a' : 'f') + [size.x, size.y, size.z].map(v => Math.round(Math.log2(v + 1) * 4)).join(',');
    if (key !== lastKey || opts.reframe) {
      lastKey = key;
      const R = Math.max(size.x, size.y, size.z, 10);
      controls.target.copy(center);
      const dir = assembled ? new THREE.Vector3(0.9, -1.4, 0.9) : new THREE.Vector3(0.0001, -0.35, 1);
      // Fit the bounding sphere into the narrower of the two fields of view.
      const asp = (canvas.clientWidth / (canvas.clientHeight || 1) || 1) / (stereo === 'off' ? 1 : 2);
      const vfov = (camera.fov * Math.PI) / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.3, asp));
      const radius = size.length() / 2;
      camera.position.copy(center).add(dir.normalize().multiplyScalar((radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.02));
      camera.near = R / 100; camera.far = R * 50; camera.updateProjectionMatrix();
    }
    setExplode(explode);
  }

  function setExplode(k) {
    explode = k;
    for (const { g, part } of meshes) {
      if (!g.userData.base || !part.place) continue;
      const bb = bbox(part.outline);
      const c = toWorld(part.place, (bb.x + bb.x1) / 2, (bb.y + bb.y1) / 2);
      const d = new THREE.Vector3(c[0] - center.x, c[1] - center.y, c[2] - center.z);
      const m = g.userData.base.clone();
      m.elements[12] += d.x * k; m.elements[13] += d.y * k; m.elements[14] += d.z * k;
      g.matrix.copy(m);
    }
    for (const d of dowels) {
      const b = d.userData.base;
      d.position.set(b.x + (b.x - center.x) * k, b.y + (b.y - center.y) * k, b.z + (b.z - center.z) * k);
    }
  }

  /** mode 'off' | 'cross' | 'parallel'; deg = convergence angle (depth) */
  function setStereo(mode, deg) {
    if (mode !== stereo) lastKey = ''; // re-frame for the half-width pictures
    stereo = mode || 'off';
    if (deg) stereoDeg = deg;
  }

  return { show, setExplode, setStereo, snapshot: () => canvas.toDataURL('image/png'), dispose() { cancelAnimationFrame(raf); clear(); renderer.dispose(); } };
}
