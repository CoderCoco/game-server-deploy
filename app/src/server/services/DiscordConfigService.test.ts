import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { DiscordConfigService, type DiscordConfig } from './DiscordConfigService.js';

const mockExists = vi.mocked(existsSync);
const mockRead = vi.mocked(readFileSync);
const mockWrite = vi.mocked(writeFileSync);

/** Serialize a partial DiscordConfig as the on-disk JSON blob. */
function writeState(cfg: Partial<DiscordConfig>): void {
  mockExists.mockReturnValue(true);
  mockRead.mockReturnValue(JSON.stringify(cfg));
}

/** Grab the most recent `writeFileSync` payload and parse it back into a config. */
function lastWrittenConfig(): DiscordConfig {
  const call = mockWrite.mock.calls.at(-1);
  if (!call) throw new Error('writeFileSync was not called');
  return JSON.parse(call[1] as string) as DiscordConfig;
}

describe('DiscordConfigService', () => {
  let service: DiscordConfigService;
  const originalEnvToken = process.env['DISCORD_BOT_TOKEN'];

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DiscordConfigService();
    delete process.env['DISCORD_BOT_TOKEN'];
  });

  afterEach(() => {
    if (originalEnvToken === undefined) delete process.env['DISCORD_BOT_TOKEN'];
    else process.env['DISCORD_BOT_TOKEN'] = originalEnvToken;
  });

  describe('getConfig', () => {
    it('should return an empty, well-formed config when the file does not exist', () => {
      mockExists.mockReturnValue(false);
      const cfg = service.getConfig();
      expect(cfg).toEqual({
        botToken: '',
        clientId: '',
        allowedGuilds: [],
        admins: { userIds: [], roleIds: [] },
        gamePermissions: {},
      });
    });

    it('should parse a fully-populated config from disk', () => {
      writeState({
        botToken: 'tok',
        clientId: 'cid',
        allowedGuilds: ['g1'],
        admins: { userIds: ['u1'], roleIds: ['r1'] },
        gamePermissions: {
          minecraft: { userIds: ['u2'], roleIds: ['r2'], actions: ['start', 'stop'] },
        },
      });
      const cfg = service.getConfig();
      expect(cfg.allowedGuilds).toEqual(['g1']);
      expect(cfg.admins.userIds).toEqual(['u1']);
      expect(cfg.gamePermissions['minecraft']?.actions).toEqual(['start', 'stop']);
    });

    it('should fill defaults when the file has partial data', () => {
      writeState({ clientId: 'cid' });
      const cfg = service.getConfig();
      expect(cfg.clientId).toBe('cid');
      expect(cfg.allowedGuilds).toEqual([]);
      expect(cfg.admins).toEqual({ userIds: [], roleIds: [] });
      expect(cfg.gamePermissions).toEqual({});
    });

    it('should return an empty config when the file is malformed JSON', () => {
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue('{bad');
      expect(service.getConfig().allowedGuilds).toEqual([]);
    });

    it('should cache parsed config across calls', () => {
      writeState({ clientId: 'cid' });
      service.getConfig();
      service.getConfig();
      expect(mockRead).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEffectiveToken', () => {
    it('should prefer DISCORD_BOT_TOKEN env var over file contents', () => {
      writeState({ botToken: 'file-token' });
      process.env['DISCORD_BOT_TOKEN'] = 'env-token';
      expect(service.getEffectiveToken()).toBe('env-token');
    });

    it('should fall back to the file token when env var is unset', () => {
      writeState({ botToken: 'file-token' });
      expect(service.getEffectiveToken()).toBe('file-token');
    });

    it('should return empty string when neither is set', () => {
      mockExists.mockReturnValue(false);
      expect(service.getEffectiveToken()).toBe('');
    });
  });

  describe('getRedacted', () => {
    it('should not include botToken and should expose botTokenSet=true when set', () => {
      writeState({ botToken: 'secret', clientId: 'cid', allowedGuilds: ['g1'] });
      const redacted = service.getRedacted();
      expect('botToken' in redacted).toBe(false);
      expect(redacted.botTokenSet).toBe(true);
      expect(redacted.clientId).toBe('cid');
      expect(redacted.allowedGuilds).toEqual(['g1']);
    });

    it('should mark botTokenSet=true when only the env var is set', () => {
      writeState({});
      process.env['DISCORD_BOT_TOKEN'] = 'env-token';
      expect(service.getRedacted().botTokenSet).toBe(true);
    });

    it('should mark botTokenSet=false when no token is available', () => {
      mockExists.mockReturnValue(false);
      expect(service.getRedacted().botTokenSet).toBe(false);
    });
  });

  describe('setCredentials', () => {
    it('should update only the provided fields', () => {
      writeState({ botToken: 'old-token', clientId: 'old-cid' });
      service.setCredentials({ clientId: 'new-cid' });
      expect(lastWrittenConfig().clientId).toBe('new-cid');
      expect(lastWrittenConfig().botToken).toBe('old-token');
    });

    it('should allow updating both fields at once', () => {
      mockExists.mockReturnValue(false);
      service.setCredentials({ botToken: 'tok', clientId: 'cid' });
      const written = lastWrittenConfig();
      expect(written.botToken).toBe('tok');
      expect(written.clientId).toBe('cid');
    });
  });

  describe('guild allowlist mutations', () => {
    it('should add a guild without duplicates', () => {
      writeState({ allowedGuilds: ['g1'] });
      service.addAllowedGuild('g2');
      expect(lastWrittenConfig().allowedGuilds).toEqual(['g1', 'g2']);
    });

    it('should no-op when adding an already-present guild', () => {
      writeState({ allowedGuilds: ['g1'] });
      service.addAllowedGuild('g1');
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should remove a guild when present', () => {
      writeState({ allowedGuilds: ['g1', 'g2'] });
      service.removeAllowedGuild('g1');
      expect(lastWrittenConfig().allowedGuilds).toEqual(['g2']);
    });

    it('should deduplicate and strip empty strings in setAllowedGuilds', () => {
      mockExists.mockReturnValue(false);
      service.setAllowedGuilds(['a', '', 'a', 'b']);
      expect(lastWrittenConfig().allowedGuilds).toEqual(['a', 'b']);
    });
  });

  describe('setAdmins', () => {
    it('should deduplicate and strip empty user/role IDs', () => {
      mockExists.mockReturnValue(false);
      service.setAdmins({ userIds: ['u1', 'u1', ''], roleIds: ['r1', '', 'r2'] });
      const written = lastWrittenConfig();
      expect(written.admins.userIds).toEqual(['u1']);
      expect(written.admins.roleIds).toEqual(['r1', 'r2']);
    });
  });

  describe('setGamePermission', () => {
    it('should reject unknown actions when saving a permission', () => {
      mockExists.mockReturnValue(false);
      service.setGamePermission('minecraft', {
        userIds: ['u1'],
        roleIds: [],
        actions: ['start', 'stop', 'invalid' as 'start'],
      });
      const written = lastWrittenConfig();
      expect(written.gamePermissions['minecraft']?.actions).toEqual(['start', 'stop']);
    });

    it('should deduplicate user and role IDs per game', () => {
      mockExists.mockReturnValue(false);
      service.setGamePermission('minecraft', {
        userIds: ['u1', 'u1'],
        roleIds: ['r1', 'r1'],
        actions: ['status'],
      });
      const written = lastWrittenConfig();
      expect(written.gamePermissions['minecraft']?.userIds).toEqual(['u1']);
      expect(written.gamePermissions['minecraft']?.roleIds).toEqual(['r1']);
    });
  });

  describe('deleteGamePermission', () => {
    it('should remove the entry for the given game', () => {
      writeState({
        gamePermissions: {
          minecraft: { userIds: [], roleIds: [], actions: ['start'] },
          factorio: { userIds: [], roleIds: [], actions: ['stop'] },
        },
      });
      service.deleteGamePermission('minecraft');
      const written = lastWrittenConfig();
      expect(written.gamePermissions['minecraft']).toBeUndefined();
      expect(written.gamePermissions['factorio']).toBeDefined();
    });
  });

  describe('canRun', () => {
    const baseCfg: DiscordConfig = {
      botToken: '',
      clientId: '',
      allowedGuilds: ['g1'],
      admins: { userIds: ['admin-user'], roleIds: ['admin-role'] },
      gamePermissions: {
        minecraft: { userIds: ['mc-user'], roleIds: ['mc-role'], actions: ['start', 'status'] },
      },
    };

    beforeEach(() => {
      writeState(baseCfg);
    });

    it('should deny when the guild is not allowlisted', () => {
      expect(
        service.canRun({ guildId: 'other', userId: 'admin-user', roleIds: [], game: 'minecraft', action: 'start' }),
      ).toBe(false);
    });

    it('should allow admin users to run any action on any game', () => {
      expect(
        service.canRun({ guildId: 'g1', userId: 'admin-user', roleIds: [], game: 'unknown', action: 'stop' }),
      ).toBe(true);
    });

    it('should allow admin roles to run any action', () => {
      expect(
        service.canRun({ guildId: 'g1', userId: 'someone', roleIds: ['admin-role'], game: 'unknown', action: 'stop' }),
      ).toBe(true);
    });

    it('should allow per-game user access for permitted actions', () => {
      expect(
        service.canRun({ guildId: 'g1', userId: 'mc-user', roleIds: [], game: 'minecraft', action: 'start' }),
      ).toBe(true);
    });

    it('should allow per-game role access for permitted actions', () => {
      expect(
        service.canRun({ guildId: 'g1', userId: 'random', roleIds: ['mc-role'], game: 'minecraft', action: 'status' }),
      ).toBe(true);
    });

    it('should deny per-game access for actions not in the permission list', () => {
      expect(
        service.canRun({ guildId: 'g1', userId: 'mc-user', roleIds: [], game: 'minecraft', action: 'stop' }),
      ).toBe(false);
    });

    it('should deny users and roles that are not listed for a game', () => {
      expect(
        service.canRun({ guildId: 'g1', userId: 'random', roleIds: ['random-role'], game: 'minecraft', action: 'start' }),
      ).toBe(false);
    });

    it('should deny when no permission entry exists for the game', () => {
      expect(
        service.canRun({ guildId: 'g1', userId: 'random', roleIds: [], game: 'factorio', action: 'start' }),
      ).toBe(false);
    });
  });
});
