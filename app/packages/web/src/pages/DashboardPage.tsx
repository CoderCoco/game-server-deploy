import { useGameStatus } from '../hooks/useGameStatus.js';
import { useFileManager } from '../hooks/useFileManager.js';
import { GameCard } from '../components/GameCard.js';
import { FileManagerModal } from '../components/FileManagerModal.js';
import { CostPanel } from '../components/CostPanel.js';
import { DiscordPanel } from '../components/DiscordPanel.js';

/**
 * Dashboard route (`/`) — game cards + KPI strip + Discord panel.
 * This is a transitional state; panels will move to dedicated routes in
 * subsequent issues (CoderCoco/game-server-deploy#61, #62). Watchdog now
 * lives on `/settings`; the live log tail has moved to `/logs`.
 */
export function DashboardPage() {
  const { statuses, estimates, loading, refreshGame } = useGameStatus();
  const fileMgr = useFileManager();

  const gameNames = statuses.map((s) => s.game);

  return (
    <>
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Game cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
          {loading ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
              Loading servers…
            </div>
          ) : statuses.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
              No games configured. Run <code>terraform apply</code> first.
            </div>
          ) : (
            statuses.map((s) => (
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

        {/* Bottom panels — cost only (watchdog moved to /settings, logs to /logs) */}
        <div style={{ marginBottom: '1.25rem' }}>
          <CostPanel estimates={estimates} />
        </div>

        {/* Discord bot panel */}
        <DiscordPanel games={gameNames} />
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
