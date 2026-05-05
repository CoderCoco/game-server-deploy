import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({
  status: vi.fn(),
  costsEstimate: vi.fn(),
  games: vi.fn(),
  discordConfig: vi.fn(),
}));
vi.mock('../api.service.js', () => ({ api: apiMock }));

import { DiscordPage } from './discord.page.js';
import { renderPage } from '../test-utils/render-page.utils.js';

const REDACTED_CONFIG = {
  clientId: '123456789012345678',
  allowedGuilds: ['111111111111111111'],
  admins: { userIds: [], roleIds: [] },
  gamePermissions: {},
  baseAllowedGuilds: [],
  baseAdmins: { userIds: [], roleIds: [] },
  botTokenSet: true,
  publicKeySet: true,
  interactionsEndpointUrl: 'https://example.amazonaws.com/discord',
};

describe('DiscordPage', () => {
  beforeEach(() => {
    apiMock.status.mockResolvedValue([]);
    apiMock.costsEstimate.mockResolvedValue({ games: {}, totalPerHourIfAllOn: 0 });
    apiMock.games.mockResolvedValue({ games: ['minecraft'] });
    apiMock.discordConfig.mockResolvedValue(REDACTED_CONFIG);
  });

  it('should render the Discord heading and the polling indicator wired to the status poll', async () => {
    renderPage(<DiscordPage />, { initialEntries: ['/discord'] });

    // Wait for the configured-state header to render — the early-load path
    // also has an h2 with the same text, so anchor on the description copy
    // that only appears once the redacted config has resolved.
    expect(await screen.findByText(/Slash-command bot configuration/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Discord' })).toBeInTheDocument();
    expect(await screen.findByText(/^Updated\b/)).toBeInTheDocument();
  });

  it('should render the configuration tabs once the redacted config resolves', async () => {
    renderPage(<DiscordPage />, { initialEntries: ['/discord'] });

    expect(await screen.findByRole('tab', { name: 'Credentials' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Guilds' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Admins' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Per-Game Permissions' })).toBeInTheDocument();
  });

  it('should show the unavailable-state copy when /api/discord/config rejects', async () => {
    apiMock.discordConfig.mockRejectedValue(new Error('boom'));
    renderPage(<DiscordPage />, { initialEntries: ['/discord'] });

    expect(await screen.findByText(/Discord config unavailable/i)).toBeInTheDocument();
  });

  it('should keep the polling indicator visible while /api/discord/config is loading', async () => {
    // Hold the discord-config response open so the page stays in its
    // loading state for the duration of the assertions.
    apiMock.discordConfig.mockReturnValue(new Promise(() => undefined));
    renderPage(<DiscordPage />, { initialEntries: ['/discord'] });

    // Loading copy is rendered, AND the indicator is wired to the (mocked)
    // status poll above so the operator can still see "Updated …".
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText(/^Updated\b/)).toBeInTheDocument();
  });
});
