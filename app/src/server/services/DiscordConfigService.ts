import { injectable } from 'tsyringe';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '../../../../../app/discord_config.json');

export type DiscordAction = 'start' | 'stop' | 'status';

export interface DiscordGamePermission {
  userIds: string[];
  roleIds: string[];
  actions: DiscordAction[];
}

export interface DiscordAdmins {
  userIds: string[];
  roleIds: string[];
}

export interface DiscordConfig {
  botToken: string;
  clientId: string;
  allowedGuilds: string[];
  admins: DiscordAdmins;
  gamePermissions: Record<string, DiscordGamePermission>;
}

export type RedactedDiscordConfig = Omit<DiscordConfig, 'botToken'> & {
  botTokenSet: boolean;
};

const EMPTY_CONFIG: DiscordConfig = {
  botToken: '',
  clientId: '',
  allowedGuilds: [],
  admins: { userIds: [], roleIds: [] },
  gamePermissions: {},
};

@injectable()
export class DiscordConfigService {
  private cache: DiscordConfig | null = null;

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

  private save(cfg: DiscordConfig): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    this.cache = cfg;
    logger.info('Discord config saved', {
      allowedGuilds: cfg.allowedGuilds.length,
      games: Object.keys(cfg.gamePermissions).length,
    });
  }

  getConfig(): DiscordConfig {
    return this.load();
  }

  /** Token from env wins over file — caller passes to discord.js client.login(). */
  getEffectiveToken(): string {
    return process.env['DISCORD_BOT_TOKEN'] || this.load().botToken;
  }

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

  setCredentials(params: { botToken?: string; clientId?: string }): void {
    const cfg = this.load();
    if (params.botToken !== undefined) cfg.botToken = params.botToken;
    if (params.clientId !== undefined) cfg.clientId = params.clientId;
    this.save(cfg);
  }

  setAllowedGuilds(guildIds: string[]): void {
    const cfg = this.load();
    cfg.allowedGuilds = [...new Set(guildIds.filter(Boolean))];
    this.save(cfg);
  }

  addAllowedGuild(guildId: string): void {
    const cfg = this.load();
    if (!cfg.allowedGuilds.includes(guildId)) {
      cfg.allowedGuilds.push(guildId);
      this.save(cfg);
    }
  }

  removeAllowedGuild(guildId: string): void {
    const cfg = this.load();
    cfg.allowedGuilds = cfg.allowedGuilds.filter((g) => g !== guildId);
    this.save(cfg);
  }

  setAdmins(admins: DiscordAdmins): void {
    const cfg = this.load();
    cfg.admins = {
      userIds: [...new Set((admins.userIds ?? []).filter(Boolean))],
      roleIds: [...new Set((admins.roleIds ?? []).filter(Boolean))],
    };
    this.save(cfg);
  }

  setGamePermission(game: string, perm: DiscordGamePermission): void {
    const cfg = this.load();
    cfg.gamePermissions[game] = {
      userIds: [...new Set((perm.userIds ?? []).filter(Boolean))],
      roleIds: [...new Set((perm.roleIds ?? []).filter(Boolean))],
      actions: [...new Set((perm.actions ?? []).filter((a) => a === 'start' || a === 'stop' || a === 'status'))],
    };
    this.save(cfg);
  }

  deleteGamePermission(game: string): void {
    const cfg = this.load();
    delete cfg.gamePermissions[game];
    this.save(cfg);
  }

  /** Resolve whether a user with given role IDs is allowed to run action on game. */
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
