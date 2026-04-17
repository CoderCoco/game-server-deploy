import { useState, useEffect, useCallback } from 'react';
import { api, type GameStatus, type CostEstimates } from '../api.js';

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
