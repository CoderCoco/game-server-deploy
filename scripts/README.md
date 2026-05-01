# scripts/

Helper scripts for `game-server-deploy` maintainers. Part of the repo's npm
workspace — installed with a single `npm install` from the repo root.

## `init-parent` CLI

Interactive scaffolder for the [private parent + submodule deployment
pattern](https://codercoco.github.io/game-server-deploy/guides/submodule/). It
generates a `Makefile`, `terraform.tfvars`, `.env`, and `.gitignore` in your
parent repo, all wired to the wrapper Make targets (`setup`, `plan`, `apply`,
`update`, `dev`) so you can drive the whole stack from the parent repo root.

### Usage

From the parent (private) repo root, after adding the submodule:

```bash
git submodule add https://github.com/CoderCoco/game-server-deploy.git
(cd game-server-deploy && npm install)
npm run scripts:init-parent -w @gsd/scripts
```

Or using the subcommand directly:

```bash
npx tsx game-server-deploy/scripts/src/index.ts init
```

### Subcommands

```
init-parent [subcommand] [options]
init-parent --help
```

| Subcommand  | Description                                                    |
|-------------|----------------------------------------------------------------|
| `init`      | Interactive scaffolding for a new parent-repo deployment (default) |
| `bootstrap` | git init + optional repo create + submodule add + init (planned in #47) |
| `migrate`   | In-place rewrite of Makefile and .gitignore (planned in #47)   |

When invoked with no subcommand, `init` runs automatically.

### Options

- `--force` — overwrite existing files instead of skipping them (applies to `init`).
- `--help`, `-h` — list subcommands with one-line summaries.

The scaffolder never reads or modifies anything inside the submodule. Safe to
re-run; without `--force` it leaves existing files alone.

### Requirements

- Node.js 20+ (the same minimum the rest of the project enforces).
- `git` on `$PATH` (used to detect `.gitmodules`).

Windows users should run this under WSL or Git Bash — the generated
`Makefile` uses `bash`, `sha256sum`, and `cp`, which mirrors the upstream
Makefile's shell expectations.
