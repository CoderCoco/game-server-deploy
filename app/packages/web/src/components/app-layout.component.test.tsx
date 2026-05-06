import { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveIndicator, RefreshAllButton } from './app-layout.component.js';
import { PollingProvider, usePollingActions } from '../polling/polling-provider.component.js';

/**
 * Mounts a child component that registers a poller in `useEffect` so the
 * surrounding render captures the resulting registry entry without
 * triggering a setState-during-render warning.
 */
function MountPoller({
  name,
  intervalMs,
  fn,
}: {
  name: string;
  intervalMs: number;
  fn: () => Promise<void>;
}) {
  const { register } = usePollingActions();
  useEffect(() => register(name, fn, intervalMs), [register, name, intervalMs, fn]);
  return null;
}

describe('AppLayout — RefreshAllButton', () => {
  it('should be disabled when the polling registry is empty', () => {
    render(
      <PollingProvider>
        <RefreshAllButton />
      </PollingProvider>,
    );

    expect(screen.getByRole('button', { name: 'Refresh all' })).toBeDisabled();
  });

  it('should fire every registered poller when clicked', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <PollingProvider>
        <MountPoller name="status" intervalMs={20_000} fn={fn} />
        <RefreshAllButton />
      </PollingProvider>,
    );

    // Let the registration's automatic first run complete so we can compare.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const before = fn.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Refresh all' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(fn.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('AppLayout — LiveIndicator', () => {
  it('should always render the LIVE label so the chrome is visible from first paint', () => {
    render(
      <PollingProvider>
        <LiveIndicator />
      </PollingProvider>,
    );

    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('should show a pulsing cyan dot once a registered poller has reported success', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PollingProvider>
        <MountPoller name="status" intervalMs={20_000} fn={fn} />
        <LiveIndicator />
      </PollingProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const dot = container.querySelector('div.rounded-full');
    expect(dot?.className).toMatch(/animate-pulse/);
    expect(dot?.className).toMatch(/var\(--color-cyan\)/);
  });
});
