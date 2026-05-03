import { test as base, expect, type Page } from '@playwright/test';
import type { GameStatus, CostEstimates, EnvInfo, ActionResult } from '../../src/api.js';
import { ENV_DATA, STOPPED_GAME, COST_DATA } from './game-data.js';

export type { GameStatus, CostEstimates, EnvInfo };
export { ENV_DATA, STOPPED_GAME, RUNNING_GAME, MULTI_GAME_STATUSES, COST_DATA } from './game-data.js';

export interface StubOptions {
  /** Game statuses returned by `GET /api/status`. Defaults to `[STOPPED_GAME]`. */
  statuses?: GameStatus[];
  /** Cost estimates returned by `GET /api/costs/estimate`. */
  costs?: CostEstimates;
  /** Env info returned by `GET /api/env`. */
  env?: EnvInfo;
  /** Override for `POST /api/start/:game` response. */
  startResult?: ActionResult;
}

/**
 * Registers Playwright route intercepts for all `/api/*` endpoints used by the
 * dashboard. Call before `page.goto()` in each spec that needs a running UI.
 *
 * Routes are registered most-specific first; the catch-all at the end returns
 * 404 for any endpoint not explicitly stubbed so specs fail fast rather than
 * hanging on unhandled requests.
 */
export async function stubApis(page: Page, opts: StubOptions = {}): Promise<void> {
  const statuses = opts.statuses ?? [STOPPED_GAME];
  const costs = opts.costs ?? COST_DATA;
  const env = opts.env ?? ENV_DATA;
  const startResult: ActionResult = opts.startResult ?? { success: true, message: 'Started' };

  await page.route('**/api/env', (route) => route.fulfill({ json: env }));

  await page.route('**/api/status', (route) => route.fulfill({ json: statuses }));

  await page.route('**/api/status/*', (route) => {
    const game = new URL(route.request().url()).pathname.split('/').pop()!;
    const s = statuses.find((x) => x.game === game) ?? statuses[0];
    return route.fulfill({ json: s });
  });

  await page.route('**/api/costs/estimate', (route) => route.fulfill({ json: costs }));

  await page.route('**/api/start/*', (route) => route.fulfill({ json: startResult }));

  await page.route('**/api/stop/*', (route) =>
    route.fulfill({ json: { success: true, message: 'Stopped' } as ActionResult })
  );

  // Catch-all: return 404 for any not-yet-stubbed endpoint so tests fail fast.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'not stubbed' } })
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
