#!/usr/bin/env bash
# Render every .d2 source file in this directory to SVG next to it.
# Run in CI (.github/workflows/jekyll-gh-pages.yml) before Jekyll builds;
# run locally before `bundle exec jekyll serve` if you want to preview.
set -euo pipefail
cd "$(dirname "$0")"
shopt -s nullglob
for f in *.d2; do
  out="${f%.d2}.svg"
  echo "rendering $f -> $out"
  d2 "$f" "$out"
done
