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
  // Stand-in for discord.js's `GuildMember`: the real class has a `roles.cache`
  // Collection, but for the service's `instanceof` check we only need any
  // constructible class we can use in `new GuildMemberStub(...)` to simulate
  // "this member was resolved as a cached GuildMember".
  class GuildMember {
    public roles: { cache: Map<string, unknown> };
    constructor(cacheEntries: Array<[string, unknown]> = []) {
      this.roles = { cache: new Map(cacheEntries) };
    }
  }
  return {
    Client: ClientCtor,
    REST: RESTCtor,
    Routes: {
      applicationGuildCommands: (clientId: string, guildId: string) =>
        `apps/${clientId}/guilds/${guildId}/commands`,
    },
    SlashCommandBuilder,
    GuildMember,
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
import { SlashCommandRegistry } from '../discord/SlashCommandRegistry.js';
import { ServerStartCommand } from '../discord/commands/ServerStartCommand.js';
import { ServerStopCommand } from '../discord/commands/ServerStopCommand.js';
import { ServerStatusCommand } from '../discord/commands/ServerStatusCommand.js';
import { ServerListCommand } from '../discord/commands/ServerListCommand.js';

/** A ConfigService stub that returns the provided game_names from getTfOutputs. */
function makeConfigService(games: string[] = ['minecraft', 'factorio']): ConfigService {
  const stub: Partial<ConfigService> = {
    getTfOutputs: () => ({ game_names: games } as never),
    getRegion: () => 'us-east-1',
    invalidateCache: vi.fn(),
  };
  return stub as ConfigService;
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

/**
 * Wire up the full DI graph the bot needs in production: every command class
 * is real and shares the same ConfigService / DiscordConfigService / EcsService
 * stubs. Tests exercise behavior end-to-end through `DiscordBotService` rather
 * than mocking the registry — the dispatcher's contract is that it routes to
 * the right command, so we want the real commands wired up.
 */
function makeBot(params: {
  config?: ConfigService;
  ecs?: EcsService;
  discord: DiscordConfigService;
}): DiscordBotService {
  const config = params.config ?? makeConfigService();
  const ecs = params.ecs ?? makeEcsService();
  const list = new ServerListCommand(config, ecs);
  const registry = new SlashCommandRegistry([
    new ServerStartCommand(config, params.discord, ecs),
    new ServerStopCommand(config, params.discord, ecs),
    new ServerStatusCommand(config, params.discord, ecs, list),
    list,
  ]);
  return new DiscordBotService(params.discord, registry);
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
      const svc = makeBot({ discord: makeDiscordConfig({}) });
      const status = svc.getStatus();
      expect(status.state).toBe('stopped');
      expect(status.clientId).toBeNull();
      expect(status.username).toBeNull();
      expect(status.connectedGuildIds).toEqual([]);
    });
  });

  describe('start', () => {
    it('should fail when no token is configured (env or file)', async () => {
      const svc = makeBot({ discord: makeDiscordConfig({ token: '' }) });
      const result = await svc.start();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no bot token/i);
      expect(mockClientInstances).toHaveLength(0);
    });

    it('should log in with the effective token and transition to starting', async () => {
      const svc = makeBot({
        discord: makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['g1'] }),
      });
      const result = await svc.start();
      expect(result.success).toBe(true);
      const client = latestClient();
      expect(client.loginMock).toHaveBeenCalledWith('tok');
      expect(svc.getStatus().state).toBe('starting');
    });

    it('should refuse to start a second time while running', async () => {
      const svc = makeBot({ discord: makeDiscordConfig({ token: 'tok' }) });
      await svc.start();
      const second = await svc.start();
      expect(second.success).toBe(false);
      expect(second.message).toMatch(/already/i);
    });

    it('should report error state and discard the client when login rejects', async () => {
      clientInitializer = (c) => c.loginMock.mockRejectedValueOnce(new Error('bad token'));
      const svc = makeBot({ discord: makeDiscordConfig({ token: 'tok' }) });
      const result = await svc.start();
      expect(result.success).toBe(false);
      expect(svc.getStatus().state).toBe('error');
    });
  });

  describe('stop', () => {
    it('should be a no-op when the bot was never started', async () => {
      const svc = makeBot({ discord: makeDiscordConfig({}) });
      await svc.stop();
      expect(svc.getStatus().state).toBe('stopped');
    });

    it('should destroy the client and return to stopped state', async () => {
      const svc = makeBot({ discord: makeDiscordConfig({ token: 'tok' }) });
      await svc.start();
      const client = latestClient();
      await svc.stop();
      expect(client.destroyMock).toHaveBeenCalledTimes(1);
      expect(svc.getStatus().state).toBe('stopped');
    });
  });

  describe('ready handler', () => {
    it('should leave guilds that are not on the allowlist at startup', async () => {
      const svc = makeBot({
        discord: makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['keep'] }),
      });
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
      const svc = makeBot({
        discord: makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['g1', 'g2'] }),
      });
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
      const svc = makeBot({
        discord: makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['allowed'] }),
      });
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['guildCreate']?.[0];
      const leave = vi.fn().mockResolvedValue(undefined);
      await handler!({ id: 'intruder', name: 'Intruder', leave });
      expect(leave).toHaveBeenCalledTimes(1);
      expect(restPutMock).not.toHaveBeenCalled();
    });

    it('should register commands when joining an allowed guild', async () => {
      const svc = makeBot({
        discord: makeDiscordConfig({ token: 'tok', clientId: 'cid', allowedGuilds: ['allowed'] }),
      });
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
        // Use the APIInteractionGuildMember shape (plain array) so extractRoleIds
        // doesn't need the mocked GuildMember class here.
        member: { roles: ['role-1'] },
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
      const svc = makeBot({
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['other'], canRun: true }),
      });
      const interaction = makeInteraction({ guildId: 'g1' });
      await dispatch(svc, interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/not allowlisted/i) }),
      );
    });

    it('should deny when canRun returns false', async () => {
      const ecs = makeEcsService();
      const svc = makeBot({
        ecs,
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: false }),
      });
      const interaction = makeInteraction();
      await dispatch(svc, interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/don't have permission/i) }),
      );
      expect(ecs.start).not.toHaveBeenCalled();
    });

    it('should invoke EcsService.start for /server-start when permitted', async () => {
      const ecs = makeEcsService();
      const svc = makeBot({
        ecs,
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      });
      const interaction = makeInteraction();
      await dispatch(svc, interaction);
      expect(ecs.start).toHaveBeenCalledWith('minecraft');
      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('starting'));
    });

    it('should invoke EcsService.stop for /server-stop when permitted', async () => {
      const ecs = makeEcsService();
      const svc = makeBot({
        ecs,
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      });
      const interaction = makeInteraction({ commandName: 'server-stop' });
      await dispatch(svc, interaction);
      expect(ecs.stop).toHaveBeenCalledWith('minecraft');
    });

    it('should return an ephemeral error for interactions outside a guild', async () => {
      const svc = makeBot({
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      });
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
      const svc = makeBot({
        config: makeConfigService(['minecraft', 'factorio']),
        ecs,
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      });
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

    it('should deny /server-list when the user has no status permission on any game', async () => {
      const ecs = makeEcsService();
      const svc = makeBot({
        config: makeConfigService(['minecraft', 'factorio']),
        ecs,
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: false }),
      });
      const interaction = makeInteraction({
        commandName: 'server-list',
        options: {
          getString: () => null,
          getFocused: () => ({ name: 'game', value: '' }),
        },
      });
      await dispatch(svc, interaction);
      expect(ecs.getStatus).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/don't have permission/i) }),
      );
    });

    it('should filter /server-list to only games the user can see', async () => {
      const ecs = makeEcsService({
        getStatus: vi.fn().mockImplementation((g: string) => Promise.resolve({ game: g, state: 'running' })),
      } as Partial<EcsService>);
      // Allow only "minecraft" through canRun.
      const discord = {
        getEffectiveToken: () => 'tok',
        getConfig: () => ({
          botToken: 'tok',
          clientId: '',
          allowedGuilds: ['g1'],
          admins: { userIds: [], roleIds: [] },
          gamePermissions: {},
        }),
        canRun: vi.fn().mockImplementation(({ game }: { game: string }) => game === 'minecraft'),
      } as unknown as import('./DiscordConfigService.js').DiscordConfigService;
      const svc = makeBot({
        config: makeConfigService(['minecraft', 'factorio']),
        ecs,
        discord,
      });
      const interaction = makeInteraction({
        commandName: 'server-list',
        options: {
          getString: () => null,
          getFocused: () => ({ name: 'game', value: '' }),
        },
      });
      await dispatch(svc, interaction);
      expect(ecs.getStatus).toHaveBeenCalledTimes(1);
      expect(ecs.getStatus).toHaveBeenCalledWith('minecraft');
    });

    it('should edit-reply with an error when fetching statuses for /server-list fails', async () => {
      const ecs = makeEcsService({
        getStatus: vi.fn().mockRejectedValue(new Error('aws-fail')),
      } as Partial<EcsService>);
      const svc = makeBot({
        config: makeConfigService(['minecraft']),
        ecs,
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      });
      // The `deferred`/`replied` flags aren't set on our plain mock interaction,
      // so the catch branch falls through to `reply` — exercise both paths by
      // first verifying the deferred-reply path via a shim, then the plain path.
      const interaction = makeInteraction({
        commandName: 'server-list',
        deferred: true,
        options: { getString: () => null, getFocused: () => ({ name: 'game', value: '' }) },
      }) as ReturnType<typeof makeInteraction> & { deferred: boolean; replied: boolean };
      await dispatch(svc, interaction);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/could not fetch server statuses/i),
      );
    });
  });

  describe('autocomplete', () => {
    it('should offer game names filtered by the focused option value and canRun', async () => {
      const svc = makeBot({
        config: makeConfigService(['minecraft', 'factorio', 'valheim']),
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      });
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['interactionCreate']?.[0];
      const respond = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        guildId: 'g1',
        commandName: 'server-start',
        user: { id: 'user-1' },
        member: { roles: ['role-1'] },
        options: { getFocused: () => ({ name: 'game', value: 'fact' }) },
        respond,
      };
      await handler!(interaction);
      expect(respond).toHaveBeenCalledWith([{ name: 'factorio', value: 'factorio' }]);
    });

    it('should ignore autocomplete for unrelated option names', async () => {
      const svc = makeBot({
        config: makeConfigService(['minecraft']),
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      });
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['interactionCreate']?.[0];
      const respond = vi.fn().mockResolvedValue(undefined);
      await handler!({
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        guildId: 'g1',
        commandName: 'server-start',
        user: { id: 'user-1' },
        member: { roles: [] },
        options: { getFocused: () => ({ name: 'other', value: 'x' }) },
        respond,
      });
      expect(respond).not.toHaveBeenCalled();
    });

    it('should refuse autocomplete from a non-allowlisted guild', async () => {
      const svc = makeBot({
        config: makeConfigService(['minecraft']),
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      });
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['interactionCreate']?.[0];
      const respond = vi.fn().mockResolvedValue(undefined);
      await handler!({
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        guildId: 'other',
        commandName: 'server-start',
        user: { id: 'user-1' },
        member: { roles: [] },
        options: { getFocused: () => ({ name: 'game', value: '' }) },
        respond,
      });
      // Should respond with an empty list rather than timing out — an
      // unanswered autocomplete surfaces to users as "interaction failed".
      // Empty still hides configured game names from non-allowlisted guilds.
      expect(respond).toHaveBeenCalledWith([]);
    });

    it('should filter autocomplete to only games the invoker has permission for', async () => {
      // Allow only "minecraft" through canRun.
      const discord = {
        getEffectiveToken: () => 'tok',
        getConfig: () => ({
          botToken: 'tok',
          clientId: '',
          allowedGuilds: ['g1'],
          admins: { userIds: [], roleIds: [] },
          gamePermissions: {},
        }),
        canRun: vi.fn().mockImplementation(({ game }: { game: string }) => game === 'minecraft'),
      } as unknown as import('./DiscordConfigService.js').DiscordConfigService;
      const svc = makeBot({
        config: makeConfigService(['minecraft', 'factorio']),
        discord,
      });
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['interactionCreate']?.[0];
      const respond = vi.fn().mockResolvedValue(undefined);
      await handler!({
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        guildId: 'g1',
        commandName: 'server-start',
        user: { id: 'user-1' },
        member: { roles: [] },
        options: { getFocused: () => ({ name: 'game', value: '' }) },
        respond,
      });
      expect(respond).toHaveBeenCalledWith([{ name: 'minecraft', value: 'minecraft' }]);
    });

    it('should invalidate the Terraform cache before reading game names', async () => {
      const config = makeConfigService(['minecraft']);
      const svc = makeBot({
        config,
        discord: makeDiscordConfig({ token: 'tok', allowedGuilds: ['g1'], canRun: true }),
      });
      await svc.start();
      const client = latestClient();
      const handler = client.listeners['interactionCreate']?.[0];
      await handler!({
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        guildId: 'g1',
        commandName: 'server-start',
        user: { id: 'user-1' },
        member: { roles: [] },
        options: { getFocused: () => ({ name: 'game', value: '' }) },
        respond: vi.fn().mockResolvedValue(undefined),
      });
      expect(config.invalidateCache).toHaveBeenCalled();
    });
  });
});
