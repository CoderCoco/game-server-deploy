# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# First-time environment bootstrap (installs terraform + aws CLI if missing,
# runs npm ci, builds Lambdas, runs terraform init)
./setup.sh

# Unit tests (vitest + aws-sdk-client-mock) — discovered across every workspace
cd app && npm test             # one-off run
cd app && npm run test:watch   # watch mode
```

No linter is configured in this repo.

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

### API authentication

Every `/api/*` route is gated behind a bearer token via `ApiTokenGuard` in `app/packages/server/src/guards/api-token.guard.ts`, registered globally in `AppModule` as an `APP_GUARD` provider so it applies to every controller automatically. The token comes from env `API_TOKEN` (wins, even when set to empty to deliberately disable) or `api_token` in `server_config.json`. In production (`NODE_ENV=production`), boot aborts in `main.ts` if no token is configured. In dev, a warning is logged and unauthenticated requests are allowed for convenience. The web client stores the token in `localStorage` under key `apiToken` and sends it as `Authorization: Bearer`. Don't remove the guard or bypass it on individual controllers — Copilot flagged the unauthenticated surface as a security issue and this is the fix.

### Discord bot is fully serverless (Lambda + DynamoDB + Secrets Manager)

There is **no discord.js dependency, no long-running bot process, and no `DiscordBotService`**. The bot is split across two Lambdas provisioned by Terraform (`interactions.tf`, `followup.tf`):

- **`@gsd/lambda-interactions`** — receives every Discord HTTP interaction at a Lambda Function URL, verifies the Ed25519 signature against the public key in Secrets Manager, and then either: (a) responds `type:1` (PONG) for PINGs, (b) filters the game list env var by `canRun()` for autocomplete, or (c) responds with a deferred ack (`type:5`) and async-invokes `@gsd/lambda-followup` for slash commands. It never calls ECS directly — Discord's 3-second reply budget doesn't leave room.
- **`@gsd/lambda-followup`** — does the slow ECS work (`RunTask` / `StopTask` / `DescribeTasks`), then `PATCH`es the original interaction message via `https://discord.com/api/v10/webhooks/{application_id}/{interaction_token}/messages/@original`. For start commands, it also writes a `PENDING#{taskArn}` row to the DynamoDB table so `@gsd/lambda-update-dns` can PATCH the same interaction again when the task reaches RUNNING with the resolved IP/hostname.

Persistent state:

- **DynamoDB** — single table `${project_name}-discord`, two item types. `pk="CONFIG#discord"` holds the `DiscordConfig` (allowedGuilds, admins, gamePermissions, clientId). `pk="PENDING#{taskArn}"` holds pending-interaction rows with a 15-minute TTL on `expiresAt` (Discord interaction tokens expire after 15 min).
- **Secrets Manager** — two secrets: `${project_name}/discord/bot-token` and `${project_name}/discord/public-key`. The Nest app writes both via `PUT /api/discord/config` (needs `secretsmanager:PutSecretValue`); the interactions Lambda reads the public key; nothing else touches them. The Nest server additionally reads the bot token when the operator clicks "Register commands" in the UI (see `DiscordCommandRegistrar`).

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

#### Autocomplete

The interactions Lambda handles autocomplete synchronously within the 3-second budget: it reads the game list from the `GAME_NAMES` env var (baked in at `terraform apply` time), filters by the user's partial input, then filters again by `canRun(game, actionForCommand(name))`. No ECS calls. The env var approach avoids a tfstate read from inside Lambda, which wouldn't have access to the file anyway.

### Known Lambda env-var quirk

Lambda env vars named `AWS_REGION` are reserved by the runtime. All four Lambdas use `AWS_REGION_` (trailing underscore) to pass the configured region — preserve this when editing.

## AWS IAM Requirement Not Covered by Managed Policies

The AWS provider tags EventBridge rules on creation, which requires `events:TagResource` / `UntagResource` / `ListTagsForResource`. These are **not** in any of the managed policies listed in the README. An inline policy granting them must be attached to the deploy user or `terraform apply` will fail. See README "Additional inline policy required".

## Cost Tagging

All resources inherit `default_tags` from `provider "aws"` (`Project = "game-servers-poc"`, `Environment = "poc"`, `ManagedBy = "terraform"`). For Cost Explorer breakdowns, the `Project` cost allocation tag must be activated manually in AWS Billing — this is a one-time console action, not Terraform-managed.

## Code & Test Conventions

- **Test names**: every `it(...)` case must read as a natural-language sentence starting with "should" — e.g. `it('should return null when state file is missing')`, not `it('returns null...')`.
- **TSDoc comments**: document non-trivial functions, helpers, and notable constants/variables with TSDoc (`/** ... */`) so their intent is clear later. This applies to test-file helpers (stub factories, fixtures) as well as production code.
- **Typing in tests**: avoid `as unknown as SomeType` casts. Prefer `vi.mocked(fn)` for mocked modules and `Partial<T>` + a single `as T` for service-shaped stubs.
- **No raw `process.env` in business logic**: wrap environment access behind a service method so tests can stub it via `vi.spyOn` instead of mutating `process.env` (which is flaky and leaks across tests).

## PR Conventions

- **PR titles use Conventional Commits.** Every PR title must start with a conventional-commit type (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`, `style`), optionally with a scope in parentheses, then a colon and a short imperative summary — e.g. `refactor(app): migrate server from Express+tsyringe to Nest.js`, `docs: reflect Nest.js migration in CLAUDE.md`, `fix(watchdog): stop leaking tags on failed runs`. This matters because we squash-merge: the PR title becomes the merge commit subject on `main`, so a badly-formed title produces a badly-formed commit. Keep the subject under ~70 characters; put details in the PR body.

## PR Review Workflow

**Be strict with Copilot review suggestions. Don't enter a fix-and-repush loop.** Copilot runs automatically on every push, so a cycle of "Copilot comments → fix → Copilot comments on the fix → fix again" can go on forever on nitpicks. Most Copilot suggestions on a given PR are **not actionable** — expect to apply maybe one in three, decline the rest on the thread, and keep moving.

**The bar for acting on a Copilot comment:** the code is actually buggy, insecure, broken in production, or clearly wrong. Not "could be clearer", "consider renaming", "add a log line here", "extract a helper", "slight inconsistency with other files", "prefer X over Y". Those get declined with a one-line reply explaining why, and the thread stays unresolved only if you want visibility (resolve it otherwise).

When a Copilot comment lands on a PR:

1. **Evaluate first.** Read the surrounding code and reason about whether the critique describes a real problem and whether the proposed fix actually addresses it. Copilot hallucinates issues and suggests fixes that introduce worse problems. Assume the comment is wrong until you've convinced yourself otherwise.
2. **Triage the category.**
   - *Genuine bug, security issue, crash, or incorrect logic* → fix it.
   - *Style, naming, readability, idiom preference, "consider", "might want to", missing-but-non-essential docstring/log/comment, minor duplication, test-organization nit* → **decline on the thread.** Do not rewrite the code. A short reply like "Declined — stylistic, not a correctness issue; leaving as-is." is enough.
   - *Ambiguous or architecturally significant* → `AskUserQuestion` before acting. Don't silently dismiss.
3. **Apply if correct**, but feel free to deviate from Copilot's exact suggested code when a different fix fits the codebase better (e.g. reuse an existing permission system instead of adding a new one).
4. **Reply on the thread** explaining either the fix applied, why you declined, or that you're checking with the user. Reference the commit SHA when a fix was committed.
5. **Resolve the thread** with `mcp__github__resolve_review_thread` after a fix is committed and the reply is posted, or after you decline a clear nitpick, so the PR's conversation tab shows a clean state. Only leave a thread unresolved when you're waiting on the user or the issue genuinely isn't fixed yet.
6. **Stop when the signal is noise.** If Copilot's latest round is only nitpicks, don't push another commit. Reply to each thread with a brief decline and move on — the PR is ready to merge.

This rule applies to every PR review bot (Copilot or otherwise), but Copilot is the one we see most often. Copilot's system-level behavior is tuned via `.github/copilot-instructions.md` in this repo — keep that file and this section in sync.
