import { PollingIndicator } from '../polling/PollingIndicator.js';

/**
 * Logs route (`/logs`) — placeholder for centralized logs view.
 * Content to be implemented in CoderCoco/game-server-deploy#63.
 */
export function LogsPage() {
  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Server Logs</h2>
        <PollingIndicator />
      </div>
      <p className="text-muted-foreground">
        Centralized log viewer with filtering and search will appear here.
        <br />
        <span className="text-sm">Issue CoderCoco/game-server-deploy#63</span>
      </p>
    </div>
  );
}
