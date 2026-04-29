import { useEffect, useState } from 'react';
import {
  api,
  type DiscordConfigRedacted,
  type DiscordGamePermission,
  type DiscordAction,
} from '../api.js';

const ALL_ACTIONS: DiscordAction[] = ['start', 'stop', 'status'];

/**
 * Dashboard panel for configuring the serverless Discord bot.
 *
 * After the migration to Lambda + DynamoDB + Secrets Manager, this panel
 * still drives all bot configuration: credentials (which are written to
 * Secrets Manager via the management app), the guild allowlist (DynamoDB),
 * server-wide admins, and per-game permissions. The "Restart bot" button is
 * gone — the bot has no long-running process to restart — and is replaced
 * by a per-guild "Register commands" button which calls Discord's REST API
 * to install our slash commands in that guild.
 *
 * `games` is the current list of game names from Terraform outputs; used to
 * populate the per-game permissions tab.
 */
export function DiscordPanel({ games }: { games: string[] }) {
  const [cfg, setCfg] = useState<DiscordConfigRedacted | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<'bot' | 'guilds' | 'admins' | 'perms'>('bot');
  const [busy, setBusy] = useState(false);

  /** Re-fetch the (redacted) Discord config from the API after mutations. */
  async function refresh() {
    try {
      setCfg(await api.discordConfig());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  if (!cfg) {
    return (
      <div style={panelStyle}>
        <h2 style={headingStyle}>Discord Bot</h2>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          {loadError ? 'Discord config unavailable — infrastructure not deployed yet.' : 'Loading…'}
        </div>
      </div>
    );
  }

  /**
   * Guard an API-mutating action with the `busy` flag (disables child buttons)
   * and refresh config afterwards so the UI reflects the server-side change.
   */
  async function wrap<T>(fn: () => Promise<T>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={headingStyle}>Discord Bot</h2>
        <ServerlessBadge cfg={cfg} />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
        <TabButton active={tab === 'bot'} onClick={() => setTab('bot')}>Credentials</TabButton>
        <TabButton active={tab === 'guilds'} onClick={() => setTab('guilds')}>Guilds</TabButton>
        <TabButton active={tab === 'admins'} onClick={() => setTab('admins')}>Admins</TabButton>
        <TabButton active={tab === 'perms'} onClick={() => setTab('perms')}>Per-Game Permissions</TabButton>
      </div>

      {tab === 'bot' && (
        <CredentialsTab
          cfg={cfg}
          busy={busy}
          onSave={(body) => wrap(() => api.discordSaveCredentials(body))}
        />
      )}
      {tab === 'guilds' && (
        <GuildsTab
          cfg={cfg}
          busy={busy}
          onAdd={(g) => wrap(() => api.discordAddGuild(g))}
          onRemove={(g) => wrap(() => api.discordRemoveGuild(g))}
          onRegister={(g) => wrap(() => api.discordRegisterCommands(g))}
        />
      )}
      {tab === 'admins' && (
        <AdminsTab cfg={cfg} busy={busy} onSave={(a) => wrap(() => api.discordSaveAdmins(a))} />
      )}
      {tab === 'perms' && (
        <PermissionsTab
          cfg={cfg}
          games={games}
          busy={busy}
          onSave={(game, perm) => wrap(() => api.discordSavePermission(game, perm))}
          onDelete={(game) => wrap(() => api.discordDeletePermission(game))}
        />
      )}
    </div>
  );
}

/**
 * Header indicator showing whether the serverless bot is fully wired up
 * (both secrets configured + an interactions endpoint URL exists). When
 * incomplete it explains what's missing — replaces the old gateway-bot
 * "running/stopped" badge.
 */
function ServerlessBadge({ cfg }: { cfg: DiscordConfigRedacted }) {
  const ready = cfg.botTokenSet && cfg.publicKeySet && cfg.interactionsEndpointUrl;
  const color = ready ? 'var(--ok, #4ade80)' : 'var(--warn, #fbbf24)';
  const label = ready
    ? 'serverless · ready'
    : !cfg.interactionsEndpointUrl
      ? 'terraform not applied'
      : !cfg.botTokenSet || !cfg.publicKeySet
        ? 'awaiting credentials'
        : 'incomplete';
  return (
    <div style={{ fontSize: '0.72rem', color, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
      {label}
    </div>
  );
}

/**
 * Form for the Discord application's client ID, bot token, and Ed25519 public
 * key. Token and public key are write-only: leaving the field blank when one
 * is already set preserves the existing value. Below the form we surface the
 * Lambda Function URL the operator pastes into the Discord developer portal.
 */
function CredentialsTab({
  cfg,
  busy,
  onSave,
}: {
  cfg: DiscordConfigRedacted;
  busy: boolean;
  onSave: (body: { botToken?: string; clientId?: string; publicKey?: string }) => void;
}) {
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState(cfg.clientId);
  const [publicKey, setPublicKey] = useState('');

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <p style={helpStyle}>
        Create an application at <code>discord.com/developers/applications</code>, add a bot,
        copy the Application ID, Bot Token, and the Application Public Key. Paste the
        Interactions Endpoint URL below into the same page.
      </p>
      <LabeledInput label="Application (Client) ID" value={clientId} onChange={setClientId} />
      <LabeledInput
        label={`Bot Token ${cfg.botTokenSet ? '(already set — leave blank to keep)' : ''}`}
        value={token}
        onChange={setToken}
        type="password"
      />
      <LabeledInput
        label={`Application Public Key ${cfg.publicKeySet ? '(already set — leave blank to keep)' : ''}`}
        value={publicKey}
        onChange={setPublicKey}
      />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
        <button
          className="btn-secondary btn-sm"
          disabled={busy}
          onClick={() => {
            onSave({
              clientId,
              ...(token ? { botToken: token } : {}),
              ...(publicKey ? { publicKey } : {}),
            });
            setToken('');
            setPublicKey('');
          }}
        >
          Save
        </button>
      </div>
      <div>
        <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: '0.2rem' }}>
          Interactions Endpoint URL
        </label>
        {cfg.interactionsEndpointUrl ? (
          <code style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>
            {cfg.interactionsEndpointUrl}
          </code>
        ) : (
          <span style={helpStyle}>Run <code>terraform apply</code> to provision the Lambda and surface this URL.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Manage the guild (server) allowlist. Each row also shows a "Register
 * commands" button — operator-triggered re-registration replaces the old
 * always-on bot's automatic registration on `ready`/`guildCreate`.
 *
 * Guilds from the Terraform `base_allowed_guilds` variable are shown as locked
 * rows — they can be registered but not removed via the UI.
 */
function GuildsTab({
  cfg,
  busy,
  onAdd,
  onRemove,
  onRegister,
}: {
  cfg: DiscordConfigRedacted;
  busy: boolean;
  onAdd: (g: string) => void;
  onRemove: (g: string) => void;
  onRegister: (g: string) => void;
}) {
  const [next, setNext] = useState('');
  const hasAny = cfg.baseAllowedGuilds.length > 0 || cfg.allowedGuilds.length > 0;
  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <p style={helpStyle}>
        The interactions Lambda rejects commands from any server whose ID isn&apos;t in this list.
        Enable Discord Developer Mode (Settings → Advanced) to copy server IDs. After adding a
        guild, click <em>Register commands</em> to install the slash commands there.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          style={inputStyle}
          placeholder="Guild (server) ID"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button className="btn-secondary btn-sm" disabled={busy || !next.trim()} onClick={() => { onAdd(next.trim()); setNext(''); }}>
          Add
        </button>
      </div>
      {!hasAny ? (
        <div style={helpStyle}>No guilds allowlisted yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.3rem' }}>
          {cfg.baseAllowedGuilds.map((g) => (
            <li key={`base:${g}`} style={rowStyle}>
              <code style={{ fontSize: '0.8rem', flex: 1 }}>{g}</code>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>terraform-managed</span>
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onRegister(g)}>
                Register commands
              </button>
            </li>
          ))}
          {cfg.allowedGuilds.map((g) => (
            <li key={g} style={rowStyle}>
              <code style={{ fontSize: '0.8rem', flex: 1 }}>{g}</code>
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onRegister(g)}>
                Register commands
              </button>
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onRemove(g)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Editor for the server-wide admin list — users or roles that bypass the
 * per-game permission check and can run every Discord command.
 *
 * Admins set via the Terraform `base_admin_user_ids` / `base_admin_role_ids`
 * variables are shown as read-only below the editable section.
 */
function AdminsTab({
  cfg,
  busy,
  onSave,
}: {
  cfg: DiscordConfigRedacted;
  busy: boolean;
  onSave: (a: { userIds: string[]; roleIds: string[] }) => void;
}) {
  const [userIds, setUserIds] = useState(cfg.admins.userIds.join(', '));
  const [roleIds, setRoleIds] = useState(cfg.admins.roleIds.join(', '));
  const hasBaseAdmins =
    cfg.baseAdmins.userIds.length > 0 || cfg.baseAdmins.roleIds.length > 0;
  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <p style={helpStyle}>
        Admins can run every command on every game. Provide comma-separated Discord user IDs
        or role IDs (right-click user/role → Copy ID with Developer Mode enabled).
      </p>
      <LabeledTextarea label="Admin User IDs" value={userIds} onChange={setUserIds} />
      <LabeledTextarea label="Admin Role IDs" value={roleIds} onChange={setRoleIds} />
      <div>
        <button
          className="btn-secondary btn-sm"
          disabled={busy}
          onClick={() => onSave({ userIds: splitList(userIds), roleIds: splitList(roleIds) })}
        >
          Save
        </button>
      </div>
      {hasBaseAdmins && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.6rem', display: 'grid', gap: '0.4rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            Terraform-managed (read-only)
          </div>
          {cfg.baseAdmins.userIds.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Admin User IDs</div>
              <code style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>
                {cfg.baseAdmins.userIds.join(', ')}
              </code>
            </div>
          )}
          {cfg.baseAdmins.roleIds.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Admin Role IDs</div>
              <code style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>
                {cfg.baseAdmins.roleIds.join(', ')}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Outer wrapper for the per-game permission editor. Picks the game whose
 * permissions are being edited; the actual editor is rendered with a `key`
 * tied to `selected` so its internal form state resets when the game changes.
 */
function PermissionsTab({
  cfg,
  games,
  busy,
  onSave,
  onDelete,
}: {
  cfg: DiscordConfigRedacted;
  games: string[];
  busy: boolean;
  onSave: (game: string, perm: DiscordGamePermission) => void;
  onDelete: (game: string) => void;
}) {
  const [selected, setSelected] = useState<string>(games[0] ?? '');
  if (!games.length) {
    return <div style={helpStyle}>No games configured yet — run <code>terraform apply</code> first.</div>;
  }
  const current: DiscordGamePermission = cfg.gamePermissions[selected] ?? { userIds: [], roleIds: [], actions: [] };
  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>Game:</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{ ...inputStyle, flex: '0 0 auto' }}
        >
          {games.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <PermissionEditor
        key={selected}
        initial={current}
        busy={busy}
        onSave={(perm) => onSave(selected, perm)}
        onDelete={() => onDelete(selected)}
      />
    </div>
  );
}

/**
 * Form for a single game's permission entry: allowed user IDs, role IDs, and
 * the set of actions (start/stop/status) those principals can invoke.
 * `Clear` deletes the entry entirely.
 */
function PermissionEditor({
  initial,
  busy,
  onSave,
  onDelete,
}: {
  initial: DiscordGamePermission;
  busy: boolean;
  onSave: (perm: DiscordGamePermission) => void;
  onDelete: () => void;
}) {
  const [userIds, setUserIds] = useState(initial.userIds.join(', '));
  const [roleIds, setRoleIds] = useState(initial.roleIds.join(', '));
  const [actions, setActions] = useState<DiscordAction[]>(initial.actions);

  /** Toggle an action in or out of the allowed-actions set. */
  function toggle(a: DiscordAction) {
    setActions((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  }

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <LabeledTextarea label="Allowed User IDs" value={userIds} onChange={setUserIds} />
      <LabeledTextarea label="Allowed Role IDs" value={roleIds} onChange={setRoleIds} />
      <div>
        <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: '0.3rem' }}>
          Allowed actions
        </label>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {ALL_ACTIONS.map((a) => (
            <label key={a} style={{ fontSize: '0.82rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <input type="checkbox" checked={actions.includes(a)} onChange={() => toggle(a)} /> {a}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          className="btn-secondary btn-sm"
          disabled={busy}
          onClick={() => onSave({ userIds: splitList(userIds), roleIds: splitList(roleIds), actions })}
        >
          Save
        </button>
        <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onDelete()}>
          Clear
        </button>
      </div>
    </div>
  );
}

/** A tab-strip button with an underline when active; used for the panel's top navigation. */
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.4rem 0.75rem',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--text)' : '2px solid transparent',
        color: active ? 'var(--text)' : 'var(--text-dim)',
        fontSize: '0.78rem',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/** A single-line text input with a dim label above it. Pass `type="password"` for secrets. */
function LabeledInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: '0.2rem' }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

/** A two-row textarea with a dim label — used for comma-separated ID lists. */
function LabeledTextarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: '0.2rem' }}>{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
        placeholder="Comma-separated IDs"
      />
    </div>
  );
}

/** Parse a comma-separated string into a trimmed, non-empty array of tokens. */
function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

const panelStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '1.25rem',
  marginBottom: '1.25rem',
};
const headingStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-dim)',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.4rem 0.6rem',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '0.82rem',
};
const helpStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--text-dim)',
  margin: 0,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.4rem 0.6rem',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
};
