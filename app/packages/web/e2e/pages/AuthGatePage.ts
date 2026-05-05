import type { Page, Locator } from '@playwright/test';

/**
 * Page object for the API-token modal rendered by `ApiTokenModal.tsx` when an
 * `/api/*` request returns 401. Used by auth-gate specs to assert the modal
 * appears and to drive the token-save → inline-retry flow.
 */
export class AuthGatePage {
  constructor(public readonly page: Page) {}

  /** Modal heading — visible whenever the auth gate is active. */
  modalHeading(): Locator {
    return this.page.getByRole('heading', { name: 'API token required' });
  }

  /** API-token text input inside the modal. */
  tokenInput(): Locator {
    return this.page.getByPlaceholder('Paste API token');
  }

  /**
   * Submit button — persists the token to localStorage and triggers
   * `retryPendingAfterAuth()`. The label briefly switches to "Verifying…"
   * during the retry, so we anchor to the steady-state "Save" name.
   */
  submitButton(): Locator {
    return this.page.getByRole('button', { name: 'Save', exact: true });
  }

  /** Show/hide eye toggle — flips the password input's `type` attribute. */
  showHideToggle(): Locator {
    return this.page.getByRole('button', { name: /Show token|Hide token/ });
  }

  /** Inline error paragraph (validation or 401-on-retry) — `null` when none is rendered. */
  errorMessage(): Locator {
    return this.page.locator('[role="alert"]');
  }

  /** Fill the token field and click submit in one call. */
  async submit(token: string): Promise<void> {
    await this.tokenInput().fill(token);
    await this.submitButton().click();
  }
}
