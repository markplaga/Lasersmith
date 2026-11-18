# Lasersmith

Parametric laser-cut designs: pick something from the library, make it bespoke, and export files that
cut right the first time in LightBurn. See [docs/PRD.md](docs/PRD.md) for the full plan.

Done so far: **M1, local editor + export**, and **M2, hinges** (no accounts or Claude features yet).

## What works

- **Library**
  - *Finger-jointed box* (native, full 3D): closed box or open tray, inside or outside sizes, finger width,
    engraved part names. Plates are derived from 3D slab ownership, so they interlock exactly; tests
    check there is no 3D overlap and no gap for many sizes and thicknesses.
  - *Kerf and fit coupon* (native): a comb whose slots are each compensated for a different kerf, plus a
    finger-joint pair. Cut it first on a new material.
  - *Hinge test coupon* (native, M2): two small boxes joined by a cross hinge (Mark's universal joint,
    two axes), a pin hinge (one axis) or a swivel, on wood dowels. Cut it first to check the dowel fit.
  - *Articulated robot* (native, M2): torso, head, two arms and two legs, each a finger-jointed box on its
    own hinge (cross or pin hinges, swivel or hinge neck), with an engraved face.
  - *26 boxes.py generators* (closed/based/universal boxes, hinge boxes, flex boxes, trays, drawers, gears,
    platonic solids and more), running the original Python in the browser with Pyodide in a Web Worker.
    Every parameter from the generator's own argparse definition shows up in the panel.
- **Material and machine**: 3 mm / 6 mm birch ply, 3 mm MDF, 3 mm acrylic presets or custom thickness and
  kerf; bed size (default 36" x 24", 914.4 x 609.6 mm) and margin; mm or inch display.
- **Checks** (errors block export): closed, non-self-intersecting outlines; parts fit the bed; thin
  bridges between cuts; features smaller than the kerf; 3D collisions between assembled parts.
- **Nesting** onto as many sheets as needed (MaxRects with rotation).
- **Export**: LightBurn `.lbrn2`, SVG (mm-accurate), DXF R12, or a zip of every sheet in every format with
  a README. Kerf compensation is applied on export (boxes.py designs apply it themselves via `burn`).
  Layers use the Boxsmith/Polysmith colours: red cut, blue score, green line engrave, black fill engrave;
  inner cuts are written before outer cuts.
- **Hinges** (PRD section 7): boxes expose a port on every face; a hinge between two ports adds the arms
  (with tabs through slots cut in each face), the cross block or swivel discs, and the dowels. Arm holes are
  cut at the dowel size (glue or press fit); the part that turns gets a clearance. Every joint's range of
  motion is found by turning it in 3D until parts touch, and pose sliders show any pose (a pose past the
  range is a warning; the cut files are the same at any pose). Dowels are drawn in 3D and listed in the
  export README.
- **3D preview** (three.js): assembled view with explode slider for native designs, flat sheet view for all,
  and stereo (cross-eyed or parallel, with a depth slider) as in Boxsmith.

## Develop

```sh
npm install
npm run build        # dist/index.html + dist/boxespy.zip (site), dist/artifact.html (single file)
npm test             # geometry, generators, export; boxes.py generators too if python3 has shapely
npm run e2e          # browser smoke test (Playwright + Chromium)
npm run dev          # rebuild on change
```

Open `dist/index.html` through any static server (boxes.py designs fetch `boxespy.zip` next to it).

- `src/geom/` geometry core, DOM-free: polygons and kerf offsets, rectangle-union outlines, the Design
  document, validation, nesting.
- `src/generators/` native generators (`{id, params, generate(params, material) -> Design}`); `buildBox` in
  `fingerbox.js` is the reusable finger-jointed box with ports.
- `src/joints/hinge.js` cross hinge, pin hinge and swivel: parts in a joint frame, `addHinge` to hang a box off
  a port, posing and the range-of-motion sweep. `src/geom/frame.js` has the 3D rigid-motion helpers.
- `src/boxespy/` the boxes.py bridge: `bridge.py` (reads argparse schemas, renders parts as polylines),
  the worker, the main-thread client and the adapter into a Design document.
- `src/export/` SVG, DXF, LBRN2 and zip writers.
- `src/ui/` parameter panel and three.js preview; `src/main.js` wires it together.
- `vendor/boxespy/` boxes.py plus its pure-Python dependencies (affine, qrcode, markdown), refreshed with
  `scripts/vendor-boxes.sh /path/to/boxes`. Only shapely (with numpy) is loaded from the Pyodide CDN.

Pyodide test against a local Pyodide distribution: `LASERSMITH_PYODIDE=/path/to/pyodide/ npm test`, or
`node tests/e2e/smoke.mjs /path/to/pyodide/` to run boxes.py in the browser test.

## Deploy

Netlify builds with `npm ci && npm run build` and publishes `dist/` (see `netlify.toml`).
`dist/artifact.html` is the same app as one self-contained file for running inside Claude.

## Licence

GPL-3.0-or-later (see `LICENSE`), because Lasersmith ships boxes.py (GPL-3.0, Florian Festi and
contributors) to the browser. affine, qrcode and markdown are BSD-licensed; their licences are in
`vendor/boxespy/`.
