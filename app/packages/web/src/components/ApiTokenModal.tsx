import { useState } from 'react';
import { setStoredApiToken } from '../api.js';

/**
 * Blocking modal that collects the API bearer token from the operator and
 * stores it in `localStorage` for subsequent `/api/*` requests. Shown when
 * no token is stored yet or when the server returns 401.
 *
 * On submit we reload the page — this is a deliberately simple UX choice:
 * it restarts all the `useEffect`-driven fetches cleanly instead of needing
 * each hook to know how to retry on auth success.
 */
export function ApiTokenModal() {
  const [token, setToken] = useState('');

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setStoredApiToken(token.trim());
    window.location.reload();
  }

  return (
    <div style={backdropStyle}>
      <form onSubmit={save} style={modalStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>API token required</h2>
        <p style={helpStyle}>
          This dashboard&apos;s API is gated behind a bearer token. Paste the value of
          <code> API_TOKEN </code> (or <code>api_token</code> from
          <code> app/server_config.json</code>) to continue. It&apos;s stored in your
          browser&apos;s local storage; clear the browser data to revoke.
        </p>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="API token"
          style={inputStyle}
        />
        <button type="submit" className="btn-secondary btn-sm" disabled={!token.trim()}>
          Save &amp; reload
        </button>
      </form>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '1.5rem',
  width: 'min(420px, 90vw)',
  display: 'grid',
  gap: '0.75rem',
};
const helpStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--text-dim)',
  margin: 0,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.7rem',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '0.9rem',
  fontFamily: 'monospace',
};
