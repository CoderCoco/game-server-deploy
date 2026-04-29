#!/usr/bin/env bash
# Render every .d2 source file in this directory to SVG.
# Output goes to docs/static/diagrams/ so Docusaurus serves them at /diagrams/*.svg.
# Run in CI (docusaurus-gh-pages.yml) before `npm run build`; run locally
# before `npm start` if you want to preview diagram changes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../static/diagrams"
mkdir -p "$OUT_DIR"
cd "$SCRIPT_DIR"
shopt -s nullglob
for f in *.d2; do
  out="$OUT_DIR/${f%.d2}.svg"
  echo "rendering $f -> $out"
  d2 "$f" "$out"
done
