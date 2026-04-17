/**
 * Persistence + permission-resolution service for the Discord bot.
 *
 * Responsibilities:
 * - Load/save `app/discord_config.json` (bot credentials, guild allowlist,
 *   admins, per-game permissions).
 * - Resolve whether a specific Discord user is allowed to run a specific
 *   action on a specific game, via {@link DiscordConfigService.canRun}.
 *
 * The bot token is write-only from the client's perspective: it's stored in
 * the JSON file but never returned in API responses — {@link DiscordConfigService.getRedacted}
 * exposes `botTokenSet: boolean` instead. The env var `DISCORD_BOT_TOKEN`
 * overrides the file value at read time (see {@link DiscordConfigService.getEffectiveToken}).
 */
import { injectable } from 'tsyringe';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger.js';

/**
 * On-disk location of the persisted Discord config (gitignored).
 *
 * Resolved from `process.cwd()` rather than a relative walk from
 * `import.meta.url` so the same code path works in both:
 *  - Dev: `cd app && npm run dev` → cwd is `<repo>/app`, file is `<repo>/app/discord_config.json`.
 *  - Docker: `WORKDIR /app`, `npm start` → cwd is `/app`, file is `/app/discord_config.json`.
 *
 * Override via `DISCORD_CONFIG_PATH` for tests or custom deployments.
 */
const CONFIG_PATH = process.env['DISCORD_CONFIG_PATH'] ?? join(process.cwd(), 'discord_config.json');

/** Slash-command action that can be gated via permissions. */
export type DiscordAction = 'start' | 'stop' | 'status';

/**
 * Permission entry for a single game: which users/roles may invoke which
 * actions. All three lists are independent — having a user ID listed doesn't
 * grant anything unless the corresponding action is also in `actions`.
 */
export interface DiscordGamePermission {
  userIds: string[];
  roleIds: string[];
  actions: DiscordAction[];
}

/** Server-wide admin lists. Admins bypass per-game permission checks. */
export interface DiscordAdmins {
  userIds: string[];
  roleIds: string[];
}

/** Full shape of the on-disk Discord config. Includes the bot token. */
export interface DiscordConfig {
  botToken: string;
  clientId: string;
  allowedGuilds: string[];
  admins: DiscordAdmins;
  gamePermissions: Record<string, DiscordGamePermission>;
}

/** Config shape returned to the web client — bot token is stripped and replaced with a boolean flag. */
export type RedactedDiscordConfig = Omit<DiscordConfig, 'botToken'> & {
  botTokenSet: boolean;
};

/**
 * Keys that would pollute `Object.prototype` or otherwise clash with built-in
 * properties when used as a plain-object index. Caller-supplied game names are
 * rejected if they match so `cfg.gamePermissions[game] = ...` is safe.
 */
const UNSAFE_GAME_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Guard against prototype pollution when using a caller-supplied string as an object key. */
function isSafeGameKey(game: string): boolean {
  return typeof game === 'string' && game.length > 0 && !UNSAFE_GAME_KEYS.has(game);
}

/** Return `v` only if it's a string; anything else (including null/number/object) becomes `undefined`. */
function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Return a string[] built from only the string entries of `v`; non-arrays and non-string entries are dropped. */
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Coerce a disk-loaded game permission object into a well-typed one; unknown fields / bad types are dropped. */
function sanitizeGamePermission(v: unknown): DiscordGamePermission {
  const obj = (v ?? {}) as Record<string, unknown>;
  return {
    userIds: asStringArray(obj['userIds']),
    roleIds: asStringArray(obj['roleIds']),
    actions: asStringArray(obj['actions']).filter(
      (a): a is DiscordAction => a === 'start' || a === 'stop' || a === 'status',
    ),
  };
}

const EMPTY_CONFIG: DiscordConfig = {
  botToken: '',
  clientId: '',
  allowedGuilds: [],
  admins: { userIds: [], roleIds: [] },
  gamePermissions: {},
};

@injectable()
export class DiscordConfigService {
  /** Parsed config cached in-memory; refreshed on every `save()` after the new value is written to disk. */
  private cache: DiscordConfig | null = null;

  /**
   * Read the config from disk (or return an empty one) and populate the in-memory cache.
   *
   * Each field is runtime-validated against its expected type and silently
   * replaced with an empty default when the on-disk JSON has the wrong shape.
   * This guards against hand-edited or corrupted config files crashing the
   * bot when a non-string ends up where `discord.js` expects a token or ID.
   */
  private load(): DiscordConfig {
    if (this.cache) return this.cache;
    if (!existsSync(CONFIG_PATH)) {
      this.cache = { ...EMPTY_CONFIG, admins: { userIds: [], roleIds: [] }, gamePermissions: {} };
      return this.cache;
    }
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
      const rawAdmins = (raw['admins'] ?? {}) as Record<string, unknown>;
      const rawGamePerms = (raw['gamePermissions'] ?? {}) as Record<string, unknown>;
      const gamePermissions: Record<string, DiscordGamePermission> = {};
      for (const [game, perm] of Object.entries(rawGamePerms)) {
        if (isSafeGameKey(game)) gamePermissions[game] = sanitizeGamePermission(perm);
      }
      this.cache = {
        botToken: asString(raw['botToken']) ?? '',
        clientId: asString(raw['clientId']) ?? '',
        allowedGuilds: asStringArray(raw['allowedGuilds']),
        admins: {
          userIds: asStringArray(rawAdmins['userIds']),
          roleIds: asStringArray(rawAdmins['roleIds']),
        },
        gamePermissions,
      };
      return this.cache;
    } catch (err) {
      logger.error('Failed to parse discord_config.json', { err });
      this.cache = { ...EMPTY_CONFIG, admins: { userIds: [], roleIds: [] }, gamePermissions: {} };
      return this.cache;
    }
  }

  /** Write the config to disk and refresh the in-memory cache with the new value. */
  private save(cfg: DiscordConfig): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    this.cache = cfg;
    logger.info('Discord config saved', {
      allowedGuilds: cfg.allowedGuilds.length,
      games: Object.keys(cfg.gamePermissions).length,
    });
  }

  /** Full (unredacted) config — only call this server-side; never return it to the client. */
  getConfig(): DiscordConfig {
    return this.load();
  }

  /** Read the bot token override from the environment. Extracted for test-stubbing. */
  readEnvBotToken(): string | undefined {
    return process.env['DISCORD_BOT_TOKEN'];
  }

  /**
   * The token `discord.js` should log in with. Env var `DISCORD_BOT_TOKEN`
   * always wins when set (including to an empty string — useful to intentionally
   * disable the bot from a deployment without editing the config file).
   */
  getEffectiveToken(): string {
    return this.readEnvBotToken() ?? this.load().botToken;
  }

  /** Config shape safe to return over the wire — bot token is stripped. */
  getRedacted(): RedactedDiscordConfig {
    const cfg = this.load();
    return {
      clientId: cfg.clientId,
      allowedGuilds: cfg.allowedGuilds,
      admins: cfg.admins,
      gamePermissions: cfg.gamePermissions,
      botTokenSet: Boolean(this.getEffectiveToken()),
    };
  }

  /**
   * Update bot credentials; either field can be omitted to leave it untouched.
   *
   * Runtime-validates that any provided field is a string. Non-string values
   * are rejected rather than written — returning `false` lets the route surface
   * a 400 instead of quietly persisting garbage that would later break
   * `client.login` or slash-command registration. TypeScript already narrows
   * external input to `string | undefined` at the compile boundary, but the
   * check also catches cases where untyped JSON made it past a cast.
   *
   * @returns `true` on success, `false` if either provided field wasn't a string.
   */
  setCredentials(params: { botToken?: unknown; clientId?: unknown }): boolean {
    if (params.botToken !== undefined && typeof params.botToken !== 'string') return false;
    if (params.clientId !== undefined && typeof params.clientId !== 'string') return false;
    const cfg = this.load();
    if (typeof params.botToken === 'string') cfg.botToken = params.botToken;
    if (typeof params.clientId === 'string') cfg.clientId = params.clientId;
    this.save(cfg);
    return true;
  }

  /** Replace the entire guild allowlist (deduped, empty strings dropped). */
  setAllowedGuilds(guildIds: string[]): void {
    const cfg = this.load();
    cfg.allowedGuilds = [...new Set(guildIds.filter(Boolean))];
    this.save(cfg);
  }

  /** Add a guild to the allowlist if not already present; otherwise no-op. */
  addAllowedGuild(guildId: string): void {
    const cfg = this.load();
    if (!cfg.allowedGuilds.includes(guildId)) {
      cfg.allowedGuilds.push(guildId);
      this.save(cfg);
    }
  }

  /** Remove a guild from the allowlist; no-op if it wasn't there. */
  removeAllowedGuild(guildId: string): void {
    const cfg = this.load();
    cfg.allowedGuilds = cfg.allowedGuilds.filter((g) => g !== guildId);
    this.save(cfg);
  }

  /**
   * Replace the server-wide admin user/role lists (deduped, empty strings
   * dropped, non-string entries discarded). Accepts `unknown` shapes defensively
   * so a malformed API body (e.g. `userIds: "..."`) can't crash the handler.
   */
  setAdmins(admins: { userIds?: unknown; roleIds?: unknown }): void {
    const cfg = this.load();
    cfg.admins = {
      userIds: [...new Set(asStringArray(admins.userIds).filter(Boolean))],
      roleIds: [...new Set(asStringArray(admins.roleIds).filter(Boolean))],
    };
    this.save(cfg);
  }

  /**
   * Overwrite the permission entry for a single game. Unknown actions are
   * dropped silently. Rejects dangerous prototype keys (`__proto__`,
   * `constructor`, `prototype`) to avoid prototype pollution since `game` is
   * caller-supplied. Field types are sanitized (non-arrays become empty,
   * non-string entries are dropped) so a malformed request body can't 500
   * the handler — the caller gets a successful no-op instead, which matches
   * how `load()` sanitizes data coming back off disk.
   *
   * @returns `true` if the permission was written; `false` if the `game` key
   *   was rejected (caller should surface this as a 4xx so the API client
   *   doesn't think the update succeeded).
   */
  setGamePermission(
    game: string,
    perm: { userIds?: unknown; roleIds?: unknown; actions?: unknown },
  ): boolean {
    if (!isSafeGameKey(game)) {
      logger.warn('Rejected setGamePermission with unsafe key', { game });
      return false;
    }
    const cfg = this.load();
    cfg.gamePermissions[game] = {
      userIds: [...new Set(asStringArray(perm.userIds).filter(Boolean))],
      roleIds: [...new Set(asStringArray(perm.roleIds).filter(Boolean))],
      actions: [
        ...new Set(
          asStringArray(perm.actions).filter(
            (a): a is DiscordAction => a === 'start' || a === 'stop' || a === 'status',
          ),
        ),
      ],
    };
    this.save(cfg);
    return true;
  }

  /**
   * Remove the permission entry for a game so no non-admin can run commands on it.
   *
   * @returns `true` if a delete was performed; `false` if the `game` key was
   *   rejected for safety reasons.
   */
  deleteGamePermission(game: string): boolean {
    if (!isSafeGameKey(game)) {
      logger.warn('Rejected deleteGamePermission with unsafe key', { game });
      return false;
    }
    const cfg = this.load();
    delete cfg.gamePermissions[game];
    this.save(cfg);
    return true;
  }

  /**
   * Resolve whether a user with given role IDs is allowed to run `action` on
   * `game` in `guildId`. Evaluation order is:
   *
   * 1. **Guild allowlist** — unknown guild → deny.
   * 2. **Admin user/role** — listed in `admins` → allow any action on any game.
   * 3. **Per-game entry** — user ID or one of their roles matches *and* the
   *    requested action is in that entry's `actions` → allow.
   * 4. Otherwise → deny.
   */
  canRun(params: {
    guildId: string;
    userId: string;
    roleIds: string[];
    game: string;
    action: DiscordAction;
  }): boolean {
    const cfg = this.load();
    if (!cfg.allowedGuilds.includes(params.guildId)) return false;
    if (cfg.admins.userIds.includes(params.userId)) return true;
    if (cfg.admins.roleIds.some((r) => params.roleIds.includes(r))) return true;
    const perm = cfg.gamePermissions[params.game];
    if (!perm) return false;
    if (!perm.actions.includes(params.action)) return false;
    if (perm.userIds.includes(params.userId)) return true;
    if (perm.roleIds.some((r) => params.roleIds.includes(r))) return true;
    return false;
  }
}
