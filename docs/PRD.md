# Lasersmith: Product Requirements Document

**Status:** Draft v0.1 · **Owner:** Mark · **Last updated:** 2026-11-18

Lasersmith is a public website for designing laser-cut objects. People pick a design from a shared library and tune its parameters until it fits their need, or (when Claude is available) describe something that does not exist yet and have Claude build it. Designs can be joined with wooden hinges into posable, articulated objects, and solid shapes can be turned into "voxel" sculptures made of interlocking flat planes. Every output is a cut-ready file for a 24" x 36" laser in LightBurn.

Lasersmith is the third tool in a family with **Boxsmith** (parametric boxes) and **Polysmith** (Platonic solids). It reuses their technical approach and pulls in the generator catalogue from **boxes.py**.

---

## 1. Goals

1. **Create from scratch with Claude.** A user describes an object ("an articulated robot with posable arms, about 30 cm tall") and Claude produces a parametric design that is checked, previewed in 3D, and exported.
2. **Make anything in the library bespoke.** Any library design can be re-sized, re-materialled and re-styled by editing parameters, with no Claude needed.
3. **Combine objects with wooden hinges.** Parts from different designs can be joined with all-wood joints, including Mark's two-axis cross ("universal joint") hinge, so the result is posable.
4. **Voxel sculptures.** Turn a figure into a set of flat pieces, all at right angles to each other, that slot together into a 3D sculpture.
5. **Share.** Accounts, personal libraries, and a public library others can browse, fork and remix.

### Non-goals (for now)

- Driving the laser directly. LightBurn stays the machine controller; Lasersmith hands it files.
- CNC routers, 3D printers, or non-planar fabrication.
- Selling designs, payments, or a marketplace.
- Raster image tracing as a core feature (Boxsmith already does it; it can be ported later).

## 2. Users

| User | What they want |
|---|---|
| **Maker with a laser** (primary, Mark) | Fast path from idea to a file that cuts right the first time on their machine and material. |
| **Browser / remixer** | Find a design in the public library, change a few numbers, download. No account needed to download. |
| **Contributor** | Save, publish and version their own designs and Claude-made generators so others can use them. |

## 3. Two operating modes

Lasersmith is one codebase that runs in two places. The difference is whether Claude is reachable.

| | **Standalone site** (public web) | **Claude mode** (running as a Claude artifact, or site with Claude connected) |
|---|---|---|
| Browse / search library | Yes | Yes |
| Edit parameters of existing designs | Yes | Yes |
| Combine designs + add hinges | Yes, from existing designs and joint types | Yes |
| Voxel sculpture from the voxel editor | Yes | Yes |
| **Create a new design from a description** | No | Yes |
| **Create a new voxel figure from a description** | No | Yes |
| **Ask Claude to modify a design** ("make the arms longer and add a gripper") | No | Yes |
| Save / publish to library | Yes (signed in) | Yes (signed in) |

**How Claude mode is detected.** Same pattern Polysmith uses today: the page calls `window.claude.use('sample')` at start-up. If that resolves, Claude features appear; if not, they stay hidden and the page explains they need Claude. No separate build.

**What Claude produces.** Claude does not emit a one-off SVG. It writes a **generator**: a small JavaScript module against the Lasersmith geometry API (section 6.2) with a parameter schema and defaults. That is what makes a Claude-made design parametric, and is why a design Claude creates in Claude mode can later be edited by anyone on the standalone site without Claude.

## 4. Core user flows

### 4.1 Make an existing design bespoke (standalone)

1. Browse or search the library (filters: category, joint type, sheet count, material).
2. Open a design: 3D preview on the left, parameter panel on the right, sheet layout below.
3. Change parameters (dimensions in mm or inches, material, thickness, kerf, options). Preview and validation update live.
4. Fix any validation warnings (parts too big for the bed, slots narrower than material, thin bridges).
5. Export: SVG, DXF, or LightBurn `.lbrn2`, one file per sheet or a zip with an assembly sheet.
6. Optionally sign in and save as a "variant" to their library, or publish it.

### 4.2 Create something new with Claude

1. User types a request, optionally with a sketch or reference image.
2. Claude asks at most a couple of clarifying questions (size, material, posable or static).
3. Claude writes a generator, which runs in a sandboxed Web Worker. The result is validated (section 8). Failures go back to Claude automatically for up to N repair rounds.
4. User sees the 3D preview and parameter panel, exactly like a library design, and can keep chatting ("thicker legs", "add a hinge at the waist").
5. Save / publish. The generator source, schema, prompt history and a thumbnail are stored.

### 4.3 Combine objects with hinges

1. In an **Assembly** view, the user adds two or more designs (e.g. a torso box and an arm box).
2. Each design exposes **ports**: named mounting points on its faces (section 7.1).
3. User drags a part so a port snaps to a port on another part, then chooses a joint type (fixed, pin hinge, cross / U-joint, swivel).
4. Lasersmith modifies both parts' cut geometry (adds arms, holes, slots), generates the joint's own parts (e.g. the cross), and shows the range of motion in 3D.
5. The assembly is itself a design: it has parameters (joint clearance, pin type) and can be saved and published.

### 4.4 Voxel sculpture

1. Start from one of: the in-browser **voxel editor** (paint cubes on a 3D grid), a **library figure**, a **mesh import** (later), or (Claude mode) a **description** ("a sitting cat, 25 cm tall").
2. Choose plane spacing, material thickness, and which axes get planes.
3. Lasersmith slices the figure into orthogonal plane families, adds interlocking slots where planes cross, labels every piece, and checks assembly order.
4. Preview with an "assemble" animation, then export sheets plus an assembly guide.

## 5. Design library

### 5.1 Seed content

- **boxes.py generators.** The library launches with the boxes.py catalogue (about 170 generators in the `boxes/generators` folder of the reference fork), each wrapped as a library entry with its parameter schema read from its argparse definition. Start with a curated subset (around 20 that cut well and preview well), then widen.
- **Boxsmith and Polysmith designs.** Their geometry is already DOM-free JS (Polysmith's `geom.js`) and can be wrapped as native generators.
- **Connected designs.** New, Lasersmith-native designs whose point is joined parts. The flagship is the **articulated robot**: box torso and head, arms and legs joined with cross hinges, posable at shoulders, elbows, hips and knees.
- **Hinge test coupons** and **kerf / fit coupons** for dialling in a material.

### 5.2 Library entry model

Each entry stores:

- Title, description, tags, thumbnail, author, licence, fork-of link.
- **Generator reference**: native JS, boxes.py (Python), or user/Claude JS (versioned source).
- **Parameter schema**: name, type, unit, default, min/max, group, help text.
- **Ports** it exposes (for combining).
- **Variants**: saved parameter sets (e.g. "Mark's 3 mm ply robot, 40 cm").
- Version history; a published version is immutable, edits make a new version.

### 5.3 Sharing

- Visibility per design: private, unlisted (link only), public.
- Anyone can view and download public designs without an account. Saving, forking and publishing need an account.
- Fork keeps attribution. Likes / "made it" photos are a nice-to-have.
- Reporting and takedown for public content; Claude-generated code is reviewed by the validator before it can be published (section 9).

## 6. Architecture

### 6.1 Stack alignment with Boxsmith and Polysmith

Both reference tools are plain browser JavaScript with no framework, no server, and a single self-contained `index.html`. Polysmith adds a tiny `build.js` that inlines `src/` into one file, keeps all geometry in a DOM-free `geom.js`, and tests it with plain Node scripts. Lasersmith keeps that shape so it can still ship as a **single-file Claude artifact**:

- **Front end:** vanilla JS (ES modules in `src/`), no UI framework. three.js for 3D (Boxsmith uses r128; move to a current version). Earcut for triangulation (as Polysmith).
- **Geometry core:** `src/geom/` is DOM-free and runs in a browser, a Web Worker, and Node, so the same code drives the UI, the validator and the tests.
- **Build:** a `build.js` in the Polysmith style produces (a) `dist/artifact.html`, one self-contained file for Claude mode, and (b) the static site for hosting.
- **Tests:** `node tests/*.js` like Polysmith (geometry closure, collision sweeps, slot alignment, sheet fit).

### 6.2 Geometry API (what generators are written against)

A small, documented API that native, Claude-made and user generators all use:

- 2D: paths, polygons, circles, boolean ops, offsets (for kerf), text-to-outline.
- Edges and joints: finger joints, slots, tabs, dovetails, living hinges, captive nut slots (ported from Boxsmith and modelled on `boxes/edges.py`).
- Parts: a 2D outline with holes and engrave layers, plus a 3D placement (thickness, transform) for preview and collision checks.
- Ports (section 7.1).
- Output: a **Design document** (JSON) holding parts, placements, layers, ports and metadata. Everything downstream (preview, validation, nesting, export) reads only this document.

### 6.3 Running boxes.py generators

boxes.py is Python, which the rest of the stack is not. Recommended approach: run it **in the browser with Pyodide** inside a Web Worker. Its dependencies (affine, shapely, qrcode, markdown) are pure Python or already packaged for Pyodide. This keeps the site static, works in Claude mode, and needs no Python server. Pyodide is a large first download (roughly 10 MB), so it loads only when a boxes.py design is opened and is cached after that.

boxes.py output is SVG, so a thin adapter turns it into a Design document. boxes.py parts have no 3D placement, so 3D preview for those designs is limited to what the adapter can infer (flat-pack view always; folded 3D for a hand-annotated subset).

Fallback if Pyodide proves too heavy: a Python serverless function that runs boxes.py and returns SVG.

> **Licence note:** boxes.py is GPL-3.0. Shipping it to browsers is distribution, so the simplest clean path is to licence Lasersmith under GPL-3.0 too. See open question Q7.

### 6.4 Backend and hosting

Recommended (see Q4):

- **Hosting:** Netlify (already connected) for the static site, with **Netlify Functions in TypeScript** for the small API (save, publish, fork, search, Claude proxy for the site's own Claude connection if added later).
- **Data, auth, storage:** Supabase (Postgres + auth + file storage). Postgres holds users, designs, versions, variants and tags; storage holds thumbnails and exported zips. Row-level security enforces private / unlisted / public.
- **No backend needed for Claude mode itself**: in the artifact, Claude calls go through `window.claude`. The artifact talks to the same API to read the library and to save, when the user signs in.

### 6.5 Claude integration

- Detection and calls via `window.claude.use('sample')`, as in Polysmith, with the same error handling (not granted, rate limited, refused, cancelled).
- Claude gets a system prompt containing the geometry API reference, a few example generators, the joint and port catalogue, and the user's machine and material profile.
- Generated code runs only in a sandboxed Web Worker with no DOM, network or storage access, a time limit and a memory limit.
- Repair loop: validator errors are fed back to Claude automatically (cap: 3 rounds), then shown to the user.

## 7. Hinges and combining objects

### 7.1 Ports

A port is a named mounting point on a part face: a position, an outward normal, an "up" direction, and the area available for a joint. Library designs declare their ports (e.g. robot torso: `shoulder_left`, `shoulder_right`, `hip_left`, `hip_right`, `neck`). Users can also add a port by clicking a face. Joining two ports aligns their frames, then the chosen joint type rewrites the geometry on both sides.

### 7.2 Joint catalogue (v1)

| Joint | Motion | Notes |
|---|---|---|
| **Fixed** | none | Finger joint or slot-and-tab between faces. |
| **Pin hinge (clevis)** | 1 axis | Two arms on one part, one arm on the other, pin through all three. Like the boxes.py `HingePin` but between separate objects. |
| **Cross hinge (U-joint)** | 2 axes | Mark's design, below. |
| **Swivel** | rotation about the port normal | Stacked discs with a centre pin, for necks and waists. |

### 7.3 Cross hinge (Mark's universal joint)

```
            ┌──────────┐
            │  Box A   │
            └┬────────┬┘
       arm A ║        ║ arm A        (Box A's arms, from two opposite faces)
             o───┼────o              cross: nubs in A's arm holes
                 │
                 o  ← other two nubs (perpendicular axis)
          arm B ║  ║ arm B           (Box B's arms take these nubs)
            ┌───┴──┴───┐
            │  Box B   │
            └──────────┘
```

- **Box A** (a six-sided box) has two **arms**, flat tabs with a hole near the tip, one coming out of each of two opposite faces and extending the same way past the box, so they form a fork (a clevis).
- The **cross** is two flat bars joined with a half-lap slot into a "+". Its four ends are **nubs**. One opposite pair goes into Box A's arm holes.
- **Box B** has its own pair of arms that take the cross's other two nubs.
- Result: Box B can tilt about two perpendicular axes relative to Box A, like a universal joint.

Parameters: arm length, arm width, arm gap (fits the cross), hole diameter, cross bar width, cross size, clearance, pin type (Q2), and range-of-motion limits.

Lasersmith must:

- generate the arms as part of each box's face geometry (tabs that pass through slots in the face and lock with a cross-key, or arms cut as part of a doubled face, depending on load);
- generate the cross pieces;
- compute and show the range of motion in 3D, and flag where the boxes collide before the joint's limit;
- size holes from material, kerf and the chosen pin type, and offer a **hinge test coupon** (one joint, small) so the fit can be checked before cutting a whole robot.

Design risk: a flat-cut nub has a rectangular cross-section, so it does not rotate smoothly in a round hole. The default (Q2) is to use the nubs as **bosses drilled for a dowel pin**, i.e. the pin is round wood dowel and the nubs and arms both have round holes.

## 8. Validation (applies to every design, including Claude's)

A design cannot be exported or published until these pass (warnings can be overridden; errors cannot):

- Every part outline is closed and non-self-intersecting.
- Every part fits the bed (609.6 x 914.4 mm) with margin; oversize parts are flagged with a split suggestion.
- Slot widths and tab widths match material thickness after kerf compensation.
- No bridge thinner than a material-dependent minimum (Polysmith already tests this for cut-out patterns).
- 3D collision check of the assembled design (and of the joint's full range of motion for hinges).
- Assembly is possible: every piece can be inserted in some order (essential for voxel sculptures).

## 9. Voxel sculptures

**Definition.** A sculpture made only of flat pieces whose planes are all at right angles to each other, in up to three families (XY, YZ, XZ), that slot together.

**Pipeline.**

1. **Input:** a voxel grid (from the editor, a library figure, Claude, or a voxelised mesh).
2. **Slice:** choose which axes get planes and the spacing between planes (in voxel units). Each plane's piece is the cross-section of the figure at that plane.
3. **Cleanup:** drop slivers under a minimum area, merge islands that touch, and split pieces that would be too fragile or too big for the bed.
4. **Interlock:** where two families cross, cut half-lap slots (each piece slotted halfway). Where all three families meet at one point, two families interlock with half-laps and the third is split into separate pieces that slot onto the other two, so assembly stays possible. The tool chooses the split automatically and checks assembly order.
5. **Label:** engrave a small ID on every piece (optional, on the hidden face where possible) and produce an assembly guide.
6. **Nest and export.**

**Voxel editor (standalone).** Grid up to about 64³; add/remove cubes, mirror symmetry, fill, layer view, undo. Saved as a library design like any other.

**Claude mode.** Claude can output a voxel grid from a description and then refine it ("make the ears bigger").

**Later:** STL/OBJ import with voxelisation; stylised "slice" sculptures with non-uniform plane spacing.

## 10. Laser and LightBurn output

- **Machine profile** (per user, default from Mark's setup): bed 24" x 36" (609.6 x 914.4 mm), units, kerf per material, origin corner.
- **Material profiles:** name, thickness (measured, not nominal), kerf, minimum bridge width, cost per sheet. Defaults for 3 mm birch ply, 6 mm birch ply, 3 mm MDF, 3 mm acrylic. Fit-test coupon (port from Polysmith) to set kerf.
- **Layers** (same colour convention as Boxsmith/Polysmith so existing LightBurn libraries keep working): red = cut, blue = score, green = line engrave, black = fill engrave. Inner cuts ordered before outer cuts.
- **Formats:** SVG (mm-accurate, LightBurn-friendly), DXF, and **LightBurn `.lbrn2`** (boxes.py already has an LBRN2 surface we can reference). Export per sheet or as a zip with an assembly PDF/HTML and a README.
- **Nesting:** pack parts across as many 24" x 36" sheets as needed, with grain direction lock and part rotation; Boxsmith's nesting and hole-filling is the starting point. Also support smaller custom stock sizes.

## 11. Accounts and data

- Sign-in with email magic link and Google; GitHub optional.
- A user has: profile, machine profile, material profiles, designs, variants, favourites.
- Anonymous users can use everything except save / publish; their work persists in the browser until they sign in, then can be imported.
- Export of all of a user's data on request.

## 12. Non-functional requirements

- **Performance:** parameter change to updated preview under 200 ms for native designs on a mid-range laptop; boxes.py designs under 1 s after Pyodide is loaded.
- **Accuracy:** exported geometry to 0.01 mm; units always explicit in files.
- **Offline-ish:** the artifact build works with no network for native designs.
- **Accessibility:** keyboard-usable parameter panel, sufficient contrast, units always labelled.
- **Security:** Claude/user generator code only runs in the sandboxed worker; no `eval` on the main thread; uploaded SVGs are sanitised.
- **Mobile:** browsing and parameter editing work on a phone; assembly and voxel editing are desktop-first.

## 13. Success measures

- Mark can go from description to a cut, assembled articulated robot with working cross hinges, with no manual CAD edits.
- A first-time user can download a bespoke boxes.py design in under 2 minutes without an account.
- Hinge test coupon fits first try with the default material profile at least 8 times in 10.
- Over 80% of Claude-generated designs pass validation within the automatic repair rounds.

## 14. Milestones (proposed)

| # | Milestone | Contents |
|---|---|---|
| **M1** | **Local editor + export** | Repo scaffold (src/, build.js, tests), geometry core, Design document, 3D preview, parameter panel, validation, nesting on 24" x 36", SVG/DXF/LBRN2 export. Library: ~20 boxes.py generators via Pyodide plus Boxsmith closed box. No accounts. Ships as both the static site and the artifact. |
| **M2** | **Hinges** | Ports, pin hinge, cross hinge, swivel, range-of-motion preview, hinge test coupon. Articulated robot as the first connected design. |
| **M3** | **Claude mode** | Generator authoring by Claude, sandbox, repair loop, chat-driven edits. |
| **M4** | **Accounts + shared library** | Supabase, sign-in, save/fork/publish, public browse and search. |
| **M5** | **Voxel sculptures** | Voxel editor, slicer, three-family interlock, assembly guide; Claude voxel generation. |

M2 before M3 is deliberate: Claude needs the joint and port vocabulary to build an articulated robot well.

## 15. Open questions (with recommended defaults)

| # | Question | Recommended default |
|---|---|---|
| **Q1** | Material thickness and kerf? | Default to **3 mm (1/8") birch ply, kerf 0.15 mm**, but always use the measured thickness from the user's material profile and ship a fit-test coupon to calibrate. Add 6 mm ply as the second preset for load-bearing hinge parts. |
| **Q2** | Friction-fit vs dowel/bolt pins for posable joints? | **Wooden dowel pins** by default (e.g. 1/8" or 3 mm dowel). A round pin in a round hole turns smoothly, and pose-holding friction is tuned by hole clearance. Offer **M3 bolt + nyloc nut** as an option where adjustable tension matters. Offer all-laser-cut friction nubs only as an experimental option. |
| **Q3** | Are voxel sculptures built in a browser 3D editor or described to Claude? | **Both.** The browser voxel editor is the standalone path and ships first; describing to Claude is added in Claude mode and outputs the same voxel grid so it can be edited by hand afterwards. Mesh import later. |
| **Q4** | Hosting and backend language? | **Netlify** static hosting + **Netlify Functions in TypeScript**, **Supabase** for Postgres/auth/storage. Keeps one language (JS/TS) across front end, generators and backend; boxes.py runs client-side in Pyodide, so no Python server. |
| **Q5** | First milestone? | **M1: local editor + export** (section 14), with no accounts or Claude, so the geometry core, export and the boxes.py bridge are proven on the real laser first. |
| **Q6** | Should the artifact (Claude mode) be able to save to the public library? | Yes, after the user signs in from inside the artifact; otherwise "download design file" and import on the site. |
| **Q7** | Licence? | **GPL-3.0**, to match boxes.py, which Lasersmith ships to browsers. Alternative: keep boxes.py support as a separately licensed, optional module. |
| **Q8** | Who can publish Claude-generated generators publicly? | Any signed-in user, but only after the validator passes and the code runs in the sandbox; flag "Claude-made" on the entry. |

## 16. References

- Boxsmith: `markplaga/Boxsmith` (single-file browser app, finger joints, hinged lids, nesting, LightBurn layer export).
- Polysmith: `markplaga/Polysmith` (`src/` + `build.js`, DOM-free `geom.js`, Node tests, `window.claude` integration).
- boxes.py fork: `markplaga/boxes` (generators, `edges.py` joint library including `Hinge`/`HingePin`/`ChestHinge`, `robot.py`, LBRN2 output).
