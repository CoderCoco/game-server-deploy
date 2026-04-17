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
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** On-disk location of the persisted Discord config (gitignored). */
const CONFIG_PATH = join(__dirname, '../../../../../app/discord_config.json');

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

const EMPTY_CONFIG: DiscordConfig = {
  botToken: '',
  clientId: '',
  allowedGuilds: [],
  admins: { userIds: [], roleIds: [] },
  gamePermissions: {},
};

@injectable()
export class DiscordConfigService {
  /** Parsed config cached in-memory; cleared on every `save()` so writes are atomic. */
  private cache: DiscordConfig | null = null;

  /** Read the config from disk (or return an empty one) and populate the in-memory cache. */
  private load(): DiscordConfig {
    if (this.cache) return this.cache;
    if (!existsSync(CONFIG_PATH)) {
      this.cache = { ...EMPTY_CONFIG, admins: { userIds: [], roleIds: [] }, gamePermissions: {} };
      return this.cache;
    }
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<DiscordConfig>;
      this.cache = {
        botToken: raw.botToken ?? '',
        clientId: raw.clientId ?? '',
        allowedGuilds: raw.allowedGuilds ?? [],
        admins: {
          userIds: raw.admins?.userIds ?? [],
          roleIds: raw.admins?.roleIds ?? [],
        },
        gamePermissions: raw.gamePermissions ?? {},
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

  /**
   * The token `discord.js` should log in with. Env var `DISCORD_BOT_TOKEN`
   * always wins when set (including to an empty string — useful to intentionally
   * disable the bot from a deployment without editing the config file).
   */
  getEffectiveToken(): string {
    return process.env['DISCORD_BOT_TOKEN'] ?? this.load().botToken;
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

  /** Update bot credentials; either field can be omitted to leave it untouched. */
  setCredentials(params: { botToken?: string; clientId?: string }): void {
    const cfg = this.load();
    if (params.botToken !== undefined) cfg.botToken = params.botToken;
    if (params.clientId !== undefined) cfg.clientId = params.clientId;
    this.save(cfg);
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

  /** Replace the server-wide admin user/role lists (deduped, empty strings dropped). */
  setAdmins(admins: DiscordAdmins): void {
    const cfg = this.load();
    cfg.admins = {
      userIds: [...new Set((admins.userIds ?? []).filter(Boolean))],
      roleIds: [...new Set((admins.roleIds ?? []).filter(Boolean))],
    };
    this.save(cfg);
  }

  /**
   * Overwrite the permission entry for a single game. Unknown actions are
   * dropped silently. Rejects dangerous prototype keys (`__proto__`,
   * `constructor`, `prototype`) to avoid prototype pollution since `game` is
   * caller-supplied.
   */
  setGamePermission(game: string, perm: DiscordGamePermission): void {
    if (!isSafeGameKey(game)) {
      logger.warn('Rejected setGamePermission with unsafe key', { game });
      return;
    }
    const cfg = this.load();
    cfg.gamePermissions[game] = {
      userIds: [...new Set((perm.userIds ?? []).filter(Boolean))],
      roleIds: [...new Set((perm.roleIds ?? []).filter(Boolean))],
      actions: [...new Set((perm.actions ?? []).filter((a) => a === 'start' || a === 'stop' || a === 'status'))],
    };
    this.save(cfg);
  }

  /** Remove the permission entry for a game so no non-admin can run commands on it. */
  deleteGamePermission(game: string): void {
    if (!isSafeGameKey(game)) {
      logger.warn('Rejected deleteGamePermission with unsafe key', { game });
      return;
    }
    const cfg = this.load();
    delete cfg.gamePermissions[game];
    this.save(cfg);
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
