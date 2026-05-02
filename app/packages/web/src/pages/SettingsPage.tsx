import { WatchdogPanel } from '../components/WatchdogPanel.js';

/**
 * Settings route (`/settings`) — watchdog config + general settings skeleton.
 * Per the issue spec, the watchdog panel moves here from the dashboard.
 */
export function SettingsPage() {
  return (
    <div className="max-w-5xl mx-auto p-8">
      <h2 className="text-2xl font-semibold mb-6">Settings</h2>

      {/* Watchdog section */}
      <div className="mb-8">
        <h3 className="text-lg font-medium mb-4">Watchdog Configuration</h3>
        <WatchdogPanel />
      </div>

      {/* General settings placeholder */}
      <div>
        <h3 className="text-lg font-medium mb-4">General</h3>
        <p className="text-muted-foreground text-sm">
          Additional configuration options will appear here in future updates.
        </p>
      </div>
    </div>
  );
}
