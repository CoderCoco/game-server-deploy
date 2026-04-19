import { useState, useEffect, useCallback } from 'react';
import { api, type GameStatus, type CostEstimates } from '../api.js';

/**
 * Owns the dashboard's per-game status list plus the shared cost-estimate
 * payload. Does an initial parallel fetch of `/api/status` + `/api/costs/estimate`
 * and then polls both every 20 seconds. `refreshGame` is exposed for
 * after-action hits (Start/Stop) so a single card can re-fetch without
 * waiting for the next interval. The interval runs unconditionally — we
 * haven't bothered pausing it on tab-hidden since 20s cadence is cheap.
 */
export function useGameStatus() {
  const [statuses, setStatuses] = useState<GameStatus[]>([]);
  const [estimates, setEstimates] = useState<CostEstimates | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [s, e] = await Promise.all([api.status(), api.costsEstimate()]);
    setStatuses(s);
    setEstimates(e);
    setLoading(false);
  }, []);

  const refreshGame = useCallback(async (game: string) => {
    const s = await api.statusGame(game);
    setStatuses((prev) => prev.map((x) => (x.game === game ? s : x)));
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { statuses, estimates, loading, refresh, refreshGame };
}
