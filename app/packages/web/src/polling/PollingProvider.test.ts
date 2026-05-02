import { describe, it, expect } from 'vitest';
import { isStale, STALE_MULTIPLIER, type PollerState } from './PollingProvider.js';

/** Build a minimal PollerState; tests override individual fields per case. */
function makeState(overrides: Partial<PollerState> = {}): PollerState {
  return {
    intervalMs: 20_000,
    lastSuccessAt: null,
    lastAttemptAt: null,
    loading: false,
    error: null,
    ...overrides,
  };
}

describe('isStale', () => {
  it('should return false when the poller state is undefined', () => {
    expect(isStale(undefined, 0)).toBe(false);
  });

  it('should return false before the first attempt has even fired', () => {
    expect(isStale(makeState(), 60_000)).toBe(false);
  });

  it('should return false when a recent success is within the interval window', () => {
    const now = 100_000;
    const state = makeState({ lastSuccessAt: now - 5_000 });
    expect(isStale(state, now)).toBe(false);
  });

  it('should not consider a poller stale exactly at the 2x interval boundary', () => {
    const now = 100_000;
    const state = makeState({ lastSuccessAt: now - STALE_MULTIPLIER * 20_000 });
    expect(isStale(state, now)).toBe(false);
  });

  it('should mark a poller stale once 2x the interval has elapsed without success', () => {
    const now = 100_000;
    const state = makeState({ lastSuccessAt: now - (STALE_MULTIPLIER * 20_000 + 1) });
    expect(isStale(state, now)).toBe(true);
  });

  it('should mark a never-succeeded poller stale only once 2x the interval has elapsed since first attempt', () => {
    const now = 100_000;
    const justAttempted = makeState({ lastAttemptAt: now - 5_000 });
    expect(isStale(justAttempted, now)).toBe(false);

    const longSilent = makeState({ lastAttemptAt: now - (STALE_MULTIPLIER * 20_000 + 1) });
    expect(isStale(longSilent, now)).toBe(true);
  });
});
