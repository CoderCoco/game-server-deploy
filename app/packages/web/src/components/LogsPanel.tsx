import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

interface Props {
  games: string[];
}

/**
 * Bottom-of-dashboard panel that tails CloudWatch logs for the currently-selected
 * game. Fetches a fixed number of recent lines from `/api/logs/:game` on game
 * change and on explicit refresh; auto-scrolls to the newest entry.
 */
export function LogsPanel({ games }: Props) {
  const [selectedGame, setSelectedGame] = useState<string>('');
  const [lines, setLines] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async (game: string) => {
    if (!game) return;
    const data = await api.logs(game);
    setLines(data.lines);
  };

  useEffect(() => {
    if (games.length && !selectedGame) setSelectedGame(games[0]!);
  }, [games, selectedGame]);

  useEffect(() => {
    if (selectedGame) void fetchLogs(selectedGame);
  }, [selectedGame]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines]);

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem' }}>
      <h2 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: '1rem' }}>
        Server Logs
      </h2>
      <div style={{ marginBottom: '0.6rem' }}>
        <select
          value={selectedGame}
          onChange={(e) => setSelectedGame(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '0.82rem', padding: '0.35rem 0.6rem' }}
        >
          {games.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div
        ref={boxRef}
        style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.6rem', maxHeight: '200px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.7, color: 'var(--text-dim)' }}
      >
        {lines.length
          ? lines.map((l, i) => <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{l}</div>)
          : <div>Select a game above…</div>
        }
      </div>
      <div style={{ marginTop: '0.6rem' }}>
        <button className="btn-secondary btn-sm" onClick={() => void fetchLogs(selectedGame)}>
          Refresh Logs
        </button>
      </div>
    </div>
  );
}
