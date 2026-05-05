import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({
  status: vi.fn(),
  statusGame: vi.fn(),
  costsEstimate: vi.fn(),
}));
vi.mock('../api.service.js', () => ({ api: apiMock }));

import { PollingProvider } from './polling-provider.component.js';
import { GameStatusProvider, useGameStatus } from './game-status-provider.component.js';

const STOPPED = { game: 'minecraft', state: 'stopped' as const };
const ESTIMATES = {
  games: {
    minecraft: { vcpu: 1, memoryGb: 2, costPerHour: 0.08, costPerDay24h: 1.92, costPerMonth4hpd: 9.6 },
  },
  totalPerHourIfAllOn: 0.08,
};

/** Minimal probe that exposes the provider's state via the DOM for assertions. */
function StatusProbe() {
  const { statuses, estimates, loading } = useGameStatus();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="count">{statuses.length}</div>
      <div data-testid="game">{statuses[0]?.game ?? '-'}</div>
      <div data-testid="hourly">{estimates ? String(estimates.totalPerHourIfAllOn) : '-'}</div>
    </div>
  );
}

describe('GameStatusProvider', () => {
  beforeEach(() => {
    apiMock.status.mockResolvedValue([STOPPED]);
    apiMock.costsEstimate.mockResolvedValue(ESTIMATES);
  });

  it('should fetch status on mount and expose it through useGameStatus', async () => {
    render(
      <PollingProvider>
        <GameStatusProvider>
          <StatusProbe />
        </GameStatusProvider>
      </PollingProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiMock.status).toHaveBeenCalled();
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('game')).toHaveTextContent('minecraft');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('should fetch cost estimates exactly once on mount, not on every poll tick', async () => {
    render(
      <PollingProvider>
        <GameStatusProvider>
          <StatusProbe />
        </GameStatusProvider>
      </PollingProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiMock.costsEstimate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('hourly')).toHaveTextContent('0.08');
  });

  it('should throw a clear error when useGameStatus is read outside the provider', () => {
    // Suppress the intentional "consumer outside provider" exception React logs.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(<StatusProbe />)).toThrow(
        /useGameStatus must be used inside <GameStatusProvider>/,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
