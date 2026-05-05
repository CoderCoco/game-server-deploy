import { useEffect } from 'react';
import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PollingIndicator } from './PollingIndicator.js';
import { PollingProvider, usePollingActions } from './PollingProvider.js';

/**
 * Mounts a child component that registers a poller under `name` with the
 * given interval, so the indicator has an entry to render against. Runs the
 * registration in `useEffect` to avoid a setState-during-render warning.
 */
function PollerSeed({ name, intervalMs }: { name: string; intervalMs: number }) {
  const { register } = usePollingActions();
  useEffect(
    () => register(name, () => Promise.resolve(), intervalMs),
    [register, name, intervalMs],
  );
  return null;
}

/**
 * Wait for any registered poller's `runOne` to finish. The provider's
 * `register()` immediately schedules `runOne` which runs through two
 * microtasks (set loading, await fn, set lastSuccessAt), so we flush a
 * couple of times before asserting the result.
 */
async function flushPolls() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PollingIndicator', () => {
  it('should render the "Not polling" placeholder when no poller is registered under the name', () => {
    render(
      <PollingProvider>
        <PollingIndicator name="missing" />
      </PollingProvider>,
    );

    expect(screen.getByText('Not polling')).toBeInTheDocument();
  });

  it('should render an "Updated …" label once a registered poller has resolved', async () => {
    render(
      <PollingProvider>
        <PollerSeed name="status" intervalMs={20_000} />
        <PollingIndicator />
      </PollingProvider>,
    );

    await flushPolls();

    expect(screen.getByText(/^Updated\b/)).toBeInTheDocument();
  });

  it('should expose the next-poll countdown via the tooltip on hover', async () => {
    const user = userEvent.setup();
    render(
      <PollingProvider>
        <PollerSeed name="status" intervalMs={20_000} />
        <PollingIndicator />
      </PollingProvider>,
    );

    await flushPolls();

    await user.hover(screen.getByText(/^Updated\b/));

    // Radix renders the tooltip body twice (visual bubble + screen-reader
    // copy), so we accept any number of matches.
    expect((await screen.findAllByText(/next refresh in \d+s/)).length).toBeGreaterThan(0);
  });
});
