import { useEffect, useState } from 'react';
import { useGameStatus } from './hooks/useGameStatus.js';
import { useFileManager } from './hooks/useFileManager.js';
import { GameCard } from './components/GameCard.js';
import { FileManagerModal } from './components/FileManagerModal.js';
import { CostPanel } from './components/CostPanel.js';
import { LogsPanel } from './components/LogsPanel.js';
import { WatchdogPanel } from './components/WatchdogPanel.js';
import { DiscordPanel } from './components/DiscordPanel.js';
import { ApiTokenModal } from './components/ApiTokenModal.js';
import { setUnauthorizedHandler } from './api.js';

/**
 * Root component. Wires up the 401 handler on `api.ts` and renders either the
 * token-prompt modal or the main dashboard. Deliberately tiny — all polling
 * and data-fetch logic lives in hooks so this component stays declarative.
 */
export default function App() {
  // Open the token modal only once the API actually rejects us with a 401.
  // In dev mode the server allows unauthenticated requests when no API_TOKEN
  // is configured, so defaulting to "needs token" would block local iteration
  // for no reason. The first failing /api request will flip this flag.
  const [needsToken, setNeedsToken] = useState(false);
  useEffect(() => {
    setUnauthorizedHandler(() => setNeedsToken(true));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (needsToken) return <ApiTokenModal />;

  return <Dashboard />;
}

function Dashboard() {
  const { statuses, estimates, loading, refreshGame } = useGameStatus();
  const fileMgr = useFileManager();

  const gameNames = statuses.map((s) => s.game);

  return (
    <>
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 1.5rem' }}>
        <header style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Game Server Manager</h1>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
            AWS Fargate · Auto-shutdown watchdog · Route 53 DNS
          </div>
        </header>

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

        {/* Bottom panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
          <CostPanel estimates={estimates} />
          <WatchdogPanel />
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
