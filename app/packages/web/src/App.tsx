import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { setUnauthorizedHandler } from './api.js';
import { ApiTokenModal } from './components/ApiTokenModal.js';
import { AppLayout } from './components/AppLayout.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { CostsPage } from './pages/CostsPage.js';
import { DiscordPage } from './pages/DiscordPage.js';
import { LogsPage } from './pages/LogsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { PollingProvider } from './polling/PollingProvider.js';
import { GameStatusProvider } from './polling/GameStatusProvider.js';

/**
 * Root component. Wires up the 401 handler on `api.ts` and renders either the
 * token-prompt modal or the routed dashboard shell. The shell has a persistent
 * layout (sidebar + top bar) and five routes:
 *   - `/` → Dashboard (game cards + panels)
 *   - `/costs` → Cost analysis placeholder
 *   - `/discord` → Discord settings placeholder
 *   - `/logs` → Logs placeholder
 *   - `/settings` → Watchdog + general settings
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

  return (
    <PollingProvider>
      <GameStatusProvider>
        <BrowserRouter>
          <AppLayout>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/costs" element={<CostsPage />} />
              <Route path="/discord" element={<DiscordPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </AppLayout>
        </BrowserRouter>
      </GameStatusProvider>
    </PollingProvider>
  );
}
