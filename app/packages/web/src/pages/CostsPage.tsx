import { PollingIndicator } from '../polling/PollingIndicator.js';

/**
 * Costs route (`/costs`) — placeholder for cost analysis view.
 * Content to be implemented in CoderCoco/game-server-deploy#61.
 */
export function CostsPage() {
  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Cost Analysis</h2>
        <PollingIndicator />
      </div>
      <p className="text-muted-foreground">
        Cost breakdown and spending trends will appear here.
        <br />
        <span className="text-sm">Issue CoderCoco/game-server-deploy#61</span>
      </p>
    </div>
  );
}
