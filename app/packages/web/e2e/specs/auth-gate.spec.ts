import { test, expect, stubApis, ENV_DATA, COST_DATA } from '../fixtures/index.js';

/**
 * Auth-gate specs use the base Playwright `page` (no pre-seeded token) so they
 * can verify the 401 → modal and token-save → reload flows in isolation. The
 * `authGate` page object encapsulates the modal locators; raw `page` is still
 * needed for direct route stubbing and `addInitScript`.
 */

test.describe('auth gate', () => {
  test('should show token modal when API returns 401', async ({ page, authGate }) => {
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 401, body: 'Unauthorized' })
    );
    await page.goto('/');
    await expect(authGate.modalHeading()).toBeVisible();
  });

  test('should load dashboard when valid token is already stored', async ({ page, authGate, layout }) => {
    await page.addInitScript(() => {
      localStorage.setItem('apiToken', 'test-token');
    });
    await stubApis(page, { statuses: [] });
    await page.goto('/');
    // Dashboard shell mounts, modal does not.
    await expect(layout.brandHeading()).toBeVisible();
    await expect(authGate.modalHeading()).not.toBeVisible();
  });

  test('should save token and show dashboard after reload', async ({ page, authGate, layout }) => {
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
    await expect(authGate.modalHeading()).toBeVisible();

    await authGate.submit('my-test-token');

    // After reload the stored token is sent; the modal must be gone.
    await expect(layout.brandHeading()).toBeVisible();
    await expect(authGate.modalHeading()).not.toBeVisible();
  });
});
