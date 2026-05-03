import { test, expect, stubApis, STOPPED_GAME, RUNNING_GAME, MULTI_GAME_STATUSES } from '../fixtures/index.js';

test.describe('dashboard', () => {
  test('should render a game card for a stopped game', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [STOPPED_GAME] });
    await page.goto('/');

    const card = page.getByText('minecraft', { exact: false }).first();
    await expect(card).toBeVisible();
    await expect(page.getByText('Offline')).toBeVisible();
  });

  test('should render a game card for a running game with IP', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [RUNNING_GAME] });
    await page.goto('/');

    await expect(page.getByText('Online')).toBeVisible();
    await expect(page.getByText('minecraft.example.com')).toBeVisible();
  });

  test('should render multiple game cards', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: MULTI_GAME_STATUSES });
    await page.goto('/');

    await expect(page.getByText('minecraft', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('valheim', { exact: false }).first()).toBeVisible();
  });

  test('should show empty-state message when no games are configured', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [] });
    await page.goto('/');

    await expect(page.getByText(/no games configured/i)).toBeVisible();
  });

  test('should fire POST /api/start/:game when Start is clicked', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [STOPPED_GAME] });

    // Track whether the start request was made.
    let startCalled = false;
    await page.route('**/api/start/minecraft', (route) => {
      startCalled = true;
      return route.fulfill({ json: { success: true, message: 'Started' } });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();

    await expect.poll(() => startCalled).toBe(true);
  });

  test('should disable Start button for a running game', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [RUNNING_GAME] });
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  test('should navigate to the Logs page via sidebar', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [] });
    await page.goto('/');

    await page.getByRole('link', { name: 'Logs' }).click();
    await expect(page).toHaveURL('/logs');
    // The /logs route is no longer a placeholder — verify the redesigned
    // page actually renders so a regression to the placeholder breaks here.
    await expect(page.getByRole('heading', { name: 'Server Logs' })).toBeVisible();
  });

  test('should navigate to the Discord page via sidebar', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [] });
    await page.goto('/');

    await page.getByRole('link', { name: 'Discord' }).click();
    await expect(page).toHaveURL('/discord');
  });

  test('should navigate to the Settings page via sidebar', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [] });
    await page.goto('/');

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/settings');
  });
});
