# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

The management app is a TypeScript project (Nest.js API + React/Vite UI) under `app/`. Dependencies are managed with **npm**.

```bash
# Install app deps
cd app && npm install

# Run the dev servers (Nest on 3001, Vite on 5173 with /api proxy)
cd app && npm run dev

# Production build + run
cd app && npm run build && npm start    # http://localhost:3001

# Run the app in Docker (mounts ./terraform ro, ./app/server_config.json, ~/.aws)
docker compose up --build               # http://localhost:5000

# Terraform (all infra lives under terraform/)
cd terraform
terraform init
terraform plan
terraform apply
terraform destroy

# First-time environment bootstrap (installs terraform, aws CLI if missing, runs terraform init)
./setup.sh

# Unit tests (vitest + aws-sdk-client-mock)
cd app && npm test             # one-off run
cd app && npm run test:watch   # watch mode
```

No linter is configured in this repo.

## Architecture

Two loosely-coupled halves communicate via the Terraform state file:

1. **Terraform (`terraform/`)** provisions all AWS infrastructure.
2. **Management app (`app/`)** — Nest.js (on `@nestjs/platform-express`) + TypeScript backend reads `terraform/terraform.tfstate` directly at runtime to discover cluster/subnet/SG IDs, then drives AWS via the AWS SDK v3. React/Vite frontend talks to the Nest API. Services use **Nest's built-in DI** (`@Injectable()`) and **Winston** for structured logging. Feature modules under `app/src/server/modules/` (`AwsModule`, `DiscordModule`) group related providers; HTTP handlers live in `app/src/server/controllers/` as `@Controller`-decorated classes wired up through `AppModule`.

There is **no persistent ECS Service**. Servers run only when the user clicks Start — the app calls `ecs.run_task()` / `ecs.stop_task()` against per-game task definitions named `{game}-server`. This is the core cost-saving design choice; don't introduce a long-running Service.

### The `game_servers` map is the single source of truth

`variables.tf:game_servers` is a `map(object({...}))`. Adding/removing an entry cascades through **every** Terraform resource via `for_each`:

- `aws_ecs_task_definition.game` — one task def per game
- `aws_efs_access_point.game` — isolated save directory per game
- `aws_cloudwatch_log_group.game` — `/ecs/{game}-server`
- `aws_security_group.game_servers` — dynamic ingress rules flattened from all games' ports (deduplicated in `locals.all_game_ports`)
- Lambda env vars `GAME_NAMES` in `route53.tf` and `watchdog.tf`

When adding a game, only edit `terraform.tfvars`. Don't hand-write new resources.

### DNS is Lambda-managed, not Terraform-managed

`route53.tf` creates the zone data source and the updater Lambda, but **no `aws_route53_record` resources**. An EventBridge rule on `ECS Task State Change` fires `lambda/update_dns.py`, which UPSERTs a record for `{game}.{hosted_zone_name}` on `RUNNING` and DELETEs on `STOPPED`. Terraform would fight the Lambda — keep DNS records out of Terraform.

### Watchdog state lives in ECS task tags

`lambda/watchdog.py` runs on an EventBridge schedule (`rate(${watchdog_interval_minutes} minutes)`) and checks `NetworkPacketsIn` on each task's ENI via CloudWatch. The consecutive-idle counter is **stored as a tag on the ECS task itself** — there's no DynamoDB/SSM. After `watchdog_idle_checks` consecutive idle intervals, the task is stopped (which triggers the DNS-delete path above).

### App → Terraform coupling

`ConfigService.getTfOutputs()` (in `app/src/server/services/ConfigService.ts`) parses `terraform.tfstate` as JSON and caches it in-memory. `invalidateTfCache()` is called on `/api/games` and `/api/status` to pick up new deploys. The app's container mounts `./terraform:/app/terraform:ro` — this path coupling matters if directory structure changes.

### API authentication

Every `/api/*` route is gated behind a bearer token via `ApiTokenGuard` in `app/src/server/guards/api-token.guard.ts`, registered globally in `AppModule` as an `APP_GUARD` provider so it applies to every controller automatically. The token comes from env `API_TOKEN` (wins, even when set to empty to deliberately disable) or `api_token` in `server_config.json`. In production (`NODE_ENV=production`), boot aborts in `main.ts` if no token is configured. In dev, a warning is logged and unauthenticated requests are allowed for convenience. The web client stores the token in `localStorage` under key `apiToken` and sends it as `Authorization: Bearer`. Don't remove the guard or bypass it on individual controllers — Copilot flagged the unauthenticated surface as a security issue and this is the fix.

### Discord bot lives inside the management app process

There is no separate bot service — `DiscordBotService` (in `app/src/server/services/DiscordBotService.ts`) holds a single `discord.js` `Client` that is started from `main.ts` after `app.listen()` (only if a token is configured) and reuses `EcsService` for start/stop. Config is persisted to `app/discord_config.json`; `DISCORD_BOT_TOKEN` env var overrides the file value. Don't spin this out into its own container.

Key design rules to preserve:

- **Per-guild command registration only.** `registerCommandsForGuild()` calls `Routes.applicationGuildCommands(clientId, guildId)` for each allowlisted guild. Never register global commands — that would expose them to any guild the bot is invited to.
- **Guild allowlist is enforced at two points.** On `ready` the bot iterates `guilds.cache` and leaves anything not on the list; the `guildCreate` listener does the same for new invites. Both must stay — removing either creates a path for the bot to operate in unauthorized guilds.
- **Permission resolution is in `DiscordConfigService.canRun()`.** Order is guild allowlist → admin user/role → per-game user/role + action gate. Keep this ordering; tests encode it.
- **Token is never sent to the client.** `getRedacted()` returns `botTokenSet: boolean` instead of the token. API response shapes should preserve this.

#### Slash commands are class-based, one file per command

Slash commands live under `app/src/server/discord/commands/` as `@Injectable()` subclasses of the abstract `SlashCommand` (`app/src/server/discord/SlashCommand.ts`). Each class owns its own `name`, `action` (the `DiscordConfigService.canRun()` permission bucket — both forwarded to `super(name, action)` in the subclass constructor), `build()` (the Discord REST descriptor), and `execute(ctx)` / `autocomplete(ctx)`. `DiscordBotService.handleInteraction()` is a thin dispatcher: it enforces guild + allowlist, looks the command up by `commandName` in `SlashCommandRegistry`, and delegates — it does **not** know about specific commands.

- **Adding a new slash command is a two-file change:** (1) write a new `SlashCommand` subclass under `discord/commands/`; (2) register it as a provider in `discord.module.ts` **and** add it to the `SLASH_COMMANDS` factory provider's `inject` list and returned array. Don't add `if (commandName === ...)` branches back to the dispatcher, and don't touch `SlashCommandRegistry.ts` — the registry has no knowledge of concrete commands.
- **`SLASH_COMMANDS` is a factory-provider token, not a multi-provider.** Nest doesn't support Angular-style `multi: true` registration; the idiomatic way to inject "all providers of type `SlashCommand`" as a single array is a `useFactory` + `inject` factory provider, which lives in `discord.module.ts`. The registry consumes it via `@Inject(SLASH_COMMANDS) commands: SlashCommand[]`.

- **`GameOptionSlashCommand`** is the shared base for commands that take a `game` option with autocomplete (start/stop/status). It implements the autocomplete flow once (re-read Terraform state → filter by partial input → filter by `canRun(game, this.action)`) so the three commands stay in sync. List has no autocomplete and extends `SlashCommand` directly.
- **`/server-status` with no game arg delegates to `ServerListCommand`.** `ServerStatusCommand` injects `ServerListCommand` and calls `list.execute(ctx)` for the no-game branch — the multi-game view has one implementation, not two.
- **`CommandInvoker`** (`app/src/server/discord/CommandInvoker.ts`) wraps `(guildId, userId, roleIds)` and exposes `canRun(game, action)`. It's built once per interaction by the dispatcher via `CommandInvoker.from(interaction, discord)`, which does the strongly-typed `GuildMember` vs `APIInteractionGuildMember` discrimination in one place. Commands access caller identity through `ctx.invoker` — they should never touch `interaction.member` directly or re-implement role extraction.

### Known Lambda env-var quirk

Lambda env vars named `AWS_REGION` are reserved by the runtime. Both Lambdas use `AWS_REGION_` (trailing underscore) to pass the configured region — preserve this when editing.

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
