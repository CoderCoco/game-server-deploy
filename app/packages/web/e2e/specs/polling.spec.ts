import { test, expect, stubApis, STOPPED_GAME } from '../fixtures/index.js';

/**
 * Specs for the polling indicator + top-bar Refresh introduced in #65. The
 * shared {@link PollingProvider} runs the status poll above the router, so
 * every primary route should display "Updated …" and the top-bar Refresh
 * button should trigger a fresh `/api/status` call on demand.
 */

test.describe('polling indicator', () => {
  test('should render the "Updated …" label on the dashboard', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [STOPPED_GAME] });
    await page.goto('/');

    await expect(page.getByText(/updated\s+\S+\s+ago/i).first()).toBeVisible();
  });

  test('should keep the indicator visible after navigating to /logs', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [STOPPED_GAME] });
    await page.goto('/');
    await expect(page.getByText(/updated\s+\S+\s+ago/i).first()).toBeVisible();

    await page.getByRole('link', { name: 'Logs' }).click();
    await expect(page).toHaveURL('/logs');
    await expect(page.getByText(/updated\s+\S+\s+ago/i).first()).toBeVisible();
  });

  test('should keep the indicator visible after navigating to /discord', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [STOPPED_GAME] });
    await page.goto('/');
    await page.getByRole('link', { name: 'Discord' }).click();
    await expect(page).toHaveURL('/discord');
    await expect(page.getByText(/updated\s+\S+\s+ago/i).first()).toBeVisible();
  });

  test('should keep the indicator visible after navigating to /settings', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [STOPPED_GAME] });
    await page.goto('/');
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.getByText(/updated\s+\S+\s+ago/i).first()).toBeVisible();
  });
});

test.describe('top-bar refresh', () => {
  test('should re-fetch /api/status when the Refresh button is clicked', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [STOPPED_GAME] });

    // stubApis already registered a catch-all for /api/status; this later
    // registration wins (Playwright matches routes in REVERSE order) and lets
    // us count GETs against the endpoint.
    let statusGetCount = 0;
    await page.route('**/api/status', (route) => {
      if (route.request().method() === 'GET') statusGetCount += 1;
      return route.fulfill({ json: [STOPPED_GAME] });
    });

    await page.goto('/');
    // Wait for the initial mount + first poll to settle so we can compare.
    await expect(page.getByText('Offline')).toBeVisible();
    const before = statusGetCount;

    await page.getByRole('button', { name: 'Refresh all' }).click();

    await expect.poll(() => statusGetCount).toBeGreaterThan(before);
  });
});
