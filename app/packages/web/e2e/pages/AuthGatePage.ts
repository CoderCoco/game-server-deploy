import type { Page, Locator } from '@playwright/test';

/**
 * Page object for the API-token modal rendered by `ApiTokenModal.tsx` when an
 * `/api/*` request returns 401. Used by auth-gate specs to assert the modal
 * appears and to drive the token-save → reload flow.
 */
export class AuthGatePage {
  constructor(public readonly page: Page) {}

  /** Modal heading — visible whenever the auth gate is active. */
  modalHeading(): Locator {
    return this.page.getByRole('heading', { name: 'API token required' });
  }

  /** API-token text input inside the modal. */
  tokenInput(): Locator {
    return this.page.getByPlaceholder('API token');
  }

  /** "Save & reload" submit button — persists the token to localStorage and reloads. */
  submitButton(): Locator {
    return this.page.getByRole('button', { name: 'Save & reload' });
  }

  /** Fill the token field and click submit in one call. */
  async submit(token: string): Promise<void> {
    await this.tokenInput().fill(token);
    await this.submitButton().click();
  }
}
