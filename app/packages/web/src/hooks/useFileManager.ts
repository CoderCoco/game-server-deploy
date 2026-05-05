import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FileMgrStatus } from '../api.js';
import { usePollingActions } from '../polling/PollingProvider.js';

/** Name under which the file-manager helper poll registers in the polling registry. */
export const FILE_MANAGER_POLLER = 'filemgr';
/** Reactive cadence while a helper task is starting or stopping. */
export const FILE_MANAGER_INTERVAL_MS = 5000;

/**
 * Manages the FileBrowser helper-task lifecycle for the file-manager modal.
 * Owns the currently-active game, the latest `FileMgrStatus`, and a user-facing
 * message, plus start/stop/close actions that drive `/api/files/:game/*`.
 *
 * Polling is reactive rather than interval-based: we register a 5-second
 * poller with the shared {@link PollingProvider} only while the helper task
 * is mid-transition (state `starting`, or after the operator clicked Stop
 * before ECS has actually transitioned the task out of `RUNNING`). That
 * makes the file-manager's progress visible to the LIVE indicator and the
 * top-bar Refresh button while still leaving no background polling once the
 * task has settled or the modal is closed.
 */
export function useFileManager() {
  const { register } = usePollingActions();
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [status, setStatus] = useState<FileMgrStatus | null>(null);
  const [message, setMessage] = useState('');
  // True between a successful Stop call and the helper actually transitioning
  // to `stopped`/`not_deployed`. ECS reports `running` for a few seconds after
  // a stop request, so without this flag the polling effect would unregister
  // immediately and the modal would stick on stale "running" status.
  const [pendingStop, setPendingStop] = useState(false);

  // Latest `activeGame` used inside the registered poller closure — keeps
  // the registration stable when the consumer toggles between games.
  const gameRef = useRef<string | null>(null);
  gameRef.current = activeGame;

  const fetchOnce = useCallback(async (game: string) => {
    const s = await api.filesMgrStatus(game);
    setStatus(s);
  }, []);

  const open = useCallback(
    (game: string) => {
      setActiveGame(game);
      setMessage('');
      setPendingStop(false);
      void fetchOnce(game);
    },
    [fetchOnce],
  );

  const close = useCallback(() => {
    setActiveGame(null);
    setStatus(null);
    setMessage('');
    setPendingStop(false);
  }, []);

  const start = useCallback(async () => {
    if (!activeGame) return;
    setMessage('Launching…');
    const result = await api.filesMgrStart(activeGame);
    setMessage(result.message);
    if (result.success) void fetchOnce(activeGame);
  }, [activeGame, fetchOnce]);

  const stop = useCallback(async () => {
    if (!activeGame) return;
    const result = await api.filesMgrStop(activeGame);
    setMessage(result.message);
    if (result.success) setPendingStop(true);
    void fetchOnce(activeGame);
  }, [activeGame, fetchOnce]);

  // Clear the pending-stop flag once the helper has actually stopped so the
  // poller below unregisters and we stop hitting `/api/files/:game`.
  useEffect(() => {
    if (status?.state === 'stopped' || status?.state === 'not_deployed') {
      setPendingStop(false);
    }
  }, [status?.state]);

  // Register the reactive poller only while the helper task is mid-transition
  // (starting, or stop-in-flight). Unregisters automatically when the state
  // settles or the modal closes — that keeps the polling registry honest
  // about which pollers are currently live.
  useEffect(() => {
    if (!activeGame) return;
    const transitioning = status?.state === 'starting' || pendingStop;
    if (!transitioning) return;
    return register(
      FILE_MANAGER_POLLER,
      async () => {
        const game = gameRef.current;
        if (!game) return;
        await fetchOnce(game);
      },
      FILE_MANAGER_INTERVAL_MS,
    );
  }, [register, activeGame, status?.state, pendingStop, fetchOnce]);

  return { activeGame, status, message, open, close, start, stop };
}
