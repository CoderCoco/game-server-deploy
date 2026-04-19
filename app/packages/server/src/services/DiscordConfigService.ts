/**
 * Persistence service for the Discord serverless backend.
 *
 * Responsibilities:
 *  - Read/write the DiscordConfig row in DynamoDB (allowedGuilds, admins,
 *    gamePermissions, clientId).
 *  - Read/write the bot token + Ed25519 public key in AWS Secrets Manager.
 *  - Expose a redacted view of all of the above that's safe to return over
 *    `/api/discord/config`.
 *
 * The InteractionsLambda has its own copy of the read paths (via
 * `@gsd/shared`), so this service only exists to back the management UI's
 * configuration tab.
 */
import { Injectable } from '@nestjs/common';
import { logger } from '../logger.js';
import { ConfigService } from './ConfigService.js';
import {
  asStringArray,
  getBotToken,
  getDiscordConfig,
  getPublicKey,
  invalidateSecretsCache,
  isSafeGameKey,
  putBotToken,
  putDiscordConfig,
  putPublicKey,
  type DiscordAction,
  type DiscordConfig,
  type RedactedDiscordConfig,
} from '@gsd/shared';

/** Slash-command action that can be gated via permissions. */
export type { DiscordAction } from '@gsd/shared';

function emptyConfig(): DiscordConfig {
  return {
    clientId: '',
    allowedGuilds: [],
    admins: { userIds: [], roleIds: [] },
    gamePermissions: {},
  };
}

@Injectable()
export class DiscordConfigService {
  private cache: DiscordConfig | null = null;
  /** Promise of an in-flight load — coalesces concurrent reads into one DDB call. */
  private inflight: Promise<DiscordConfig> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Resolve the DDB table name from Terraform outputs; throws if not deployed yet. */
  private tableName(): string {
    const t = this.config.getTfOutputs()?.discord_table_name;
    if (!t) throw new Error('discord_table_name not in Terraform outputs — apply Terraform first.');
    return t;
  }

  private botTokenSecretArn(): string {
    const a = this.config.getTfOutputs()?.discord_bot_token_secret_arn;
    if (!a) throw new Error('discord_bot_token_secret_arn not in Terraform outputs.');
    return a;
  }

  private publicKeySecretArn(): string {
    const a = this.config.getTfOutputs()?.discord_public_key_secret_arn;
    if (!a) throw new Error('discord_public_key_secret_arn not in Terraform outputs.');
    return a;
  }

  /** Read the config from DynamoDB; subsequent calls return a cached copy until a write invalidates. */
  private async load(): Promise<DiscordConfig> {
    if (this.cache) return this.cache;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const cfg = await getDiscordConfig(this.tableName());
        this.cache = cfg;
        return cfg;
      } catch (err) {
        logger.error('Failed to load Discord config from DynamoDB', { err });
        const empty = emptyConfig();
        this.cache = empty;
        return empty;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private async save(cfg: DiscordConfig): Promise<void> {
    await putDiscordConfig(this.tableName(), cfg);
    this.cache = cfg;
    logger.info('Discord config saved', {
      allowedGuilds: cfg.allowedGuilds.length,
      games: Object.keys(cfg.gamePermissions).length,
    });
  }

  /** Full (unredacted) config — only call this server-side. */
  async getConfig(): Promise<DiscordConfig> {
    return this.load();
  }

  /** Bot token from Secrets Manager (used by the slash-command registrar). `null` if unset. */
  async getEffectiveToken(): Promise<string | null> {
    return getBotToken(this.botTokenSecretArn());
  }

  /** Redacted view safe to return to the web client. Includes `*Set` flags for both secrets. */
  async getRedacted(): Promise<RedactedDiscordConfig> {
    const cfg = await this.load();
    const [botToken, publicKey] = await Promise.all([
      getBotToken(this.botTokenSecretArn()).catch(() => null),
      getPublicKey(this.publicKeySecretArn()).catch(() => null),
    ]);
    return {
      clientId: cfg.clientId,
      allowedGuilds: cfg.allowedGuilds,
      admins: cfg.admins,
      gamePermissions: cfg.gamePermissions,
      botTokenSet: Boolean(botToken),
      publicKeySet: Boolean(publicKey),
    };
  }

  /**
   * Update bot credentials. Any field can be omitted to leave it unchanged.
   * `botToken` and `publicKey` go to Secrets Manager; `clientId` to DynamoDB.
   *
   * @returns `true` on success, `false` if any provided field wasn't a string.
   */
  async setCredentials(params: {
    botToken?: unknown;
    clientId?: unknown;
    publicKey?: unknown;
  }): Promise<boolean> {
    if (params.botToken !== undefined && typeof params.botToken !== 'string') return false;
    if (params.clientId !== undefined && typeof params.clientId !== 'string') return false;
    if (params.publicKey !== undefined && typeof params.publicKey !== 'string') return false;
    const cfg = await this.load();
    if (typeof params.clientId === 'string') {
      cfg.clientId = params.clientId;
      await this.save(cfg);
    }
    const writes: Promise<void>[] = [];
    if (typeof params.botToken === 'string' && params.botToken.length > 0) {
      writes.push(putBotToken(this.botTokenSecretArn(), params.botToken));
    }
    if (typeof params.publicKey === 'string' && params.publicKey.length > 0) {
      writes.push(putPublicKey(this.publicKeySecretArn(), params.publicKey));
    }
    if (writes.length) {
      await Promise.all(writes);
      invalidateSecretsCache();
    }
    return true;
  }

  /** Replace the entire guild allowlist (deduped, empty strings dropped). */
  async setAllowedGuilds(guildIds: string[]): Promise<void> {
    const cfg = await this.load();
    cfg.allowedGuilds = [...new Set(guildIds.filter(Boolean))];
    await this.save(cfg);
  }

  /** Add a guild to the allowlist if not already present; otherwise no-op. */
  async addAllowedGuild(guildId: string): Promise<void> {
    const cfg = await this.load();
    if (!cfg.allowedGuilds.includes(guildId)) {
      cfg.allowedGuilds.push(guildId);
      await this.save(cfg);
    }
  }

  /** Remove a guild from the allowlist; no-op if it wasn't there. */
  async removeAllowedGuild(guildId: string): Promise<void> {
    const cfg = await this.load();
    cfg.allowedGuilds = cfg.allowedGuilds.filter((g) => g !== guildId);
    await this.save(cfg);
  }

  /**
   * Replace the server-wide admin user/role lists (deduped, empty strings
   * dropped, non-string entries discarded). Accepts `unknown` shapes defensively
   * so a malformed API body (e.g. `userIds: "..."`) can't crash the handler.
   */
  async setAdmins(admins: { userIds?: unknown; roleIds?: unknown }): Promise<void> {
    const cfg = await this.load();
    cfg.admins = {
      userIds: [...new Set(asStringArray(admins.userIds).filter(Boolean))],
      roleIds: [...new Set(asStringArray(admins.roleIds).filter(Boolean))],
    };
    await this.save(cfg);
  }

  /**
   * Overwrite the permission entry for a single game.
   * Returns `false` if the game key was rejected for prototype-pollution safety.
   */
  async setGamePermission(
    game: string,
    perm: { userIds?: unknown; roleIds?: unknown; actions?: unknown },
  ): Promise<boolean> {
    if (!isSafeGameKey(game)) {
      logger.warn('Rejected setGamePermission with unsafe key', { game });
      return false;
    }
    const cfg = await this.load();
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
    await this.save(cfg);
    return true;
  }

  /**
   * Remove the permission entry for a game so no non-admin can run commands
   * on it. Returns `false` if the game key was rejected for prototype-pollution
   * safety; the caller should surface that as a 4xx.
   */
  async deleteGamePermission(game: string): Promise<boolean> {
    if (!isSafeGameKey(game)) {
      logger.warn('Rejected deleteGamePermission with unsafe key', { game });
      return false;
    }
    const cfg = await this.load();
    delete cfg.gamePermissions[game];
    await this.save(cfg);
    return true;
  }

  /** Drop the in-memory cache so the next read sees fresh values from DDB. */
  invalidateCache(): void {
    this.cache = null;
  }
}

