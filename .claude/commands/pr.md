Create a pull request for the current branch, enforcing the repo's Conventional Commits title format.

## Steps

1. **Gather context** — run these in parallel:
   - `git log main..HEAD --oneline` — commits on this branch
   - `git diff main...HEAD --stat` — files changed
   - `git status` — any uncommitted work (warn if present)

2. **Derive a CC-formatted title.**
   - Format: `<type>(<optional-scope>): <imperative summary>`
   - `<type>` must be one of: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`, `style`
   - Keep the full title under 70 characters
   - Base the title on what the branch actually changes — use the commit log and diff stat as evidence, not just the branch name
   - If $ARGUMENTS is non-empty, treat it as the user's suggested title or type hint and incorporate it

3. **Validate before proceeding.**
   - The title must match: `^(feat|fix|refactor|docs|test|chore|perf|build|ci|style)(\([^)]+\))?: .{1,60}$`
   - If it doesn't, fix it — do not create the PR with a non-conforming title

4. **Show the proposed title** to the user and ask for confirmation before creating the PR.

5. **Create the PR** using `mcp__github__create_pull_request` with:
   - The validated title
   - A body summarising: what changed, why, and a test plan (bullet points)
   - Base branch: `main`

6. **Return the PR URL** when done.
