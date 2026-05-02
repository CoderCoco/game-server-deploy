import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, type GameStatus, type CostEstimates } from '../api.js';
import { usePoller } from './PollingProvider.js';

/** Name under which the dashboard status poller is registered. */
export const GAME_STATUS_POLLER = 'status';
/** 20-second cadence to match the previous in-hook interval. */
export const GAME_STATUS_INTERVAL_MS = 20_000;

interface GameStatusContextValue {
  statuses: GameStatus[];
  estimates: CostEstimates | null;
  loading: boolean;
  /** Re-fetch every game (used after starts/stops if the caller wants the whole grid). */
  refresh: () => Promise<void>;
  /** Re-fetch a single game's status — used by `GameCard` after Start/Stop. */
  refreshGame: (game: string) => Promise<void>;
}

const GameStatusCtx = createContext<GameStatusContextValue | null>(null);

/**
 * Top-level provider for the dashboard's status + cost-estimate state. Lives
 * above the router so polling continues even when the user navigates to /logs
 * or /settings — that means the LIVE indicator and PollingIndicator stay
 * accurate on every primary route.
 *
 * Internally registers a `status` poller with the shared polling registry so
 * the top-bar Refresh button can trigger it alongside any other active poll.
 */
export function GameStatusProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<GameStatus[]>([]);
  const [estimates, setEstimates] = useState<CostEstimates | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const [s, e] = await Promise.all([api.status(), api.costsEstimate()]);
    setStatuses(s);
    setEstimates(e);
    setLoading(false);
  }, []);

  const { refresh } = usePoller(GAME_STATUS_POLLER, fetchAll, GAME_STATUS_INTERVAL_MS);

  const refreshGame = useCallback(async (game: string) => {
    const s = await api.statusGame(game);
    setStatuses((prev) => prev.map((x) => (x.game === game ? s : x)));
  }, []);

  const value = useMemo<GameStatusContextValue>(
    () => ({ statuses, estimates, loading, refresh, refreshGame }),
    [statuses, estimates, loading, refresh, refreshGame],
  );

  return <GameStatusCtx.Provider value={value}>{children}</GameStatusCtx.Provider>;
}

/**
 * Read the shared dashboard status state. Drop-in replacement for the previous
 * `useGameStatus` hook — same return shape, but the polling lifecycle now lives
 * in `GameStatusProvider` so multiple routes can subscribe without duplicate
 * fetches.
 */
export function useGameStatus(): GameStatusContextValue {
  const v = useContext(GameStatusCtx);
  if (!v) throw new Error('useGameStatus must be used inside <GameStatusProvider>');
  return v;
}
