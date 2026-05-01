#!/usr/bin/env bash
# PostToolUse hook: runs `terraform fmt` on edited .tf files so files written
# by Claude stay consistent with `terraform fmt -check -recursive`.
#
# The hook receives PostToolUse JSON on stdin. We extract tool_input.file_path,
# bail unless it ends in .tf, and let `terraform fmt` rewrite it in place.
# Errors are non-blocking — we don't want a slow/missing terraform binary to
# stop edits.

set -uo pipefail

input="$(cat)"

file_path=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(d.get("tool_input", {}).get("file_path", ""))
except Exception:
    pass
' 2>/dev/null)

case "$file_path" in
  *.tf)
    if command -v terraform >/dev/null 2>&1; then
      terraform fmt "$file_path" >/dev/null 2>&1 || true
    fi
    ;;
esac

exit 0
