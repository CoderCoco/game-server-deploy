import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Minimal stand-in for the discord.js `Client`. The DiscordBotService attaches
 * listeners via `once`/`on` and later interacts with `guilds.cache`, `application`,
 * and `user` — we capture handlers so tests can invoke them directly.
 */
class MockClient {
  public listeners: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  public loginMock = vi.fn<(token: string) => Promise<string>>().mockResolvedValue('ok');
  public destroyMock = vi.fn().mockResolvedValue(undefined);
  public application: { id: string } | null = { id: 'bot-app-id' };
  public user: { username: string } | null = { username: 'TestBot' };
  public guilds: { cache: Map<string, { id: string; name: string; leave: () => Promise<unknown> }> } = {
    cache: new Map(),
  };

  once(event: string, handler: (...args: unknown[]) => unknown): this {
    (this.listeners[event] ||= []).push(handler);
    return this;
  }
  on(event: string, handler: (...args: unknown[]) => unknown): this {
    (this.listeners[event] ||= []).push(handler);
    return this;
  }
  async login(token: string): Promise<string> {
    return this.loginMock(token);
  }
  async destroy(): Promise<void> {
    await this.destroyMock();
  }
}

const mockClientInstances: MockClient[] = [];
const restPutMock = vi.fn().mockResolvedValue(undefined);
/** Optional hook to mutate each freshly-constructed MockClient (e.g. to force login failure). */
let clientInitializer: ((c: MockClient) => void) | null = null;

vi.mock('discord.js', () => {
  class ClientCtor {
    constructor() {
      const inst = new MockClient();
      if (clientInitializer) clientInitializer(inst);
      mockClientInstances.push(inst);
      return inst as unknown as ClientCtor;
    }
  }
  class RESTCtor {
    setToken() {
      return this;
    }
    async put(...args: unknown[]) {
      return restPutMock(...args);
    }
  }
  class SlashCommandBuilder {
    private data: Record<string, unknown> = { options: [] };
    setName(n: string) { this.data['name'] = n; return this; }
    setDescription(d: string) { this.data['description'] = d; return this; }
    addStringOption(fn: (o: SlashCommandBuilder) => SlashCommandBuilder) {
      const opt = new SlashCommandBuilder();
      fn(opt);
      (this.data['options'] as unknown[]).push(opt.toJSON());
      return this;
    }
    setRequired(_r: boolean) { return this; }
    setAutocomplete(_a: boolean) { return this; }
    toJSON() { return this.data; }
  }
  return {
    Client: ClientCtor,
    REST: RESTCtor,
    Routes: {
      applicationGuildCommands: (clientId: string, guildId: string) =>
        `apps/${clientId}/guilds/${guildId}/commands`,
    },
    SlashCommandBuilder,
    GatewayIntentBits: { Guilds: 1, GuildMembers: 2 },
    MessageFlags: { Ephemeral: 64 },
  };
});

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DiscordBotService } from './DiscordBotService.js';
import type { ConfigService } from './ConfigService.js';
import type { EcsService } from './EcsService.js';
import type { DiscordConfigService } from './DiscordConfigService.js';

/** A ConfigService stub that returns the provided game_names from getTfOutputs. */
function makeConfigService(games: string[] = ['minecraft', 'factorio']): ConfigService {
  return {
    getTfOutputs: () => ({ game_names: games } as never),
    getRegion: () => 'us-east-1',
  } as unknown as ConfigService;
}

/** A DiscordConfigService stub with overridable token, allowlist, and canRun predicate. */
function makeDiscordConfig(params: {
  token?: string;
  clientId?: string;
  allowedGuilds?: string[];
  canRun?: boolean;
}): DiscordConfigService {
  return {
    getEffectiveToken: () => params.token ?? '',
    getConfig: () => ({
      botToken: params.token ?? '',
      clientId: params.clientId ?? '',
      allowedGuilds: params.allowedGuilds ?? [],
      admins: { userIds: [], roleIds: [] },
      gamePermissions: {},
    }),
    canRun: vi.fn().mockReturnValue(params.canRun ?? false),
  } as unknown as DiscordConfigService;
}

function makeEcsService(overrides: Partial<EcsService> = {}): EcsService {
  return {
    start: vi.fn().mockResolvedValue({ success: true, message: 'starting' }),
    stop: vi.fn().mockResolvedValue({ success: true, message: 'stopping' }),
    getStatus: vi.fn().mockResolvedValue({ game: 'minecraft', state: 'running' }),
    ...overrides,
  } as unknown as EcsService;
}

function latestClient(): MockClient {
  const client = mockClientInstances.at(-1);
  if (!client) throw new Error('Client was not constructed');
  return client;
}

beforeEach(() => {
  mockClientInstances.length = 0;
  restPutMock.mockClear();
  clientInitializer = null;
});

describe('DiscordBotService', () => {
  describe('getStatus', () => {
    it('should report stopped with no client when the bot has not been started', () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({}),
      );
      const status = svc.getStatus();
      expect(status.state).toBe('stopped');
      expect(status.clientId).toBeNull();
      expect(status.username).toBeNull();
      expect(status.connectedGuildIds).toEqual([]);
    });
  });

  describe('start', () => {
    it('should fail when no token is configured (env or file)', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: '' }),
      );
      const result = await svc.start();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no bot token/i);
      expect(mockClientInstances).toHaveLength(0);
    });

    it('should log in with the effective token and transition to starting', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['g1'] }),
      );
      const result = await svc.start();
      expect(result.success).toBe(true);
      const client = latestClient();
      expect(client.loginMock).toHaveBeenCalledWith('tok');
      expect(svc.getStatus().state).toBe('starting');
    });

    it('should refuse to start a second time while running', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok' }),
      );
      await svc.start();
      const second = await svc.start();
      expect(second.success).toBe(false);
      expect(second.message).toMatch(/already/i);
    });

    it('should report error state and discard the client when login rejects', async () => {
      clientInitializer = (c) => c.loginMock.mockRejectedValueOnce(new Error('bad token'));
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok' }),
      );
      const result = await svc.start();
      expect(result.success).toBe(false);
      expect(svc.getStatus().state).toBe('error');
    });
  });

  describe('stop', () => {
    it('should be a no-op when the bot was never started', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({}),
      );
      await svc.stop();
      expect(svc.getStatus().state).toBe('stopped');
    });

    it('should destroy the client and return to stopped state', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok' }),
      );
      await svc.start();
      const client = latestClient();
      await svc.stop();
      expect(client.destroyMock).toHaveBeenCalledTimes(1);
      expect(svc.getStatus().state).toBe('stopped');
    });
  });

  describe('ready handler', () => {
    it('should leave guilds that are not on the allowlist at startup', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['keep'] }),
      );
      await svc.start();
      const client = latestClient();
      const leaveKeep = vi.fn().mockResolvedValue(undefined);
      const leaveDrop = vi.fn().mockResolvedValue(undefined);
      client.guilds.cache.set('keep', { id: 'keep', name: 'Keep', leave: leaveKeep });
      client.guilds.cache.set('drop', { id: 'drop', name: 'Drop', leave: leaveDrop });

      const readyHandler = client.listeners['ready']?.[0];
      expect(readyHandler).toBeDefined();
      await readyHandler!({ user: { username: 'TestBot' } });

      expect(leaveDrop).toHaveBeenCalledTimes(1);
      expect(leaveKeep).not.toHaveBeenCalled();
    });

    it('should register slash commands for each allowed guild once ready', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['g1', 'g2'] }),
      );
      await svc.start();
      const client = latestClient();

      const readyHandler = client.listeners['ready']?.[0];
      await readyHandler!({ user: { username: 'TestBot' } });

      expect(restPutMock).toHaveBeenCalledTimes(2);
      const routes = restPutMock.mock.calls.map((c) => c[0]);
      expect(routes).toContain('apps/bot-app-id/guilds/g1/commands');
      expect(routes).toContain('apps/bot-app-id/guilds/g2/commands');
    });
  });

  describe('guildCreate handler', () => {
    it('should leave a newly-joined guild that is not on the allowlist', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['allowed'] }),
      );
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['guildCreate']?.[0];
      const leave = vi.fn().mockResolvedValue(undefined);
      await handler!({ id: 'intruder', name: 'Intruder', leave });
      expect(leave).toHaveBeenCalledTimes(1);
      expect(restPutMock).not.toHaveBeenCalled();
    });

    it('should register commands when joining an allowed guild', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['allowed'] }),
      );
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['guildCreate']?.[0];
      const leave = vi.fn();
      await handler!({ id: 'allowed', name: 'Allowed', leave });
      expect(leave).not.toHaveBeenCalled();
      expect(restPutMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('interaction handling', () => {
    function makeInteraction(overrides: Record<string, unknown> = {}) {
      const reply = vi.fn().mockResolvedValue(undefined);
      const deferReply = vi.fn().mockResolvedValue(undefined);
      const editReply = vi.fn().mockResolvedValue(undefined);
      const respond = vi.fn().mockResolvedValue(undefined);
      return {
        reply,
        deferReply,
        editReply,
        respond,
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        guildId: 'g1',
        user: { id: 'user-1' },
        member: { roles: { cache: new Map([['role-1', {}]]) } },
        commandName: 'server-start',
        options: {
          getString: (_name: string) => 'minecraft',
          getFocused: (_withType: boolean) => ({ name: 'game', value: '' }),
        },
        ...overrides,
      };
    }

    async function dispatch(svc: DiscordBotService, interaction: ReturnType<typeof makeInteraction>) {
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['interactionCreate']?.[0];
      expect(handler).toBeDefined();
      await handler!(interaction);
      // handleInteraction is fire-and-forget inside the listener — give it a tick.
      await new Promise((r) => setImmediate(r));
    }

    it('should deny interactions from non-allowlisted guilds', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok', allowedGuilds: ['other'], canRun: true }),
      );
      const interaction = makeInteraction({ guildId: 'g1' });
      await dispatch(svc, interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/not allowlisted/i) }),
      );
    });

    it('should deny when canRun returns false', async () => {
      const ecs = makeEcsService();
      const svc = new DiscordBotService(
        makeConfigService(),
        ecs,
        makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: false }),
      );
      const interaction = makeInteraction();
      await dispatch(svc, interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/don't have permission/i) }),
      );
      expect(ecs.start).not.toHaveBeenCalled();
    });

    it('should invoke EcsService.start for /server-start when permitted', async () => {
      const ecs = makeEcsService();
      const svc = new DiscordBotService(
        makeConfigService(),
        ecs,
        makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      );
      const interaction = makeInteraction();
      await dispatch(svc, interaction);
      expect(ecs.start).toHaveBeenCalledWith('minecraft');
      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('starting'));
    });

    it('should invoke EcsService.stop for /server-stop when permitted', async () => {
      const ecs = makeEcsService();
      const svc = new DiscordBotService(
        makeConfigService(),
        ecs,
        makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      );
      const interaction = makeInteraction({ commandName: 'server-stop' });
      await dispatch(svc, interaction);
      expect(ecs.stop).toHaveBeenCalledWith('minecraft');
    });

    it('should return an ephemeral error for interactions outside a guild', async () => {
      const svc = new DiscordBotService(
        makeConfigService(),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      );
      const interaction = makeInteraction({ guildId: null });
      await dispatch(svc, interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/only works in configured/i) }),
      );
    });

    it('should produce a status list for /server-list using ecs.getStatus for each game', async () => {
      const ecs = makeEcsService({
        getStatus: vi.fn().mockImplementation((g: string) => Promise.resolve({ game: g, state: 'running' })),
      } as Partial<EcsService>);
      const svc = new DiscordBotService(
        makeConfigService(['minecraft', 'factorio']),
        ecs,
        makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      );
      const interaction = makeInteraction({
        commandName: 'server-list',
        options: {
          getString: () => null,
          getFocused: () => ({ name: 'game', value: '' }),
        },
      });
      await dispatch(svc, interaction);
      expect(ecs.getStatus).toHaveBeenCalledTimes(2);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/minecraft[\s\S]*factorio/),
      );
    });
  });

  describe('autocomplete', () => {
    it('should offer game names filtered by the focused option value', async () => {
      const svc = new DiscordBotService(
        makeConfigService(['minecraft', 'factorio', 'valheim']),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'] }),
      );
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['interactionCreate']?.[0];
      const respond = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        options: { getFocused: () => ({ name: 'game', value: 'fact' }) },
        respond,
      };
      await handler!(interaction);
      expect(respond).toHaveBeenCalledWith([{ name: 'factorio', value: 'factorio' }]);
    });

    it('should ignore autocomplete for unrelated option names', async () => {
      const svc = new DiscordBotService(
        makeConfigService(['minecraft']),
        makeEcsService(),
        makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'] }),
      );
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['interactionCreate']?.[0];
      const respond = vi.fn().mockResolvedValue(undefined);
      await handler!({
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        options: { getFocused: () => ({ name: 'other', value: 'x' }) },
        respond,
      });
      expect(respond).not.toHaveBeenCalled();
    });
  });
});
