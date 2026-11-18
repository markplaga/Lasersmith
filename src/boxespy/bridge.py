# Lasersmith <-> boxes.py bridge. Runs in Pyodide (browser Web Worker) and in CPython (tests).
# Reads a generator's argparse definition as a parameter schema, and renders a generator into plain
# polylines grouped by part, without going through SVG.
#
# Part of Lasersmith, GPL-3.0-or-later. boxes.py is (c) Florian Festi and contributors, GPL-3.0.

import argparse
import importlib
import json
import math
import re

import boxes

SKIP = {"help", "output", "format", "debug", "reference", "inner_corners", "burn", "thickness",
        "language", "qr_code", "labels", "tabs"}
# Global settings Lasersmith owns (material + kerf) or that only make sense in boxes.py's own UI.


def _cls(module, name):
    mod = importlib.import_module("boxes.generators." + module)
    return getattr(mod, name)


def _clean_help(text):
    if not text:
        return ""
    text = re.sub(r"\s*\[[^\]]*\]\([^)]*\)", "", text)  # drop markdown links (help icons)
    return text.strip()


def _param(a, group):
    dest = a.dest
    if dest in SKIP or isinstance(a, argparse._HelpAction):
        return None
    default = a.default
    p = {"key": dest, "label": dest.replace("_", " "), "group": group, "help": _clean_help(a.help),
         "flag": a.option_strings[0] if a.option_strings else "--" + dest}
    typ = a.type
    tname = getattr(typ, "__name__", type(typ).__name__)
    if a.choices:
        p.update(type="select", choices=[{"value": str(c), "label": str(c)} for c in a.choices], default=str(default))
    elif tname == "BoolArg":
        p.update(type="bool", default=bool(default))
    elif tname == "ArgparseEdgeType":
        p.update(type="select", default=str(default),
                 choices=[{"value": c, "label": "%s (%s)" % (c, boxes.edges.getDescriptions().get(c, c))} for c in typ.edges])
    elif typ is float:
        p.update(type="number", default=float(default) if default is not None else 0.0)
    elif typ is int:
        p.update(type="int", default=int(default) if default is not None else 0)
    elif tname == "argparseSections":
        p.update(type="text", default=str(default), sections=True)
    else:
        p.update(type="text", default="" if default is None else str(default))
    if isinstance(default, str) and "\n" in default:
        p["multiline"] = True
    return p


def schema(module, name):
    cls = _cls(module, name)
    box = cls()
    params = []
    for g in box.argparser._action_groups:
        title = g.title or ""
        if title in ("positional arguments",):
            continue
        for a in g._group_actions:
            p = _param(a, re.sub(r"^for ", "", title.replace("Settings", "").strip()) or "Settings")
            if p:
                params.append(p)
    doc = (cls.__doc__ or "").strip()
    desc = getattr(box, "description", "") or ""
    return json.dumps({"module": module, "name": name, "doc": doc, "description": desc, "params": params})


# boxes.py colours -> Lasersmith layers. ANNOTATIONS (red) are dimension notes, not cut.
def _layer(rgb):
    r, g, b = (round(float(c)) for c in rgb[:3])
    if (r, g, b) == (1, 0, 0):
        return None
    if (r, g, b) == (0, 1, 0):
        return "engrave"
    if (r, g, b) == (0, 1, 1):
        return "score"
    return "cut"


def _flatten(c, last, tol=0.05):
    x0, y0 = last
    x3, y3, x1, y1, x2, y2 = c[1], c[2], c[3], c[4], c[5], c[6]
    est = math.hypot(x1 - x0, y1 - y0) + math.hypot(x2 - x1, y2 - y1) + math.hypot(x3 - x2, y3 - y2)
    n = max(2, min(64, int(math.ceil(math.sqrt(est / tol) * 0.5))))
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        a, b, cc, e = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
        out.append([a * x0 + b * x1 + cc * x2 + e * x3, a * y0 + b * y1 + cc * y2 + e * y3])
    return out


def run(module, name, args_json, thickness, kerf):
    """Render generator; returns JSON {parts: [{paths: [{layer, pts, closed}]}], warnings}."""
    cls = _cls(module, name)
    box = cls()
    args = json.loads(args_json)
    flags = {}
    for a in box.argparser._actions:
        if a.option_strings:
            flags[a.dest] = a.option_strings[0]
    argv = []
    for k, v in args.items():
        if k in SKIP or k not in flags:
            continue
        if isinstance(v, bool):
            v = "1" if v else "0"
        argv.append("%s=%s" % (flags[k], v))
    argv += ["--thickness=%s" % thickness, "--burn=%s" % (kerf / 2.0), "--reference=0", "--format=svg",
             "--labels=0"]
    box.parseArgs(argv)
    box.open()
    box.render()
    box.ctx.stroke()
    parts = []
    for part in box.surface.parts:
        paths = []
        for path in part.pathes:
            layer = _layer(path.params.get("rgb", (0, 0, 0)))
            if layer is None:
                continue
            # With burn > 0, boxes.py rounds inner corners into tiny self-crossing arcs; "corner" mode
            # replaces them with the sharp intersection point (what a laser cuts anyway).
            path.faster_edges("corner")
            cur = None
            last = None
            for c in path.path:
                C = c[0]
                if C == "M":
                    if cur and len(cur) > 1:
                        paths.append({"layer": layer, "pts": cur})
                    cur = [[c[1], c[2]]]
                    last = (c[1], c[2])
                elif C == "L":
                    if cur is None:
                        cur = [list(last or (0, 0))]
                    cur.append([c[1], c[2]])
                    last = (c[1], c[2])
                elif C == "C":
                    if cur is None:
                        cur = [list(last or (0, 0))]
                    cur.extend(_flatten(c, last or (0, 0)))
                    last = (c[1], c[2])
                # "T" (text) is skipped: Lasersmith engraves its own labels.
            if cur and len(cur) > 1:
                paths.append({"layer": layer, "pts": cur})
        if paths:
            parts.append({"paths": paths})
    return json.dumps({"parts": parts})
