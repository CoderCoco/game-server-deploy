import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({
  status: vi.fn(),
  costsActual: vi.fn(),
  costsEstimate: vi.fn(),
}));
vi.mock('../api.js', () => ({ api: apiMock }));

import { CostsPage } from './CostsPage.js';
import { renderPage } from '../test-utils/renderPage.js';

const ESTIMATES = {
  games: {
    minecraft: { vcpu: 1, memoryGb: 2, costPerHour: 0.08, costPerDay24h: 1.92, costPerMonth4hpd: 9.6 },
    valheim:   { vcpu: 1, memoryGb: 2, costPerHour: 0.04, costPerDay24h: 0.96, costPerMonth4hpd: 4.8 },
  },
  totalPerHourIfAllOn: 0.12,
};

const ACTUAL = {
  daily: [
    { date: '2026-04-29', cost: 0.5 },
    { date: '2026-04-30', cost: 0.7 },
    { date: '2026-05-01', cost: 0.6 },
    { date: '2026-05-02', cost: 0.4 },
    { date: '2026-05-03', cost: 0.3 },
    { date: '2026-05-04', cost: 0.5 },
    { date: '2026-05-05', cost: 0.5 },
    // Halves of the doubled-window response — second half is the "current" window.
    { date: '2026-05-06', cost: 0.5 },
    { date: '2026-05-07', cost: 0.7 },
    { date: '2026-05-08', cost: 0.6 },
    { date: '2026-05-09', cost: 0.4 },
    { date: '2026-05-10', cost: 0.3 },
    { date: '2026-05-11', cost: 0.5 },
    { date: '2026-05-12', cost: 0.5 },
  ],
  total: 6.6,
  currency: 'USD',
  days: 14,
};

describe('CostsPage', () => {
  beforeEach(() => {
    apiMock.status.mockResolvedValue([]);
    apiMock.costsActual.mockResolvedValue(ACTUAL);
    apiMock.costsEstimate.mockResolvedValue(ESTIMATES);
  });

  it('should render the Cost Analysis heading and the polling indicator wired to the status poll', async () => {
    renderPage(<CostsPage />, { initialEntries: ['/costs'] });

    expect(screen.getByRole('heading', { name: 'Cost Analysis' })).toBeInTheDocument();
    // GameStatusProvider's `status` poller resolves and the indicator picks
    // up the "Updated …" label — no separate timer manipulation needed.
    expect(await screen.findByText(/^Updated\b/)).toBeInTheDocument();
  });

  it('should fetch the doubled actuals window for the active range', async () => {
    renderPage(<CostsPage />, { initialEntries: ['/costs'] });

    // Default range is 7d → costsActual(14) for current + prior split.
    await waitFor(() => expect(apiMock.costsActual).toHaveBeenCalledWith(14));
  });

  it('should render every configured game in the estimates table once the data resolves', async () => {
    renderPage(<CostsPage />, { initialEntries: ['/costs'] });

    expect(await screen.findByRole('cell', { name: 'minecraft' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'valheim' })).toBeInTheDocument();
  });
});
