# Lasersmith

Parametric laser-cut designs: pick something from the library, make it bespoke, and export files that
cut right the first time in LightBurn. See [docs/PRD.md](docs/PRD.md) for the full plan.

Done so far: **M1, local editor + export**, **M2, hinges**, **M3, Claude mode**, **M4, accounts and the shared library** (switches on with Supabase keys: see [docs/accounts.md](docs/accounts.md)) and **M5, voxel sculptures**.

## What works

- **Library**
  - *Finger-jointed box* (native, full 3D): closed box or open tray, inside or outside sizes, finger width,
    engraved part names. Plates are derived from 3D slab ownership, so they interlock exactly; tests
    check there is no 3D overlap and no gap for many sizes and thicknesses.
  - *Kerf and fit coupon* (native): a comb whose slots are each compensated for a different kerf, plus a
    finger-joint pair. Cut it first on a new material.
  - *Hinge test coupon* (native, M2): two small boxes joined by a cross hinge (Mark's universal joint:
    a flat square cross with a nub on each edge, two axes), a pin hinge or a swivel (both on wood dowels).
    Cut it first to check the fit.
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
  (with tabs through slots cut in each face), the nubbed cross or swivel discs, and any dowels. Cross nubs
  are t x t and turn in round arm holes of their diagonal plus a clearance; dowels are snug where glued and
  get the clearance where they turn. Every joint's range of
  motion is found by turning it in 3D until parts touch, and pose sliders show any pose (a pose past the
  range is a warning; the cut files are the same at any pose). Dowels are drawn in 3D and listed in the
  export README.
- **Claude mode** (PRD sections 3, 4.2, 6.5): when Lasersmith runs inside Claude, a *Create with Claude* panel
  turns a description (and optionally a sketch) into a **generator**: JavaScript written against the
  Lasersmith geometry API, with its own parameters. The generator runs in a sandboxed Web Worker (no DOM,
  network, storage or nested workers; 10 s limit), and its design is validated; errors go back to Claude
  automatically for up to 3 repair rounds. Ask for changes to a Claude-made design in the same panel
  ("make the legs thicker"), with undo. Your designs are kept in this browser and listed under *Your
  designs*; download a design's `.generator.js` (also in the export zip) and open it on the standalone site
  to edit its parameters and cut it without Claude. Without Claude the panel says it needs Claude.
- **Voxel sculptures** (PRD section 9): *Voxel sculpture* in the library slices a figure (rocket, cat,
  heart, pine tree, or your own) into two families of flat pieces at right angles, with half-lap slots
  wherever they cross, engraved piece numbers and assembly notes. Choose the voxel size, which way the
  pieces run and the plane spacing. Slivers too small to hold are left out. The *Voxel editor* paints
  cubes one layer at a time (mirror, fill, copy layer, undo, resize up to 64³). Claude can build figures
  from a description through `api.voxels`. Not yet: a third plane family, mesh import.
- **3D preview** (three.js): assembled view with explode slider for native designs, flat sheet view for all,
  and stereo (cross-eyed or parallel, with a depth slider) as in Boxsmith.

## Develop

```sh
npm install
npm run build        # dist/index.html + dist/boxespy.zip (site), dist/artifact.html (single file)
npm test             # geometry, generators, export; boxes.py generators too if python3 has shapely
npm run e2e          # browser tests (Playwright + Chromium), incl. Claude mode with a stand-in
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
- `src/claude/` Claude mode: `api.js` (the geometry API generators get), `genworker.js` (the sandbox worker),
  `sandbox.js` (main-thread runner, time limit, line numbers), `prompt.js` (API reference and examples
  Claude reads), `session.js` (ask, run, validate, repair loop). `src/mine.js` keeps your designs.
- `src/voxel/` voxel grids and figures (`grid.js`) and the slicer (`slice.js`); `src/ui/voxeleditor.js`.
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
