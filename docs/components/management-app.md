---
title: Management app
parent: Components
nav_order: 2
---

# Management app

A TypeScript npm-workspaces monorepo under `app/`. Three packages are shipped
as the local control plane — a Nest.js API, a React dashboard, and a pure
library — plus the four Lambda packages documented
[here]({{ '/components/lambdas/' | relative_url }}).

Install everything from the root:

```bash
cd app && npm install
```

Dev mode runs the Nest API on **:3001** and the Vite dev server on
**:5173** (with `/api` proxied). Production is a single Node process on
**:3001**; inside Docker that's published as **:5000**.

## `@gsd/shared`

`app/packages/shared` — zero-runtime-dependency TypeScript consumed by the
server **and** all four Lambdas. The canonical location for cross-boundary
types and permission logic.

| Module | Purpose |
|---|---|
| `types.ts` | `DiscordAction`, `DiscordConfig`, `RedactedDiscordConfig`, `GameStatus`, `StartResult`, `PendingInteraction`. The API shapes every other package agrees on. |
| `canRun.ts` | The pure permission-check function. Order: **guild allowlist → admin user/role → per-game user/role + action**. Imported verbatim by the Nest server and both Discord Lambdas. |
| `commands.ts` | `COMMAND_DESCRIPTORS` — static JSON for the four slash commands. `actionForCommand(name)` maps to the `start`/`stop`/`status` bucket used by `canRun()`. |
| `sanitize.ts` | `isSafeGameKey()` (blocks `__proto__`, `constructor`, `prototype`), `asString()`, `asStringArray()`, `sanitizeGamePermission()`. Applied on DDB reads where input is operator-provided. |
| `formatStatus.ts` | `formatGameStatus(status)` — Discord-ready one-liner with emoji and hostname. |
| `ddb/client.ts` | Lazy DynamoDB DocumentClient. Region fallback: `AWS_REGION_` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`. |
| `ddb/configStore.ts` | `getDiscordConfig()` / `putDiscordConfig()` for the `CONFIG#discord` row. |
| `ddb/pendingStore.ts` | `getPending()` / `putPending()` / `deletePending()` for `PENDING#{taskArn}`. `putPending()` sets `expiresAt = now + 15 minutes` so DDB TTL reaps stale rows. |
| `secrets/secretsStore.ts` | Secrets Manager wrapper with a 5-minute in-process cache. Recognises Terraform's `"placeholder"` seed as "not configured". `invalidateSecretsCache()` is called by the Nest credentials endpoint. |

**Invariants**: `canRun()` lives in exactly one place; the four slash
commands are JSON descriptors, not classes; secrets' raw values never
leave this package's own callers.

## `@gsd/server`

`app/packages/server` — Nest.js on `@nestjs/platform-express`. The boot
sequence in `src/main.ts`:

1. `NestFactory.create(AppModule)`.
2. If `NODE_ENV=production` and no `API_TOKEN` configured → **refuses to
   start** (loud exit, not a warning).
3. In production, serves the built React bundle from `../web/dist` as
   static files.
4. Listens on `process.env.PORT || 3001`.

### Module graph

- **`AppModule`** — root. Imports `AwsModule` and `DiscordModule`. Installs
  `ApiTokenGuard` as `APP_GUARD` (so it applies to every controller), and
  attaches `RequestLoggerMiddleware` for structured access logs.
- **`AwsModule`** — provides `ConfigService`, `Ec2Service`, `EcsService`,
  `LogsService`, `CostService`, `FileManagerService`. All exported.
- **`DiscordModule`** — imports `AwsModule`; provides
  `DiscordConfigService` and `DiscordCommandRegistrar`. No discord.js,
  no gateway — the bot is two Lambdas plus Discord's REST API.

### Controllers and endpoints

Every route is under `/api/*` and gated by `ApiTokenGuard`.

| Controller | Endpoints | Purpose |
|---|---|---|
| `GamesController` | `GET /api/games`, `GET /api/status`, `GET /api/status/:game`, `POST /api/start/:game`, `POST /api/stop/:game` | List/read status, trigger RunTask/StopTask. Invalidates ConfigService's tfstate cache on list/status reads so fresh applies are picked up without restarting. |
| `ConfigController` | `GET /api/config`, `POST /api/config` | Read/write watchdog knobs in `server_config.json`. Takes effect on next `terraform apply` (the values are baked into Lambda env). |
| `CostsController` | `GET /api/costs/estimate`, `GET /api/costs/actual?days=N` | Per-game Fargate estimates; Cost Explorer actuals grouped by the `Project` tag. |
| `LogsController` | `GET /api/logs/:game?limit=50` | Last N log events from `/ecs/{game}-server` on the most recent task. |
| `FilesController` | `GET /api/files/:game`, `POST /api/files/:game/start`, `POST /api/files/:game/stop` | Ad-hoc FileBrowser task against the game's EFS access point. |
| `DiscordController` | `GET/PUT /api/discord/config`, `POST /api/discord/guilds`, `DELETE /api/discord/guilds/:id`, `POST /api/discord/guilds/:id/register-commands`, `PUT /api/discord/admins`, `PUT /api/discord/permissions/:game`, `DELETE /api/discord/permissions/:game` | Read-redacted config, save credentials, manage guild allowlist + commands, admins, per-game permissions. |

### Key services

- **`ConfigService`** — single place that parses `terraform.tfstate` into a
  `TfOutputs` object (cluster ARN, subnets, SGs, EFS access points, game
  names, hosted zone, Discord table + secret ARNs, interactions URL).
  Caches in-memory; `invalidateCache()` is called by the games controller
  on list/status so a new `terraform apply` is picked up without a server
  restart. Also resolves the bearer token from `API_TOKEN` (wins) or
  `server_config.json:api_token`. Returns `null` from `getTfOutputs()` if
  tfstate is missing/unparseable — callers degrade gracefully so the
  dashboard can render even pre-apply.
- **`DiscordConfigService`** — persistence facade over DynamoDB
  (`CONFIG#discord`) + Secrets Manager. Concurrent reads are coalesced via
  an inflight-promise pattern. `getRedacted()` returns
  `botTokenSet` / `publicKeySet` booleans only.
  `getEffectiveToken()` is the single escape hatch — used only by the
  command registrar.
- **`DiscordCommandRegistrar`** — calls
  `PUT https://discord.com/api/v10/applications/{clientId}/guilds/{guildId}/commands`.
  Validates `guildId` as a 17–20-digit Discord snowflake before calling out
  (no path traversal, no SSRF).
- **`EcsService` / `Ec2Service` / `LogsService` / `CostService` /
  `FileManagerService`** — thin wrappers over the AWS SDK v3 clients.

### Auth

`ApiTokenGuard` (`src/guards/api-token.guard.ts`) is installed as
`APP_GUARD` in `AppModule`. On every request it:

- Reads the configured token from `ConfigService` (not cached — rotation
  takes effect immediately).
- Matches `Authorization: Bearer <token>` exactly.
- In dev mode, if no token is configured: logs once and allows the
  request.
- In production, boot is refused if no token is configured, so the
  "allow unauthenticated" branch is unreachable there.

### Logging

Winston in `src/logger.ts`. Dev: colourised timestamps + JSON metadata.
Prod: JSON lines with ISO timestamps. Use `logger.info` / `warn` / `error`
everywhere, not `console.log`.

### Env vars

| Name | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` enforces the token-at-boot check. |
| `API_TOKEN` | — | Bearer token; wins over `server_config.json:api_token`. |
| `PORT` | `3001` | HTTP listen port. |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | — | SDK region. Fallback via `ConfigService`. |

## `@gsd/web`

`app/packages/web` — React + Vite.

- **Entry**: `src/main.tsx` → `src/App.tsx`. The app wires a 401 handler
  (`setUnauthorizedHandler` in `api.ts`) that clears the stored token and
  shows the token-prompt modal whenever any request comes back 401.
- **Auth**: bearer token in `localStorage` under key `apiToken`, attached
  as `Authorization: Bearer` by `request<T>()` in `src/api.ts`.

### Dashboard layout

1. **Game cards** — per-game Start/Stop, state badge, IP/hostname. Polls
   `/api/status` and `/api/costs/estimate` every 20 s via
   `hooks/useGameStatus`.
2. **Cost panel** — hourly/daily/4h-per-day estimates + last-7-days actual
   from Cost Explorer (requires the `Project` cost-allocation tag to be
   activated in AWS Billing).
3. **Server Config** — watchdog knobs. Saves go to `server_config.json`;
   take effect on next `terraform apply`.
4. **Discord Bot** — four tabs: Credentials, Guilds, Admins, Per-Game
   Permissions. See the [user guide]({{ '/guides/user/' | relative_url }})
   for the day-to-day workflow.
5. **Live Logs** — tails the last N events from
   `/ecs/{game}-server` for the most recent task.
6. **File Manager modal** — spawns a FileBrowser Fargate task against the
   game's EFS access point so you can inspect/upload saves without
   starting the game itself.

### API layer

`src/api.ts` exports a single `api` object with one method per endpoint.
All calls go through `request<T>()`, which:

- Attaches the bearer header.
- Converts non-2xx responses to thrown errors.
- On 401, clears the stored token and invokes the handler registered at
  startup (shows the token prompt).

### Vite dev config

`vite.config.ts` serves on `:5173` and proxies `/api` to
`http://localhost:3001`. Production builds to `dist/` which the Nest server
serves as static files at `/`.

## Docker

`Dockerfile` is node:20-slim:

1. Copy `package.json` + workspace manifests, `npm ci --ignore-scripts`.
2. Copy source, `npm run build` (shared → server → web).
3. `CMD ["node", "packages/server/dist/main.js"]`.

Only the **server** and **web** packages are baked into the image — the
four Lambda packages are deployed separately via `terraform apply` and have
no place inside the container.

`docker-compose.yml` mounts `./terraform` read-only (for tfstate),
`./app/server_config.json` (must exist on the host first), and `~/.aws`
read-only (credentials). Publishes `3001` as `5000`. Requires `API_TOKEN`
to be set in the shell before `docker compose up` (the compose file uses
`${API_TOKEN:?…}` so it fails fast with a clear error if missing).
