# CLAUDE.md

## Common Commands

The management app is a TypeScript **npm-workspaces** monorepo under `app/`. Dependencies are installed once at the workspace root. The workspaces are:

- `@gsd/shared` — types, `canRun`, sanitizers, status formatter, command descriptors, DynamoDB + Secrets Manager helpers (used by both the server and the Lambdas).
- `@gsd/server` — Nest.js management API.
- `@gsd/web` — React + Vite client.
- `@gsd/lambda-interactions`, `@gsd/lambda-followup`, `@gsd/lambda-update-dns`, `@gsd/lambda-watchdog` — four Lambda packages, each bundled to a single `dist/handler.cjs` by esbuild.

```bash
# Install all workspaces in one go
cd app && npm install

# Run the dev servers (Nest on 3001, Vite on 5173 with /api proxy)
cd app && npm run dev

# Production build (shared → server → web)
cd app && npm run build && npm start    # http://localhost:3001

# Build all Lambda bundles (required before `terraform apply`)
cd app && npm run build:lambdas

# Run the app in Docker (mounts ./terraform ro, ./app/server_config.json, ~/.aws)
docker compose up --build               # http://localhost:5000

# Terraform (all infra lives under terraform/). NOTE: terraform apply reads
# the Lambda bundles from app/packages/lambda/*/dist/handler.cjs — run
# `npm run build:lambdas` first or the archive_file data sources will fail.
cd terraform
terraform init
terraform plan
terraform apply
terraform destroy

# Cost allocation: all resources tagged Project=game-servers-poc. Activate the
# "Project" tag in AWS Billing → Cost allocation tags for Cost Explorer breakdowns.

# First-time environment bootstrap (installs terraform + aws CLI if missing,
# runs npm ci, builds Lambdas, runs terraform init)
./setup.sh

# Unit tests (vitest + aws-sdk-client-mock) — discovered across every workspace
cd app && npm test             # one-off run
cd app && npm run test:watch   # watch mode
```

ESLint (flat config) lives at `app/eslint.config.js` using `@eslint/js` + `typescript-eslint` recommended presets, plus `eslint-plugin-react` and `eslint-plugin-react-hooks` recommended for the web package. Run `npm run lint` (or `npm run lint:fix`) from `app/`.

Terraform linting uses [tflint](https://github.com/terraform-linters/tflint) with its `recommended` preset and the AWS ruleset plugin. Config lives at `terraform/.tflint.hcl`. Run `tflint --init` once to install the plugin, then `tflint` from `terraform/`. `terraform fmt -check -recursive` and `terraform validate` cover formatting and syntax.

## Architecture

Three loosely-coupled pieces share code via `@gsd/shared`:

1. **Terraform (`terraform/`)** provisions all AWS infrastructure, including four Node.js Lambdas (interactions, followup, update-dns, watchdog), a DynamoDB table, and two Secrets Manager secrets for Discord credentials.
2. **Management app (`app/packages/server` + `app/packages/web`)** — Nest.js (on `@nestjs/platform-express`) backend reads `terraform/terraform.tfstate` directly at runtime to discover cluster/subnet/SG IDs + the Discord store locations, then drives AWS via the AWS SDK v3. React/Vite frontend talks to the Nest API. Services use **Nest's built-in DI** (`@Injectable()`) and **Winston** for structured logging. Feature modules under `app/packages/server/src/modules/` (`AwsModule`, `DiscordModule`) group related providers; HTTP handlers live in `app/packages/server/src/controllers/` as `@Controller`-decorated classes wired up through `AppModule`.
3. **Lambdas (`app/packages/lambda/*`)** — four TypeScript Lambda packages. All bundle via esbuild to a single CJS file and are zipped by Terraform's `archive_file` data source. The Discord interaction path (`interactions` + `followup`) is described below; `update-dns` and `watchdog` are ports of the original `update_dns.py` / `watchdog.py` — same behaviour, TypeScript runtime.

There is **no persistent ECS Service**. Servers run only when the user clicks Start (or invokes `/server-start`) — the app/followup-Lambda calls `ecs.run_task()` / `ecs.stop_task()` against per-game task definitions named `{game}-server`. This is the core cost-saving design choice; don't introduce a long-running Service.

### The `game_servers` map is the single source of truth

`variables.tf:game_servers` is a `map(object({...}))`. Adding/removing an entry cascades through **every** Terraform resource via `for_each`:

- `aws_ecs_task_definition.game` — one task def per game
- `aws_efs_access_point.game` — isolated save directory per game
- `aws_cloudwatch_log_group.game` — `/ecs/{game}-server`
- `aws_security_group.game_servers` — dynamic ingress rules flattened from all games' ports (deduplicated in `locals.all_game_ports`)
- Lambda env vars `GAME_NAMES` in `route53.tf` and `watchdog.tf`

When adding a game, only edit `terraform.tfvars`. Don't hand-write new resources.

### DNS is Lambda-managed, not Terraform-managed

`route53.tf` creates the zone data source and the updater Lambda, but **no `aws_route53_record` resources**. An EventBridge rule on `ECS Task State Change` fires `@gsd/lambda-update-dns`, which UPSERTs a record for `{game}.{hosted_zone_name}` on `RUNNING` and DELETEs on `STOPPED`. Terraform would fight the Lambda — keep DNS records out of Terraform.

### Watchdog state lives in ECS task tags

`@gsd/lambda-watchdog` runs on an EventBridge schedule (`rate(${watchdog_interval_minutes} minutes)`) and checks `NetworkPacketsIn` on each task's ENI via CloudWatch. The consecutive-idle counter is **stored as a tag on the ECS task itself** — there's no DynamoDB/SSM for watchdog state. After `watchdog_idle_checks` consecutive idle intervals, the task is stopped (which triggers the DNS-delete path above).

### App → Terraform coupling

`ConfigService.getTfOutputs()` (in `app/packages/server/src/services/ConfigService.ts`) parses `terraform.tfstate` as JSON and caches it in-memory. `invalidateCache()` is called on `/api/games` and `/api/status` to pick up new deploys. The app's container mounts `./terraform:/app/terraform:ro` — this path coupling matters if directory structure changes. The parsed `TfOutputs` shape now also exposes `discord_table_name`, `discord_bot_token_secret_arn`, `discord_public_key_secret_arn`, and `interactions_invoke_url` so `DiscordConfigService` can reach the Discord stores without extra env-var plumbing.

**Build-time state embedding**: `app/scripts/embed-tfstate.mjs` (runs via `predev`/`prebuild` hooks) writes `app/packages/server/src/generated/tfstate.ts`; `ConfigService` uses it as a fallback when the runtime `terraform.tfstate` is absent (Docker/CI). The file is committed as `null` and overwritten at dev/build time.

### API authentication

Every `/api/*` route is gated behind a bearer token via `ApiTokenGuard` in `app/packages/server/src/guards/api-token.guard.ts`, registered globally in `AppModule` as an `APP_GUARD` provider so it applies to every controller automatically. The token comes from env `API_TOKEN` (wins, even when set to empty to deliberately disable) or `api_token` in `server_config.json`. In production (`NODE_ENV=production`), boot aborts in `main.ts` if no token is configured. In dev, a warning is logged and unauthenticated requests are allowed for convenience. The web client stores the token in `localStorage` under key `apiToken` and sends it as `Authorization: Bearer`. Don't remove the guard or bypass it on individual controllers — Copilot flagged the unauthenticated surface as a security issue and this is the fix.

### Discord bot is fully serverless (Lambda + DynamoDB + Secrets Manager)

There is **no discord.js dependency, no long-running bot process, and no `DiscordBotService`**. The bot is split across two Lambdas provisioned by Terraform (`interactions.tf`, `followup.tf`):

- **`@gsd/lambda-interactions`** — verifies Ed25519 signature, PONGs pings, handles autocomplete synchronously, and defers slash commands to `@gsd/lambda-followup` (Discord's 3-second budget doesn't leave room for ECS calls).
- **`@gsd/lambda-followup`** — does the ECS work (`RunTask` / `StopTask` / `DescribeTasks`) and PATCHes the original interaction message. For start commands it writes a pending-interaction row to DynamoDB so `@gsd/lambda-update-dns` can patch again with the resolved IP once the task reaches RUNNING.

Persistent state: DynamoDB table `${project_name}-discord` (Discord config + pending-interaction rows with 15-min TTL) and two Secrets Manager secrets (`${project_name}/discord/bot-token`, `${project_name}/discord/public-key`).

Key design rules to preserve:

- **Per-guild command registration only.** `DiscordCommandRegistrar.registerForGuild()` PUTs to `https://discord.com/api/v10/applications/{client_id}/guilds/{guild_id}/commands`. Never register global commands — they'd leak to any guild the bot is invited to.
- **The allowlist is enforced in the interactions Lambda.** It reads the `DiscordConfig` from DynamoDB on every invocation and rejects any command from a guild not in `allowedGuilds`. There's no always-on process to iterate `guilds.cache` — but there doesn't need to be, because Discord only routes interactions to us; we don't maintain a gateway connection.
- **Permission resolution is in `canRun()` (in `@gsd/shared/canRun`).** Order is guild allowlist → admin user/role → per-game user/role + action gate. This function is pure and is imported verbatim by both the server and the Lambdas — keep it in `@gsd/shared` so there's exactly one copy.
- **Neither secret is ever sent to the client.** `getRedacted()` returns `botTokenSet: boolean` and `publicKeySet: boolean` instead of the values. API response shapes preserve this.

#### Slash commands are JSON descriptors, not classes

The four commands — `/server-start`, `/server-stop`, `/server-status`, `/server-list` — are defined as static JSON in `@gsd/shared/commands.ts` (`COMMAND_DESCRIPTORS`). Discord sends the command name in each interaction; the interactions Lambda switches on it directly. There's no `SlashCommand` / `GameOptionSlashCommand` / `SlashCommandRegistry` abstraction anymore — the dispatch is a ~40-line switch in `handler.ts`. To add a new command:

1. Append a descriptor to `COMMAND_DESCRIPTORS` in `@gsd/shared/commands.ts`.
2. Add a `case` in the interactions Lambda's `handleApplicationCommand()` (kicking off a followup invoke) and in the followup Lambda's `handler()` switch on `event.kind`.
3. Update `actionForCommand()` in the same `commands.ts` so `canRun()` gets the right permission bucket.
4. Rebuild Lambdas + `terraform apply` to redeploy; operators click "Register commands" per guild so Discord picks up the new descriptor.

### Known Lambda env-var quirk

Lambda env vars named `AWS_REGION` are reserved by the runtime. All four Lambdas use `AWS_REGION_` (trailing underscore) to pass the configured region — preserve this when editing.

## AWS IAM Policy

The full deploy IAM policy (`GameServerDeployAll`) lives in **`docs/setup.md`** — that is the single source of truth. Any time a new AWS service or action is needed (e.g. a new Terraform resource), update the policy JSON there and nowhere else. The policy already covers EventBridge tagging (`events:*`) and CloudFront (`cloudfront:*`), both of which are required by `terraform apply` and are not included in the AWS-managed policies used in this setup.

## Checklist for Terraform variable changes

Any time you add or remove Terraform variables, update **all four** of these in the same commit — failing to touch any one of them is a common oversight:

1. `terraform/variables.tf` — the variable declaration itself.
2. `terraform/terraform.tfvars.example` — a commented-out example entry with a short explanation so operators know how to use it.
3. `docs/docs/components/terraform.md` — the Variables table row.
4. `docs/docs/setup.md` — any relevant step in the setup guide (especially if the variable affects the Discord bot or a core workflow).

## Code & Test Conventions

- **Test names**: every `it(...)` case must read as a natural-language sentence starting with "should" — e.g. `it('should return null when state file is missing')`, not `it('returns null...')`.
- **TSDoc comments**: document non-trivial functions, helpers, and notable constants/variables with TSDoc (`/** ... */`) so their intent is clear later. This applies to test-file helpers (stub factories, fixtures) as well as production code.
- **Typing in tests**: avoid `as unknown as SomeType` casts. Prefer `vi.mocked(fn)` for mocked modules and `Partial<T>` + a single `as T` for service-shaped stubs.
- **No raw `process.env` in business logic**: wrap environment access behind a service method so tests can stub it via `vi.spyOn` instead of mutating `process.env` (which is flaky and leaks across tests).

## Git & Branch Workflow

`main` is a protected branch — direct pushes are blocked. All changes go through a PR, including trivial chores (`.gitignore` entries, config tweaks). Never commit directly to `main`.

Use `.worktrees/<branch-name>` for feature work (the directory is gitignored). Create with:

```bash
git worktree add .worktrees/<branch> -b <branch>
```

## PR Conventions

- **Always use `/pr` to create pull requests.** The `.claude/commands/pr.md` skill validates the title format before calling the API. Never call `mcp__github__create_pull_request` directly without running this check first.
- **PR titles MUST use Conventional Commits.** We squash-merge, so the PR title becomes the commit subject on `main` verbatim — a badly-formed title produces a badly-formed commit that can't be fixed after merge. Format: `<type>(<optional-scope>): <imperative summary>`, where `<type>` is one of `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`, `style`. Keep the subject under ~70 characters; put details in the PR body. Examples: `refactor(app): migrate server from Express+tsyringe to Nest.js`, `docs: reflect Nest.js migration in CLAUDE.md`, `fix(watchdog): stop leaking tags on failed runs`, `chore: add ESLint flat config`.
- **Pre-flight check (mandatory):** before any `create_pull_request` call, verify the title matches `^(feat|fix|refactor|docs|test|chore|perf|build|ci|style)(\([^)]+\))?: .+$`. If it doesn't, fix it first. `Add ESLint configuration` fails (no type prefix); `chore: add ESLint configuration` passes.
- **Always include `Closes #N`** in the PR body when the PR resolves a GitHub issue. Place it as the first line so GitHub auto-closes the issue on merge.

## PR Review Workflow

Copilot runs automatically on every push. Most suggestions are not actionable — expect to apply ~1 in 3.

- **Fix** if: genuinely buggy, insecure, crashes, or incorrect logic.
- **Decline** if: style, naming, "consider", missing non-essential comment, minor nit — one-line reply ("Declined — stylistic, leaving as-is.") then resolve the thread.
- **Ask** (`AskUserQuestion`) if: ambiguous or architecturally significant. Don't silently dismiss.
- **Stop pushing** when the round is all nitpicks — the PR is ready. Reply to each thread and move on.

Always reply on the thread (fix applied + SHA, or reason for decline) and resolve it with `mcp__github__resolve_review_thread`. Copilot's system behaviour is tuned via `.github/copilot-instructions.md` — keep that file and this section in sync.
