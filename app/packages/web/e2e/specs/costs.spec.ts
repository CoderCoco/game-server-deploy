import { test, expect, stubApis, MULTI_GAME_COST_DATA } from '../fixtures/index.js';

/**
 * Specs for the `/costs` route added in CoderCoco/game-server-deploy#61.
 * The default cost-estimates fixture only contains `minecraft`; specs that
 * exercise sorting / filtering pass `MULTI_GAME_COST_DATA` instead so the
 * table has multiple rows to interact with.
 */
test.describe('costs page', () => {
  test('should render the cost analysis heading', async ({ authedPage: page }) => {
    await stubApis(page);
    await page.goto('/costs');

    await expect(page.getByRole('heading', { name: 'Cost Analysis' })).toBeVisible();
  });

  test('should display the trailing-window total spend KPI', async ({ authedPage: page }) => {
    await stubApis(page);
    await page.goto('/costs');

    // Card header advertises the active window length.
    await expect(page.getByText(/Total spend · trailing 7 days/i)).toBeVisible();
    // Total renders as a formatted dollar amount; default fixture totals $5.00.
    await expect(page.getByText('$5.00').first()).toBeVisible();
  });

  test('should render a delta-vs-prior pill', async ({ authedPage: page }) => {
    await stubApis(page);
    await page.goto('/costs');

    // The fixture's two-tier daily cost gives a non-zero delta, so the pill
    // shows the "vs prior" suffix rather than the "no prior period" badge.
    await expect(page.getByText('vs prior')).toBeVisible();
  });

  test('should render stacked bar segments for each game', async ({ authedPage: page }) => {
    await stubApis(page, { costs: MULTI_GAME_COST_DATA });
    await page.goto('/costs');

    await expect(page.getByText('Daily spend, stacked by game')).toBeVisible();
    // Segments expose per-game data via aria-label so they're keyboard /
    // screen-reader accessible without needing to hover the Radix tooltip.
    await expect(page.getByLabel(/^minecraft: \$/).first()).toBeVisible();
    await expect(page.getByLabel(/^valheim: \$/).first()).toBeVisible();
    await expect(page.getByLabel(/^palworld: \$/).first()).toBeVisible();
  });

  test('should sort estimates by $/hour descending by default', async ({ authedPage: page }) => {
    await stubApis(page, { costs: MULTI_GAME_COST_DATA });
    await page.goto('/costs');

    const rows = page.getByRole('row');
    // Row 0 is the header; rows 1..3 are the games sorted $/hr desc:
    // palworld ($0.32) > valheim ($0.16) > minecraft ($0.08).
    await expect(rows.nth(1)).toContainText('palworld');
    await expect(rows.nth(2)).toContainText('valheim');
    await expect(rows.nth(3)).toContainText('minecraft');
  });

  test('should re-sort estimates by game name when the Game header is clicked', async ({ authedPage: page }) => {
    await stubApis(page, { costs: MULTI_GAME_COST_DATA });
    await page.goto('/costs');

    await page.getByRole('button', { name: /^Game/ }).click();

    const rows = page.getByRole('row');
    // After clicking Game, default direction is ascending alphabetical.
    await expect(rows.nth(1)).toContainText('minecraft');
    await expect(rows.nth(2)).toContainText('palworld');
    await expect(rows.nth(3)).toContainText('valheim');
  });

  test('should filter estimates via the search input', async ({ authedPage: page }) => {
    await stubApis(page, { costs: MULTI_GAME_COST_DATA });
    await page.goto('/costs');

    await page.getByPlaceholder('Filter games…').fill('val');

    await expect(page.getByRole('cell', { name: /valheim/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /minecraft/ })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: /palworld/ })).toHaveCount(0);
  });

  test('should disable the 1h and 24h range options', async ({ authedPage: page }) => {
    await stubApis(page);
    await page.goto('/costs');

    await expect(page.getByRole('button', { name: '1h', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '24h', exact: true })).toBeDisabled();
  });

  test('should switch the active window when clicking 30d', async ({ authedPage: page }) => {
    await stubApis(page);
    await page.goto('/costs');

    // 7d header before the click.
    await expect(page.getByText(/Total spend · trailing 7 days/i)).toBeVisible();

    await page.getByRole('button', { name: '30d', exact: true }).click();

    await expect(page.getByText(/Total spend · trailing 30 days/i)).toBeVisible();
  });
});
