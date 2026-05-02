import { PollingIndicator } from '../polling/PollingIndicator.js';

/**
 * Discord route (`/discord`) — placeholder for Discord settings view.
 * Content to be implemented in CoderCoco/game-server-deploy#62.
 */
export function DiscordPage() {
  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Discord Configuration</h2>
        <PollingIndicator />
      </div>
      <p className="text-muted-foreground">
        Discord bot settings, guild allowlist, and permissions will appear here.
        <br />
        <span className="text-sm">Issue CoderCoco/game-server-deploy#62</span>
      </p>
    </div>
  );
}
