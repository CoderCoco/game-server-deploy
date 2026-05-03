import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useGameStatus } from '../hooks/useGameStatus.js';
import { useFileManager } from '../hooks/useFileManager.js';
import { api, type ActualCosts } from '../api.js';
import { GameCard } from '../components/GameCard.js';
import { KpiStrip } from '../components/KpiStrip.js';
import { FileManagerModal } from '../components/FileManagerModal.js';
import { CostPanel } from '../components/CostPanel.js';
import { DiscordPanel } from '../components/DiscordPanel.js';
import { LogsPanel } from '../components/LogsPanel.js';
import { Input } from '@/components/ui/input';

/**
 * Dashboard route (`/`) — top KPI strip, then a search-filterable grid of
 * GameCards, then the legacy cost / Discord / logs panels (still here until
 * they move to their own routes in CoderCoco/game-server-deploy#61–63). The
 * search input narrows the grid by game name or hostname client-side; the
 * panels below the grid always show all games.
 */
export function DashboardPage() {
  const { statuses, estimates, loading, refreshGame } = useGameStatus();
  const fileMgr = useFileManager();
  const [query, setQuery] = useState('');
  // Single Cost Explorer fetch shared by KpiStrip + CostPanel — Cost Explorer
  // bills per request, so don't double-call.
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

        {/* Bottom panels — cost only (watchdog moved to /settings) */}
        <div className="mb-5">
          <CostPanel estimates={estimates} actual={actualCosts} />
        </div>

        {/* Discord bot panel */}
        <DiscordPanel games={gameNames} />

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
