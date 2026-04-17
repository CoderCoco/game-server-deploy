import { useState } from 'react';
import { api, type GameStatus, type GameEstimate } from '../api.js';

interface Props {
  status: GameStatus;
  estimate?: GameEstimate;
  onRefresh: (game: string) => void;
  onOpenFiles: (game: string) => void;
}

const STATE_LABELS: Record<string, string> = {
  running: 'Online',
  starting: 'Starting…',
  stopped: 'Offline',
  not_deployed: 'Not Deployed',
  error: 'Error',
};

export function GameCard({ status, estimate, onRefresh, onOpenFiles }: Props) {
  const { game, state } = status;
  const [busy, setBusy] = useState(false);

  const canStart = state === 'stopped' || state === 'not_deployed';
  const canStop = state === 'running' || state === 'starting';

  async function handleStart() {
    setBusy(true);
    await api.start(game);
    setTimeout(() => { void onRefresh(game); setBusy(false); }, 3000);
  }

  async function handleStop() {
    setBusy(true);
    await api.stop(game);
    setTimeout(() => { void onRefresh(game); setBusy(false); }, 3000);
  }

  const connectStr = status.hostname ?? status.publicIp ?? null;

  return (
    <div className={`game-card ${state}`} style={cardStyle}>
      <div style={headerStyle}>
        <span className={`status-dot ${state}`} style={dotStyle(state)} />
        <span style={{ fontWeight: 600, fontSize: '1rem', textTransform: 'capitalize' }}>{game}</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          {STATE_LABELS[state] ?? state}
        </span>
      </div>

      <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--green)', minHeight: '1.2rem', marginBottom: '0.75rem' }}>
        {connectStr && (
          <>
            {connectStr}
            <button className="btn-secondary btn-sm" style={{ marginLeft: '0.4rem', fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}
              onClick={() => void navigator.clipboard.writeText(connectStr)}>
              copy
            </button>
            {status.publicIp && status.hostname && (
              <span style={{ color: 'var(--text-dim)', marginLeft: '0.3rem' }}>({status.publicIp})</span>
            )}
          </>
        )}
      </div>

      {estimate && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '1rem' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 500 }}>${estimate.costPerHour}/hr</span>
          {' · '}~${estimate.costPerMonth4hpd}/mo at 4 hrs/day
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const }}>
        <button className="btn-start btn-sm" onClick={() => void handleStart()} disabled={!canStart || busy}>
          Start
        </button>
        <button className="btn-stop btn-sm" onClick={() => void handleStop()} disabled={!canStop || busy}>
          Stop
        </button>
        <button className="btn-secondary btn-sm" onClick={() => onOpenFiles(game)}>
          Files
        </button>
        <button className="btn-secondary btn-sm" onClick={() => onRefresh(game)}>↻</button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '1.25rem',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  marginBottom: '1rem',
};

function dotStyle(state: string): React.CSSProperties {
  const colors: Record<string, string> = {
    running: 'var(--green)',
    starting: 'var(--yellow)',
    stopped: 'var(--red)',
    not_deployed: 'var(--yellow)',
    error: 'var(--red)',
  };
  return {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: colors[state] ?? 'var(--text-dim)',
    flexShrink: 0,
    boxShadow: state === 'running' ? `0 0 6px var(--green)` : undefined,
  };
}
