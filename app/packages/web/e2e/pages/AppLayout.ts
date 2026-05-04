import type { Page, Locator } from '@playwright/test';

/**
 * Page object for the persistent navigation shell rendered by `AppLayout.tsx`
 * (sidebar + top bar). Encapsulates locators that are shared across every
 * authenticated route so individual specs don't reach into the layout chrome.
 */
export class AppLayout {
  constructor(public readonly page: Page) {}

  /** Top-bar product heading — used as a "the dashboard mounted" smoke check. */
  brandHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Game Server Manager' });
  }

  /** Sidebar nav link by visible label (e.g. "Logs", "Discord", "Settings"). */
  sidebarLink(label: string): Locator {
    return this.page.getByRole('link', { name: label });
  }

  /** Click a sidebar nav link and wait for the URL to change to `expectedPath`. */
  async navigateTo(label: string, expectedPath: string): Promise<void> {
    await this.sidebarLink(label).click();
    await this.page.waitForURL(expectedPath);
  }
}
