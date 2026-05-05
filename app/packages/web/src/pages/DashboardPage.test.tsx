import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMock = vi.hoisted(() => ({
  status: vi.fn(),
  statusGame: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  costsEstimate: vi.fn(),
  costsActual: vi.fn(),
  filesMgrStatus: vi.fn(),
  filesMgrStart: vi.fn(),
  filesMgrStop: vi.fn(),
}));
vi.mock('../api.js', () => ({ api: apiMock }));

import { DashboardPage } from './DashboardPage.js';
import { renderPage } from '../test-utils/renderPage.js';

const STATUSES = [
  { game: 'minecraft', state: 'stopped' as const },
  { game: 'valheim', state: 'running' as const, publicIp: '1.2.3.4' },
];

const ESTIMATES = {
  games: {
    minecraft: { vcpu: 1, memoryGb: 2, costPerHour: 0.08, costPerDay24h: 1.92, costPerMonth4hpd: 9.6 },
    valheim:   { vcpu: 1, memoryGb: 2, costPerHour: 0.04, costPerDay24h: 0.96, costPerMonth4hpd: 4.8 },
  },
  totalPerHourIfAllOn: 0.12,
};

describe('DashboardPage', () => {
  beforeEach(() => {
    apiMock.status.mockResolvedValue(STATUSES);
    apiMock.costsEstimate.mockResolvedValue(ESTIMATES);
    apiMock.costsActual.mockResolvedValue({ daily: [], total: 0, currency: 'USD', days: 7 });
  });

  it('should render the polling indicator wired to the status poll alongside the search filter', async () => {
    renderPage(<DashboardPage />);

    expect(screen.getByLabelText('Filter games')).toBeInTheDocument();
    expect(await screen.findByText(/^Updated\b/)).toBeInTheDocument();
  });

  it('should render a card for every game returned by /api/status', async () => {
    renderPage(<DashboardPage />);

    expect(await screen.findByRole('heading', { name: 'minecraft' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'valheim' })).toBeInTheDocument();
  });

  it('should narrow the visible cards by the search filter without removing the indicator', async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />);

    await screen.findByRole('heading', { name: 'minecraft' });

    await user.type(screen.getByLabelText('Filter games'), 'valheim');

    expect(screen.queryByRole('heading', { name: 'minecraft' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'valheim' })).toBeInTheDocument();
    // The polling indicator lives next to the search input — it should survive
    // the filter typing because it reads from the persistent registry, not
    // from the filtered grid below.
    expect(screen.getByText(/^Updated\b/)).toBeInTheDocument();
  });
});
