import { useState, useEffect, useRef, useCallback } from 'react';
import { api, getStoredApiToken } from '../api.js';

const MAX_LINES = 1000;

interface Props {
  games: string[];
}

/**
 * Bottom-of-dashboard panel that tails CloudWatch logs for the selected game.
 * On game change it fetches a snapshot of recent lines, then opens an SSE
 * stream (`/api/logs/:game/stream`) to append new events as they arrive.
 * The auth token is passed as `?token=` because the browser's native
 * `EventSource` cannot set custom headers.
 *
 * Pause buffers incoming lines without scrolling; Resume flushes the buffer.
 * Lines are capped at MAX_LINES to keep the DOM light.
 */
export function LogsPanel({ games }: Props) {
  const [selectedGame, setSelectedGame] = useState<string>('');
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const pausedRef = useRef(false);
  const bufferRef = useRef<string[]>([]);

  const appendLine = useCallback((line: string) => {
    if (pausedRef.current) {
      bufferRef.current.push(line);
      return;
    }
    setLines((prev) => {
      const next = [...prev, line];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  const stopStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const startStream = useCallback(
    (game: string) => {
      stopStream();
      const token = getStoredApiToken();
      const url = `/api/logs/${game}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const es = new EventSource(url);

      es.onmessage = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as { line: string };
          appendLine(data.line);
        } catch {
          // ignore malformed events
        }
      };

      esRef.current = es;
    },
    [stopStream, appendLine],
  );

  const handlePauseToggle = useCallback(() => {
    const nowPaused = !pausedRef.current;
    pausedRef.current = nowPaused;
    setPaused(nowPaused);
    if (!nowPaused && bufferRef.current.length > 0) {
      const buffered = bufferRef.current;
      bufferRef.current = [];
      setLines((prev) => {
        const next = [...prev, ...buffered];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    }
  }, []);

  useEffect(() => {
    if (games.length && !selectedGame) setSelectedGame(games[0]!);
  }, [games, selectedGame]);

  useEffect(() => {
    if (!selectedGame) return;
    setLines([]);
    bufferRef.current = [];
    pausedRef.current = false;
    setPaused(false);

    let cancelled = false;
    void (async () => {
      try {
        const data = await api.logs(selectedGame);
        if (cancelled) return;
        setLines(data.lines);
        startStream(selectedGame);
      } catch {
        if (!cancelled) startStream(selectedGame);
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [selectedGame, startStream, stopStream]);

  // Auto-scroll to bottom when new lines arrive and not paused
  useEffect(() => {
    if (!paused && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lines, paused]);

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
        <button className="btn-secondary btn-sm" onClick={handlePauseToggle}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
    </div>
  );
}
