import { useEffect, useState } from 'react';
import {
  api,
  type DiscordConfigRedacted,
  type DiscordGamePermission,
  type DiscordAction,
} from '../api.js';

const ALL_ACTIONS: DiscordAction[] = ['start', 'stop', 'status'];

/**
 * Dashboard panel for configuring the Discord bot: credentials, the guild
 * allowlist (the bot auto-leaves any guild not listed here), server-wide
 * admins, and per-game user/role permissions. `games` is the current list
 * of game names from Terraform outputs, used to populate the per-game tab.
 */
export function DiscordPanel({ games }: { games: string[] }) {
  const [cfg, setCfg] = useState<DiscordConfigRedacted | null>(null);
  const [tab, setTab] = useState<'bot' | 'guilds' | 'admins' | 'perms'>('bot');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setCfg(await api.discordConfig());
  }
  useEffect(() => {
    void refresh();
  }, []);

  if (!cfg) {
    return (
      <div style={panelStyle}>
        <h2 style={headingStyle}>Discord Bot</h2>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Loading…</div>
      </div>
    );
  }

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
        <BotStatusBadge cfg={cfg} />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
        <TabButton active={tab === 'bot'} onClick={() => setTab('bot')}>Credentials</TabButton>
        <TabButton active={tab === 'guilds'} onClick={() => setTab('guilds')}>Guilds</TabButton>
        <TabButton active={tab === 'admins'} onClick={() => setTab('admins')}>Admins</TabButton>
        <TabButton active={tab === 'perms'} onClick={() => setTab('perms')}>Per-Game Permissions</TabButton>
      </div>

      {tab === 'bot' && <CredentialsTab cfg={cfg} busy={busy} onSave={(body) => wrap(() => api.discordSaveCredentials(body))} onRestart={() => wrap(() => api.discordRestart())} />}
      {tab === 'guilds' && <GuildsTab cfg={cfg} busy={busy} onAdd={(g) => wrap(() => api.discordAddGuild(g))} onRemove={(g) => wrap(() => api.discordRemoveGuild(g))} />}
      {tab === 'admins' && <AdminsTab cfg={cfg} busy={busy} onSave={(a) => wrap(() => api.discordSaveAdmins(a))} />}
      {tab === 'perms' && <PermissionsTab cfg={cfg} games={games} busy={busy} onSave={(game, perm) => wrap(() => api.discordSavePermission(game, perm))} onDelete={(game) => wrap(() => api.discordDeletePermission(game))} />}
    </div>
  );
}

function BotStatusBadge({ cfg }: { cfg: DiscordConfigRedacted }) {
  const { state, username } = cfg.botStatus;
  const color =
    state === 'running' ? 'var(--ok, #4ade80)'
    : state === 'starting' ? 'var(--warn, #fbbf24)'
    : state === 'error' ? 'var(--err, #f87171)'
    : 'var(--text-dim)';
  return (
    <div style={{ fontSize: '0.72rem', color, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
      {state}{username ? ` · ${username}` : ''}
    </div>
  );
}

function CredentialsTab({
  cfg,
  busy,
  onSave,
  onRestart,
}: {
  cfg: DiscordConfigRedacted;
  busy: boolean;
  onSave: (body: { botToken?: string; clientId?: string }) => void;
  onRestart: () => void;
}) {
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState(cfg.clientId);

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <p style={helpStyle}>
        Create an application at <code>discord.com/developers/applications</code>, add a bot,
        copy the Application ID (client ID) and Bot Token. You can also set the token via the
        <code> DISCORD_BOT_TOKEN </code> env var (env wins over file).
      </p>
      <LabeledInput label="Application (Client) ID" value={clientId} onChange={setClientId} />
      <LabeledInput
        label={`Bot Token ${cfg.botTokenSet ? '(already set — leave blank to keep)' : ''}`}
        value={token}
        onChange={setToken}
        type="password"
      />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
        <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onSave({ clientId, ...(token ? { botToken: token } : {}) })}>
          Save
        </button>
        <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onRestart()}>
          Restart Bot
        </button>
      </div>
      {cfg.botStatus.message && (
        <p style={{ ...helpStyle, color: 'var(--err, #f87171)' }}>{cfg.botStatus.message}</p>
      )}
    </div>
  );
}

function GuildsTab({
  cfg,
  busy,
  onAdd,
  onRemove,
}: {
  cfg: DiscordConfigRedacted;
  busy: boolean;
  onAdd: (g: string) => void;
  onRemove: (g: string) => void;
}) {
  const [next, setNext] = useState('');
  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <p style={helpStyle}>
        The bot auto-leaves any server whose ID is not in this list. Enable Discord Developer
        Mode (Settings → Advanced) to copy server IDs.
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
      {cfg.allowedGuilds.length === 0 ? (
        <div style={helpStyle}>No guilds allowlisted yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.3rem' }}>
          {cfg.allowedGuilds.map((g) => {
            const connected = cfg.botStatus.connectedGuildIds.includes(g);
            return (
              <li key={g} style={rowStyle}>
                <code style={{ fontSize: '0.8rem' }}>{g}</code>
                <span style={{ fontSize: '0.7rem', color: connected ? 'var(--ok, #4ade80)' : 'var(--text-dim)' }}>
                  {connected ? 'connected' : 'not connected'}
                </span>
                <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onRemove(g)}>Remove</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

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
    </div>
  );
}

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

function LabeledInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: '0.2rem' }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

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
