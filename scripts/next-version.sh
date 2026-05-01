#!/usr/bin/env bash
# Derives the next semver from Conventional Commits since the last git tag.
#
# Rules (matching the CC spec):
#   BREAKING CHANGE footer or `!` after type  → major bump
#   feat:                                      → minor bump
#   anything else (fix, chore, docs, …)        → patch bump
#
# Prints the new version (without the `v` prefix) to stdout.
# If no tags exist, starts from v0.0.0.
#
# Usage:  bash scripts/next-version.sh
#         VERSION=$(bash scripts/next-version.sh)

set -euo pipefail

# ── Last tag ──────────────────────────────────────────────────────────────────
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")

# Strip leading 'v'
VERSION="${LAST_TAG#v}"
MAJOR=$(echo "$VERSION" | cut -d. -f1)
MINOR=$(echo "$VERSION" | cut -d. -f2)
PATCH=$(echo "$VERSION" | cut -d. -f3)

# ── Commits since last tag ────────────────────────────────────────────────────
# Include both the subject line and body so we catch BREAKING CHANGE footers.
if [ "$LAST_TAG" = "v0.0.0" ] && ! git rev-parse v0.0.0 >/dev/null 2>&1; then
  COMMITS=$(git log --pretty=format:"%s%n%b" 2>/dev/null || echo "")
else
  COMMITS=$(git log "${LAST_TAG}..HEAD" --pretty=format:"%s%n%b" 2>/dev/null || echo "")
fi

# ── Determine bump type ───────────────────────────────────────────────────────
BUMP="patch"

if echo "$COMMITS" | grep -qE "(BREAKING CHANGE|^[a-z]+(\([^)]+\))?!:)"; then
  BUMP="major"
elif echo "$COMMITS" | grep -qE "^feat(\([^)]+\))?!?:"; then
  BUMP="minor"
fi

# ── Calculate next version ────────────────────────────────────────────────────
case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

echo "${MAJOR}.${MINOR}.${PATCH}"
