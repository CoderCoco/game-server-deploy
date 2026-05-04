import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useGameStatus } from '../hooks/useGameStatus.js';
import { useFileManager } from '../hooks/useFileManager.js';
import { api, type ActualCosts } from '../api.js';
import { GameCard } from '../components/GameCard.js';
import { KpiStrip } from '../components/KpiStrip.js';
import { FileManagerModal } from '../components/FileManagerModal.js';
import { LogsPanel } from '../components/LogsPanel.js';
import { Input } from '@/components/ui/input';

/**
 * Dashboard route (`/`) — top KPI strip, then a search-filterable grid of
 * GameCards, then the logs panel (which will move to its own route in
 * CoderCoco/game-server-deploy#63). Cost analysis lives at `/costs`,
 * Discord settings at `/discord`, and the watchdog at `/settings`. The
 * search input narrows the grid by game name or hostname client-side.
 */
export function DashboardPage() {
  const { statuses, estimates, loading, refreshGame } = useGameStatus();
  const fileMgr = useFileManager();
  const [query, setQuery] = useState('');
  // Single Cost Explorer fetch shared with `KpiStrip` — Cost Explorer bills
  // per request, so don't double-call.
  const [actualCosts, setActualCosts] = useState<ActualCosts | null>(null);

  useEffect(() => {
    void api.costsActual().then(setActualCosts).catch(() => undefined);
  }, []);

  const gameNames = statuses.map((s) => s.game);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return statuses;
    return statuses.filter((s) => {
      const host = (s.hostname ?? s.publicIp ?? '').toLowerCase();
      return s.game.toLowerCase().includes(q) || host.includes(q);
    });
  }, [statuses, query]);

  return (
    <>
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* KPI strip */}
        <KpiStrip statuses={statuses} estimates={estimates} actualCosts={actualCosts} />

        {/* Search filter */}
        <div className="mb-4 relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-muted-foreground)] pointer-events-none" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by game or hostname…"
            className="pl-9"
            aria-label="Filter games"
          />
        </div>

        {/* Game cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
          {loading ? (
            <div className="col-span-full text-sm text-[var(--color-muted-foreground)] py-8 text-center">
              Loading servers…
            </div>
          ) : statuses.length === 0 ? (
            <div className="col-span-full text-sm text-[var(--color-muted-foreground)] py-8 text-center">
              No games configured. Run <code>terraform apply</code> first.
            </div>
          ) : visible.length === 0 ? (
            <div className="col-span-full text-sm text-[var(--color-muted-foreground)] py-8 text-center">
              No games match <span className="font-[var(--font-mono)]">&quot;{query}&quot;</span>.
            </div>
          ) : (
            visible.map((s) => (
              <GameCard
                key={s.game}
                status={s}
                estimate={estimates?.games[s.game]}
                onRefresh={refreshGame}
                onOpenFiles={fileMgr.open}
              />
            ))
          )}
        </div>

        {/* Logs panel */}
        {gameNames.length > 0 && <LogsPanel games={gameNames} />}
      </div>

      {/* File manager modal */}
      {fileMgr.activeGame && (
        <FileManagerModal
          game={fileMgr.activeGame}
          status={fileMgr.status}
          message={fileMgr.message}
          onClose={fileMgr.close}
          onStart={fileMgr.start}
          onStop={fileMgr.stop}
        />
      )}
    </>
  );
}
