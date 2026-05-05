import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Per-poller state exposed through the context. Times are absolute ms epoch
 * (`Date.now()`) so consumers can render "X seconds ago" without juggling
 * different clocks.
 */
export interface PollerState {
  intervalMs: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  loading: boolean;
  error: Error | null;
}

interface PollingContextValue {
  pollers: Record<string, PollerState>;
  /** Register a poller under `name`. Returns the unregister function. */
  register: (name: string, fn: () => Promise<void>, intervalMs: number) => () => void;
  /** Trigger one named poller immediately (e.g. after a Start/Stop action). */
  refresh: (name: string) => Promise<void>;
  /** Trigger every registered poller in parallel — used by the top-bar Refresh button. */
  refreshAll: () => Promise<void>;
  /** Heartbeat counter that ticks every second so consumers can re-render relative timestamps. */
  tick: number;
}

const PollingCtx = createContext<PollingContextValue | null>(null);

/** A poller is considered stale once it has missed two intervals without success. */
export const STALE_MULTIPLIER = 2;

/**
 * Provides a registry of named pollers so any route can subscribe to the same
 * polling state. Keeps timers in a ref keyed by name; `pollers` is React state
 * so the indicator and LIVE badge re-render on every result.
 *
 * Designed to live near the top of the tree (above the router) so polling
 * persists across route changes.
 */
export function PollingProvider({ children }: { children: ReactNode }) {
  const [pollers, setPollers] = useState<Record<string, PollerState>>({});
  const fnsRef = useRef<
    Record<
      string,
      {
        fn: () => Promise<void>;
        intervalMs: number;
        timerId: ReturnType<typeof setInterval>;
        /** True while a fetch is in flight; guards against concurrent runs of the same poller. */
        inFlight: boolean;
      }
    >
  >({});

  /**
   * Run a single poller by name and write the result back into state.
   * Skips silently if a previous call is still in flight — that prevents a
   * slow response + manual Refresh + auto-tick from stacking concurrent
   * fetches. Also resets the poller's interval timer so the next automatic
   * poll lands `intervalMs` after this attempt (whether triggered by the
   * timer or by a manual `refresh()` / `refreshAll()`), keeping the
   * indicator's "next refresh in X" tooltip accurate.
   *
   * Swallows errors into the per-poller `error` field so a thrown poller
   * doesn't crash the rest of the app.
   */
  const runOne = useCallback(async (name: string) => {
    const entry = fnsRef.current[name];
    if (!entry || entry.inFlight) return;
    entry.inFlight = true;
    clearInterval(entry.timerId);
    entry.timerId = setInterval(() => void runOne(name), entry.intervalMs);
    setPollers((p) => {
      const prev = p[name];
      if (!prev) return p;
      return { ...p, [name]: { ...prev, loading: true, lastAttemptAt: Date.now() } };
    });
    try {
      await entry.fn();
      setPollers((p) => {
        const prev = p[name];
        if (!prev) return p;
        return { ...p, [name]: { ...prev, loading: false, lastSuccessAt: Date.now(), error: null } };
      });
    } catch (err) {
      setPollers((p) => {
        const prev = p[name];
        if (!prev) return p;
        return { ...p, [name]: { ...prev, loading: false, error: err as Error } };
      });
    } finally {
      const cur = fnsRef.current[name];
      if (cur) cur.inFlight = false;
    }
  }, []);

  const register = useCallback(
    (name: string, fn: () => Promise<void>, intervalMs: number): (() => void) => {
      // Replace any prior registration under the same name (component remount or
      // interval change). Clear the old timer so we don't double-fire.
      const previous = fnsRef.current[name];
      if (previous) clearInterval(previous.timerId);

      const timerId = setInterval(() => void runOne(name), intervalMs);
      fnsRef.current[name] = { fn, intervalMs, timerId, inFlight: false };

      setPollers((p) => ({
        ...p,
        [name]: {
          intervalMs,
          lastSuccessAt: p[name]?.lastSuccessAt ?? null,
          lastAttemptAt: p[name]?.lastAttemptAt ?? null,
          loading: false,
          error: null,
        },
      }));

      void runOne(name);

      return () => {
        const cur = fnsRef.current[name];
        if (cur && cur.timerId === timerId) {
          clearInterval(cur.timerId);
          delete fnsRef.current[name];
          setPollers((p) => {
            if (!(name in p)) return p;
            const next = { ...p };
            delete next[name];
            return next;
          });
        }
      };
    },
    [runOne],
  );

  const refresh = useCallback(
    async (name: string) => {
      await runOne(name);
    },
    [runOne],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all(Object.keys(fnsRef.current).map((n) => runOne(n)));
  }, [runOne]);

  // Heartbeat: forces re-render every second so "Updated 3s ago" labels and
  // the stale check stay current without each consumer running its own timer.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Clean up all timers on unmount (e.g. HMR or navigation away from the SPA root).
  useEffect(
    () => () => {
      for (const entry of Object.values(fnsRef.current)) {
        clearInterval(entry.timerId);
      }
      fnsRef.current = {};
    },
    [],
  );

  const value = useMemo<PollingContextValue>(
    () => ({ pollers, register, refresh, refreshAll, tick }),
    [pollers, register, refresh, refreshAll, tick],
  );

  return <PollingCtx.Provider value={value}>{children}</PollingCtx.Provider>;
}

/** Read the polling registry from inside the provider tree. */
export function usePollingContext(): PollingContextValue {
  const v = useContext(PollingCtx);
  if (!v) throw new Error('usePollingContext must be used inside <PollingProvider>');
  return v;
}

/**
 * Subscribe a function to the shared polling registry. The latest `fn` is
 * captured via a ref so consumers can pass closures without thrashing the
 * registration. Re-registers when `name` or `intervalMs` change.
 */
export function usePoller(
  name: string,
  fn: () => Promise<void>,
  intervalMs: number,
  enabled = true,
): { state: PollerState | undefined; refresh: () => Promise<void> } {
  const ctx = usePollingContext();
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // Pull the stable callbacks out of `ctx` so the effects below don't re-fire
  // every time the provider's `pollers` map or `tick` changes — the whole
  // context value is re-memoized on each heartbeat, but `register` and
  // `refresh` are wrapped in `useCallback` and have stable identity.
  const { register, refresh: refreshCtx } = ctx;

  useEffect(() => {
    if (!enabled) return;
    return register(name, () => fnRef.current(), intervalMs);
  }, [register, name, intervalMs, enabled]);

  const refresh = useCallback(() => refreshCtx(name), [refreshCtx, name]);

  return {
    state: ctx.pollers[name],
    refresh,
  };
}

/** True iff `state` has gone longer than `STALE_MULTIPLIER × intervalMs` without a successful poll. */
export function isStale(state: PollerState | undefined, now: number = Date.now()): boolean {
  if (!state) return false;
  if (state.lastSuccessAt === null) {
    // Never succeeded — treat as stale once we've waited 2× the interval.
    if (state.lastAttemptAt === null) return false;
    return now - state.lastAttemptAt > STALE_MULTIPLIER * state.intervalMs;
  }
  return now - state.lastSuccessAt > STALE_MULTIPLIER * state.intervalMs;
}
