import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type FileMgrStatus } from '../api.js';

/**
 * Manages the FileBrowser helper-task lifecycle for the file-manager modal.
 * Owns the currently-active game, the latest `FileMgrStatus`, and a user-facing
 * message, plus start/stop/close actions that drive `/api/files/:game/*`.
 *
 * Polling is reactive rather than interval-based: while the task is `starting`
 * we chain `setTimeout`s (5s) until it reaches `running` or the modal closes,
 * so there's no background polling when nothing is in flight.
 */
export function useFileManager() {
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [status, setStatus] = useState<FileMgrStatus | null>(null);
  const [message, setMessage] = useState('');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  };

  const poll = useCallback(async (game: string) => {
    const s = await api.filesMgrStatus(game);
    setStatus(s);
    if (s.state === 'starting') {
      pollRef.current = setTimeout(() => void poll(game), 5000);
    }
  }, []);

  const open = useCallback(
    (game: string) => {
      clearPoll();
      setActiveGame(game);
      setMessage('');
      void poll(game);
    },
    [poll],
  );

  const close = useCallback(() => {
    clearPoll();
    setActiveGame(null);
    setStatus(null);
    setMessage('');
  }, []);

  const start = useCallback(async () => {
    if (!activeGame) return;
    setMessage('Launching…');
    const result = await api.filesMgrStart(activeGame);
    setMessage(result.message);
    if (result.success) {
      pollRef.current = setTimeout(() => void poll(activeGame), 5000);
    }
  }, [activeGame, poll]);

  const stop = useCallback(async () => {
    if (!activeGame) return;
    const result = await api.filesMgrStop(activeGame);
    setMessage(result.message);
    pollRef.current = setTimeout(() => void poll(activeGame), 3000);
  }, [activeGame, poll]);

  useEffect(() => () => clearPoll(), []);

  return { activeGame, status, message, open, close, start, stop };
}
