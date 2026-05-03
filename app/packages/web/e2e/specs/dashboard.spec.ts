import {
  test,
  expect,
  stubApis,
  STOPPED_GAME,
  RUNNING_GAME,
  MULTI_GAME_STATUSES,
} from '../fixtures/index.js';

test.describe('dashboard', () => {
  test('should render a game card for a stopped game', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [STOPPED_GAME] });
    await page.goto('/');

    const card = page.getByRole('heading', { name: 'minecraft' });
    await expect(card).toBeVisible();
    await expect(page.getByText('STOPPED')).toBeVisible();
  });

  test('should render a game card for a running game with IP', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [RUNNING_GAME] });
    await page.goto('/');

    await expect(page.getByText('RUNNING')).toBeVisible();
    await expect(page.getByText('minecraft.example.com')).toBeVisible();
  });

  test('should render multiple game cards', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: MULTI_GAME_STATUSES });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'minecraft' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'valheim' })).toBeVisible();
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

  test('should show only Stop as the primary action for a running game', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [RUNNING_GAME] });
    await page.goto('/');

    // The redesigned card swaps the primary CTA based on state instead of
    // disabling the inactive button — Start should not exist while running.
    await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);
  });

  test('should filter game cards by name in real time', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: MULTI_GAME_STATUSES });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'minecraft' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'valheim' })).toBeVisible();

    await page.getByLabel('Filter games').fill('valheim');

    await expect(page.getByRole('heading', { name: 'minecraft' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'valheim' })).toBeVisible();
  });

  test('should show empty-state message when search has no matches', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: MULTI_GAME_STATUSES });
    await page.goto('/');

    await page.getByLabel('Filter games').fill('nonexistent');
    await expect(page.getByText(/no games match/i)).toBeVisible();
  });

  test('should render the KPI strip with the four ops tiles', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: MULTI_GAME_STATUSES });
    await page.goto('/');

    await expect(page.getByText('Servers running')).toBeVisible();
    await expect(page.getByText('Spend today')).toBeVisible();
    await expect(page.getByText('Forecast MTD')).toBeVisible();
    await expect(page.getByText('Active alerts')).toBeVisible();
    // 1 of 2 games are running in MULTI_GAME_STATUSES (valheim).
    await expect(page.getByText('1/2')).toBeVisible();
  });

  test('should navigate to the Logs page via sidebar', async ({ authedPage: page }) => {
    await stubApis(page, { statuses: [] });
    await page.goto('/');

    await page.getByRole('link', { name: 'Logs' }).click();
    await expect(page).toHaveURL('/logs');
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
