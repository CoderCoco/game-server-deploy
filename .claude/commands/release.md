# /release — Trigger a release of init-parent

Guides the operator through publishing a new `init-parent.mjs` release asset
via the `release.yml` GitHub Actions workflow.

## Steps

1. **Check for unreleased commits** — run these to understand what's queued:
   ```bash
   git log $(git describe --tags --abbrev=0 2>/dev/null || echo "")..HEAD --oneline
   bash scripts/next-version.sh
   ```

2. **Verify the auto-derived version** is correct for the changes:
   - `feat:` commits since the last tag → minor bump
   - `fix:`, `chore:`, `docs:`, etc. → patch bump
   - `BREAKING CHANGE` footer or `type!:` → major bump
   - Override with the `version` input if the auto-derived bump is wrong.

3. **Run a dry run first** to check the version and preview the release notes
   without publishing:
   ```bash
   gh workflow run release.yml \
     -f dry_run=true \
     [-f version=X.Y.Z]   # optional override
   ```
   Then watch the run:
   ```bash
   gh run list --workflow=release.yml --limit=5
   gh run view <run-id> --log
   ```

4. **Publish** once the dry run looks good:
   ```bash
   gh workflow run release.yml \
     [-f version=X.Y.Z]   # omit to use auto-derived version
   ```

5. **Verify the release** at:
   ```bash
   gh release view --web
   ```
   Confirm the `init-parent.mjs` asset is attached and the notes look right.

## Notes

- The workflow requires `ANTHROPIC_API_KEY` in GitHub secrets to generate
  AI-drafted release notes via `claude-opus-4-7`. Without it, a plain commit
  list is used instead.
- The release workflow tags the commit with `v<version>` automatically via
  `gh release create`.
- Never publish a release directly from a non-`main` branch — merge to `main`
  first so the tag points to a clean history.
