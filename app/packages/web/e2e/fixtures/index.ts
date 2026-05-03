import { test as base, type Page } from '@playwright/test';
import type { GameStatus, CostEstimates, EnvInfo, ActionResult, WatchdogConfig } from '../../src/api.js';
import { ENV_DATA, STOPPED_GAME, COST_DATA, WATCHDOG_CONFIG } from './game-data.js';

export type { GameStatus, CostEstimates, EnvInfo, WatchdogConfig };
export { ENV_DATA, STOPPED_GAME, RUNNING_GAME, MULTI_GAME_STATUSES, COST_DATA, WATCHDOG_CONFIG } from './game-data.js';

/** Per-spec overrides for the default `/api/*` stubs registered by `stubApis`. */
export interface StubOptions {
  /** Game statuses returned by `GET /api/status`. Defaults to `[STOPPED_GAME]`. */
  statuses?: GameStatus[];
  /** Cost estimates returned by `GET /api/costs/estimate`. */
  costs?: CostEstimates;
  /** Env info returned by `GET /api/env`. */
  env?: EnvInfo;
  /** Watchdog config returned by `GET /api/config`. */
  config?: WatchdogConfig;
  /** Override for `POST /api/start/:game` response. */
  startResult?: ActionResult;
}

/**
 * Registers Playwright route intercepts for all `/api/*` endpoints used by the
 * dashboard. Call before `page.goto()` in each spec that needs a running UI.
 *
 * Playwright matches routes in REVERSE registration order (last-registered
 * wins), so we register the catch-all FIRST and the specific stubs after —
 * that way `/api/status` hits the specific handler, while `/api/anything-else`
 * falls through to the catch-all 404 so missing stubs surface as fast failures
 * instead of hangs.
 */
export async function stubApis(page: Page, opts: StubOptions = {}): Promise<void> {
  const statuses = opts.statuses ?? [STOPPED_GAME];
  const costs = opts.costs ?? COST_DATA;
  const env = opts.env ?? ENV_DATA;
  const config = opts.config ?? WATCHDOG_CONFIG;
  const startResult: ActionResult = opts.startResult ?? { success: true, message: 'Started' };

  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'not stubbed' } })
  );

  await page.route('**/api/env', (route) => route.fulfill({ json: env }));

  await page.route('**/api/status', (route) => route.fulfill({ json: statuses }));

  await page.route('**/api/status/*', (route) => {
    const game = new URL(route.request().url()).pathname.split('/').pop()!;
    const s = statuses.find((x) => x.game === game) ?? statuses[0];
    return route.fulfill({ json: s });
  });

  await page.route('**/api/costs/estimate', (route) => route.fulfill({ json: costs }));

  await page.route('**/api/config', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: { success: true, config } });
    }
    return route.fulfill({ json: config });
  });

  await page.route('**/api/start/*', (route) => route.fulfill({ json: startResult }));

  await page.route('**/api/stop/*', (route) =>
    route.fulfill({ json: { success: true, message: 'Stopped' } as ActionResult })
  );
}

type E2EFixtures = {
  /**
   * A page with `apiToken` pre-seeded in localStorage so every navigation
   * starts authenticated. Use this in all specs except auth-gate tests.
   */
  authedPage: Page;
};

export const test = base.extend<E2EFixtures>({
  authedPage: async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem('apiToken', 'test-token');
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
