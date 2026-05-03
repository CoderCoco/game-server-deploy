import { test, expect } from '@playwright/test';
import { stubApis, ENV_DATA, COST_DATA } from '../fixtures/index.js';

/**
 * Auth-gate specs use the base Playwright `test` (no pre-seeded token) so
 * they can verify the 401 → modal and token-save → reload flows in isolation.
 */

test.describe('auth gate', () => {
  test('should show token modal when API returns 401', async ({ page }) => {
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 401, body: 'Unauthorized' })
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'API token required' })).toBeVisible();
  });

  test('should load dashboard when valid token is already stored', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('apiToken', 'test-token');
    });
    await stubApis(page, { statuses: [] });
    await page.goto('/');
    // Top-bar heading is the dashboard shell; modal should not appear.
    await expect(page.getByRole('heading', { name: 'Game Server Manager' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'API token required' })).not.toBeVisible();
  });

  test('should save token and show dashboard after reload', async ({ page }) => {
    // Playwright matches routes in REVERSE registration order, so register the
    // catch-all 404 FIRST and the specific 401/200 handlers after — otherwise
    // the catch-all takes precedence and the modal never triggers.
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 404, json: { error: 'not stubbed' } })
    );
    // Return 401 for unauthenticated requests, 200 once the token is present.
    await page.route('**/api/env', async (route) => {
      const auth = route.request().headers()['authorization'] ?? '';
      if (auth.startsWith('Bearer ')) {
        await route.fulfill({ json: ENV_DATA });
      } else {
        await route.fulfill({ status: 401, body: 'Unauthorized' });
      }
    });
    await page.route('**/api/status', async (route) => {
      const auth = route.request().headers()['authorization'] ?? '';
      if (auth.startsWith('Bearer ')) {
        await route.fulfill({ json: [] });
      } else {
        await route.fulfill({ status: 401, body: 'Unauthorized' });
      }
    });
    await page.route('**/api/costs/estimate', async (route) => {
      const auth = route.request().headers()['authorization'] ?? '';
      if (auth.startsWith('Bearer ')) {
        await route.fulfill({ json: COST_DATA });
      } else {
        await route.fulfill({ status: 401, body: 'Unauthorized' });
      }
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'API token required' })).toBeVisible();

    await page.getByPlaceholder('API token').fill('my-test-token');
    await page.getByRole('button', { name: 'Save & reload' }).click();

    // After reload the stored token is sent; the modal must be gone.
    await expect(page.getByRole('heading', { name: 'Game Server Manager' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'API token required' })).not.toBeVisible();
  });
});
