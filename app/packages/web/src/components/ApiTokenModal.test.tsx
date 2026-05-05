import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Hoisted mocks for api.ts — vi.hoisted ensures they exist when vi.mock runs. */
const { retryMock, setTokenMock } = vi.hoisted(() => ({
  retryMock: vi.fn<() => Promise<boolean>>(),
  setTokenMock: vi.fn<(token: string) => void>(),
}));

vi.mock('../api.js', () => ({
  retryPendingAfterAuth: retryMock,
  setStoredApiToken: setTokenMock,
}));

import { ApiTokenModal } from './ApiTokenModal.js';

/** Helper: renders the modal with default open=true and a fresh onSuccess spy. */
function renderModal(open = true, onSuccess = vi.fn()) {
  render(<ApiTokenModal open={open} onSuccess={onSuccess} />);
  return { onSuccess };
}

const VALID_TOKEN = 'a-valid-token-12345';

describe('ApiTokenModal', () => {
  beforeEach(() => {
    retryMock.mockResolvedValue(true);
  });

  // ── Visibility ────────────────────────────────────────────────────────────

  it('should render the API token required heading when open', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: 'API token required' })).toBeInTheDocument();
  });

  it('should not render dialog content when open is false', () => {
    renderModal(false);
    expect(screen.queryByRole('heading', { name: 'API token required' })).not.toBeInTheDocument();
  });

  // ── Password field ────────────────────────────────────────────────────────

  it('should render the token input in password mode', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Paste API token')).toHaveAttribute('type', 'password');
  });

  it('should reveal the token when the show toggle is clicked', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Show token' }));
    expect(screen.getByPlaceholderText('Paste API token')).toHaveAttribute('type', 'text');
  });

  it('should obscure the token again when the hide toggle is clicked', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Show token' }));
    await user.click(screen.getByRole('button', { name: 'Hide token' }));
    expect(screen.getByPlaceholderText('Paste API token')).toHaveAttribute('type', 'password');
  });

  // ── Inline validation ─────────────────────────────────────────────────────

  it('should show a validation error when the token contains whitespace', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText('Paste API token'), 'has a space');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(screen.getByRole('alert')).toHaveTextContent('Token cannot contain whitespace.');
  });

  it('should show a validation error for a token shorter than 16 characters', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText('Paste API token'), 'tooshort');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 16 characters');
  });

  it('should re-validate on input change once a validation error is visible', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText('Paste API token'), 'tooshort');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Extend to a valid-length token — the live re-validate should clear the error.
    await user.type(screen.getByPlaceholderText('Paste API token'), '-now-long-enough');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should not send a request when client validation fails', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText('Paste API token'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(retryMock).not.toHaveBeenCalled();
    expect(setTokenMock).not.toHaveBeenCalled();
  });

  // ── Submission ────────────────────────────────────────────────────────────

  it('should call setStoredApiToken then retryPendingAfterAuth on valid submit', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText('Paste API token'), VALID_TOKEN);
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(setTokenMock).toHaveBeenCalledWith(VALID_TOKEN);
    await waitFor(() => expect(retryMock).toHaveBeenCalledOnce());
  });

  it('should call onSuccess when retryPendingAfterAuth resolves true', async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderModal();
    await user.type(screen.getByPlaceholderText('Paste API token'), VALID_TOKEN);
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });

  it('should show an inline server error when retryPendingAfterAuth resolves false', async () => {
    const user = userEvent.setup();
    retryMock.mockResolvedValue(false);
    renderModal();
    await user.type(screen.getByPlaceholderText('Paste API token'), VALID_TOKEN);
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Invalid token/),
    );
  });

  it('should not call onSuccess when retryPendingAfterAuth resolves false', async () => {
    const user = userEvent.setup();
    retryMock.mockResolvedValue(false);
    const { onSuccess } = renderModal();
    await user.type(screen.getByPlaceholderText('Paste API token'), VALID_TOKEN);
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('should clear the server error when the token input changes', async () => {
    const user = userEvent.setup();
    retryMock.mockResolvedValue(false);
    renderModal();
    await user.type(screen.getByPlaceholderText('Paste API token'), VALID_TOKEN);
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Paste API token'), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
