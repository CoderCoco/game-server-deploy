import { test, expect, stubApis, SAMPLE_LOG_LINES } from '../fixtures/index.js';

/**
 * `/logs` route specs (issue #63). The Nest server is never started — every
 * `/api/*` call goes through Playwright route stubs. The SSE stream
 * (`/api/logs/:game/stream`) is aborted by the default `stubApis()` setup so
 * `EventSource` gives up immediately and tests don't hang on a never-ending
 * response. We then drive the page entirely off the seeded snapshot returned
 * by `GET /api/logs/:game`.
 */
test.describe('logs page', () => {
  test('should render LIVE badge and seeded log lines', async ({ authedPage: page }) => {
    await stubApis(page, {
      statuses: [{ game: 'minecraft', state: 'stopped' }],
      logLines: { minecraft: SAMPLE_LOG_LINES },
    });
    await page.goto('/logs');

    await expect(page.getByRole('heading', { name: 'Server Logs' })).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await expect(page.getByText('Server started on port 25565')).toBeVisible();
  });

  test('should toggle to Paused badge and back via the Pause/Resume button', async ({ authedPage: page }) => {
    await stubApis(page, {
      statuses: [{ game: 'minecraft', state: 'stopped' }],
      logLines: { minecraft: SAMPLE_LOG_LINES },
    });
    await page.goto('/logs');

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).not.toBeVisible();

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
  });

  test('should color-code lines containing INFO/WARN/ERROR/DEBUG with badges', async ({ authedPage: page }) => {
    await stubApis(page, {
      statuses: [{ game: 'minecraft', state: 'stopped' }],
      logLines: { minecraft: SAMPLE_LOG_LINES },
    });
    await page.goto('/logs');

    // Each level token should appear at least once as a small badge alongside
    // the matching line. We don't pin the exact element type — the badge is a
    // `<div>` rendered by the shadcn `Badge` component.
    for (const lvl of ['INFO', 'WARN', 'ERROR', 'DEBUG']) {
      await expect(page.getByText(lvl, { exact: true }).first()).toBeVisible();
    }
  });

  test('should highlight matches via <mark> when typing into the search box without filtering lines out', async ({
    authedPage: page,
  }) => {
    await stubApis(page, {
      statuses: [{ game: 'minecraft', state: 'stopped' }],
      logLines: { minecraft: SAMPLE_LOG_LINES },
    });
    await page.goto('/logs');

    await expect(page.locator('mark')).toHaveCount(0);

    await page.getByPlaceholder('Search visible buffer…').fill('Connection');
    await expect(page.locator('mark', { hasText: 'Connection' }).first()).toBeVisible();
    // The matched line must remain in the buffer — search highlights, never filters.
    await expect(page.getByText('refused from 10.0.0.5')).toBeVisible();
  });

  test('should hide ERROR-level lines when ERROR is unchecked in the Levels filter', async ({
    authedPage: page,
  }) => {
    await stubApis(page, {
      statuses: [{ game: 'minecraft', state: 'stopped' }],
      logLines: { minecraft: SAMPLE_LOG_LINES },
    });
    await page.goto('/logs');

    await expect(page.getByText('Connection refused from 10.0.0.5')).toBeVisible();
    await expect(page.getByRole('button', { name: /Levels.*4\/4/ })).toBeVisible();

    await page.getByRole('button', { name: /Levels/ }).click();
    await page.getByRole('menuitemcheckbox', { name: 'ERROR' }).click();
    // The level menu stays open by design (`onSelect` preventDefault); close it
    // with Escape so the underlying log box is unobstructed for assertions.
    await page.keyboard.press('Escape');

    await expect(page.getByText('Connection refused from 10.0.0.5')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Levels.*3\/4/ })).toBeVisible();
  });

  test('should switch streams via the searchable game combobox', async ({ authedPage: page }) => {
    await stubApis(page, {
      statuses: [
        { game: 'minecraft', state: 'stopped' },
        { game: 'valheim', state: 'stopped' },
      ],
      logLines: {
        minecraft: ['minecraft seeded line'],
        valheim: ['valheim seeded line'],
      },
    });
    await page.goto('/logs');

    await expect(page.getByText('minecraft seeded line')).toBeVisible();

    await page.getByRole('button', { name: /^Game selector/ }).click();
    await page.getByPlaceholder('Search games…').fill('val');
    await page.getByRole('button', { name: 'valheim' }).click();

    await expect(page.getByText('valheim seeded line')).toBeVisible();
    // Switching games resets the buffer — the previous game's seeded line
    // must be gone, not just hidden.
    await expect(page.getByText('minecraft seeded line')).not.toBeVisible();
  });

  test('should display line count and oldest-line age in the footer', async ({ authedPage: page }) => {
    await stubApis(page, {
      statuses: [{ game: 'minecraft', state: 'stopped' }],
      logLines: { minecraft: SAMPLE_LOG_LINES },
    });
    await page.goto('/logs');

    // SAMPLE_LOG_LINES has 5 entries; "oldest" follows the count.
    await expect(page.getByText(/^5 lines · oldest /)).toBeVisible();
  });
});
