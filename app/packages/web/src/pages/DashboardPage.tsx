import { useGameStatus } from '../hooks/useGameStatus.js';
import { useFileManager } from '../hooks/useFileManager.js';
import { GameCard } from '../components/GameCard.js';
import { FileManagerModal } from '../components/FileManagerModal.js';
import { CostPanel } from '../components/CostPanel.js';
import { LogsPanel } from '../components/LogsPanel.js';

/**
 * Dashboard route (`/`) — game cards + cost panel + logs.
 * This is a transitional state; the cost panel will move to `/costs`
 * in CoderCoco/game-server-deploy#61, and logs to `/logs` in #63. Discord
 * settings moved to `/discord` in #62; the watchdog panel moved to `/settings`.
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

        {/* Bottom panels — cost only (watchdog moved to /settings, Discord to /discord) */}
        <div style={{ marginBottom: '1.25rem' }}>
          <CostPanel estimates={estimates} />
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
