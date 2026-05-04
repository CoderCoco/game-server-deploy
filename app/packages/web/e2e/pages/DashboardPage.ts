import type { Page, Locator } from '@playwright/test';

/** Status-badge labels rendered by the redesigned `GameCard` (issue #60). */
export type ServerStateLabel =
  | 'RUNNING'
  | 'STARTING'
  | 'STOPPED'
  | 'NOT DEPLOYED'
  | 'ERROR';

/**
 * Page object for the dashboard route (`/`). Wraps the KPI strip, the search
 * filter, the GameCard grid, and the per-card action buttons so spec files
 * read as test logic rather than locator soup.
 */
export class DashboardPage {
  constructor(public readonly page: Page) {}

  /** Navigate to the dashboard root. */
  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  // ── GameCard grid ────────────────────────────────────────────────────

  /** `<h3>` element inside a card whose game name matches `name`. */
  gameCardHeading(name: string): Locator {
    return this.page.getByRole('heading', { name });
  }

  /** Status badge by its rendered text label (RUNNING / STOPPED / etc.). */
  statusBadge(state: ServerStateLabel): Locator {
    return this.page.getByText(state);
  }

  /** Empty-state when the operator hasn't configured any games at all. */
  emptyConfiguredMessage(): Locator {
    return this.page.getByText(/no games configured/i);
  }

  /** Empty-state when the search input filters out every card. */
  emptySearchMessage(): Locator {
    return this.page.getByText(/no games match/i);
  }

  // ── Card action buttons ──────────────────────────────────────────────

  /** Primary CTA shown on a stopped/not-deployed/error card. */
  startButton(): Locator {
    return this.page.getByRole('button', { name: 'Start' });
  }

  /** Primary CTA shown on a running/starting card. */
  stopButton(): Locator {
    return this.page.getByRole('button', { name: 'Stop' });
  }

  // ── Search filter ────────────────────────────────────────────────────

  /** Search input above the grid that filters by game name or hostname. */
  searchInput(): Locator {
    return this.page.getByLabel('Filter games');
  }

  /** Type into the search input and let React rerender the filtered grid. */
  async filter(query: string): Promise<void> {
    await this.searchInput().fill(query);
  }

  // ── KPI strip ────────────────────────────────────────────────────────

  /** A KPI tile by its label ('Servers running', 'Spend today', etc.). */
  kpiTileLabel(label: string): Locator {
    return this.page.getByText(label);
  }

  /** The "Servers running" KPI value (e.g. "1/2"). */
  serversRunningValue(value: string): Locator {
    return this.page.getByText(value, { exact: true });
  }
}
