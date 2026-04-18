/**
 * Tests for DiscordCommandRegistrar — the server's per-guild
 * slash-command REST PUT that replaces the old always-on
 * `DiscordBotService.registerCommandsForGuild()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordCommandRegistrar } from './DiscordCommandRegistrar.js';
import { DiscordConfigService } from './DiscordConfigService.js';

const fetchMock = vi.fn();
(globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

function makeDiscord(overrides: Partial<DiscordConfigService> = {}): DiscordConfigService {
  const config = {
    getConfig: vi.fn().mockResolvedValue({
      clientId: 'app-id',
      allowedGuilds: ['G1'],
      admins: { userIds: [], roleIds: [] },
      gamePermissions: {},
    }),
    getEffectiveToken: vi.fn().mockResolvedValue('bot-token-xyz'),
    ...overrides,
  } as Partial<DiscordConfigService>;
  return config as DiscordConfigService;
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DiscordCommandRegistrar.registerForGuild', () => {
  it('should reject an empty guildId early without touching Discord', async () => {
    const registrar = new DiscordCommandRegistrar(makeDiscord());
    const result = await registrar.registerForGuild('');
    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should return an actionable error when clientId is not configured', async () => {
    const registrar = new DiscordCommandRegistrar(
      makeDiscord({
        getConfig: vi.fn().mockResolvedValue({
          clientId: '',
          allowedGuilds: ['G1'],
          admins: { userIds: [], roleIds: [] },
          gamePermissions: {},
        }),
      }),
    );
    const result = await registrar.registerForGuild('G1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/clientId/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should return an actionable error when the bot token is not configured', async () => {
    const registrar = new DiscordCommandRegistrar(
      makeDiscord({ getEffectiveToken: vi.fn().mockResolvedValue(null) }),
    );
    const result = await registrar.registerForGuild('G1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should PUT the command descriptors to Discord with a Bot authorization header', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const registrar = new DiscordCommandRegistrar(makeDiscord());
    const result = await registrar.registerForGuild('G1');
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://discord.com/api/v10/applications/app-id/guilds/G1/commands');
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe('Bot bot-token-xyz');
    const body = JSON.parse(init.body);
    const names = body.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(['server-list', 'server-start', 'server-status', 'server-stop']);
  });

  it('should surface Discord non-2xx responses verbatim', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => '{"code":10004}' });
    const registrar = new DiscordCommandRegistrar(makeDiscord());
    const result = await registrar.registerForGuild('G-unknown');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/404/);
    expect(result.message).toMatch(/10004/);
  });

  it('should surface thrown errors without crashing the request handler', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const registrar = new DiscordCommandRegistrar(makeDiscord());
    const result = await registrar.registerForGuild('G1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/network down/);
  });
});
