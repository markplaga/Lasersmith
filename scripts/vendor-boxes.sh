#!/usr/bin/env bash
# Refresh vendor/boxespy from a boxes.py checkout plus the three pure-Python wheels it needs.
# Usage: scripts/vendor-boxes.sh /path/to/boxes
# The vendored tree is zipped by build.js and unpacked into Pyodide at runtime, so the browser never
# needs to reach PyPI. Only shapely (and numpy) come from the Pyodide CDN.
set -euo pipefail
SRC="${1:?path to a boxes.py checkout}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/vendor/boxespy"
TMP="$(mktemp -d)"
rm -rf "$DEST"; mkdir -p "$DEST"
cp -r "$SRC/boxes" "$DEST/boxes"; rm -rf "$DEST/boxes/scripts"
cp "$SRC/LICENSE.txt" "$DEST/boxes/LICENSE.txt" 2>/dev/null || cp "$SRC/LICENSE" "$DEST/boxes/LICENSE"
(cd "$SRC" && git rev-parse HEAD) > "$DEST/BOXES_COMMIT" 2>/dev/null || true
pip download --no-deps --only-binary=:all: -d "$TMP" "affine==2.4.0" "qrcode==8.2" "markdown==3.11.3" >/dev/null
for w in "$TMP"/*.whl; do (cd "$TMP" && python3 -m zipfile -e "$w" "$TMP/x"); done
for pkg in affine qrcode markdown; do cp -r "$TMP/x/$pkg" "$DEST/$pkg"; done
rm -rf "$DEST/affine/tests"
for lic in "$TMP"/x/*.dist-info; do name=$(basename "$lic" | cut -d- -f1); find "$lic" -type f -iname 'LICENSE*' -exec cp {} "$DEST/$name.LICENSE" \; ; done
find "$DEST" -name '__pycache__' -prune -exec rm -rf {} +
rm -rf "$TMP"
echo "vendored into $DEST"
