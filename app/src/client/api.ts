// Typed API wrappers — all fetch calls go through here

export interface GameStatus {
  game: string;
  state: 'running' | 'starting' | 'stopped' | 'not_deployed' | 'error';
  publicIp?: string;
  hostname?: string;
  taskArn?: string;
  message?: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  taskArn?: string;
}

export interface WatchdogConfig {
  watchdog_interval_minutes: number;
  watchdog_idle_checks: number;
  watchdog_min_packets: number;
}

export interface GameEstimate {
  vcpu: number;
  memoryGb: number;
  costPerHour: number;
  costPerDay24h: number;
  costPerMonth4hpd: number;
}

export interface CostEstimates {
  games: Record<string, GameEstimate>;
  totalPerHourIfAllOn: number;
}

export interface ActualCosts {
  daily: { date: string; cost: number }[];
  total: number;
  currency: string;
  days: number;
  error?: string;
}

export interface FileMgrStatus {
  game: string;
  state: 'running' | 'starting' | 'stopped' | 'not_deployed';
  url?: string;
  taskArn?: string;
}

/** Discord slash-command action a user can be permitted to invoke on a game. */
export type DiscordAction = 'start' | 'stop' | 'status';

/** Users and roles with server-wide admin privileges (all commands on all games). */
export interface DiscordAdmins {
  userIds: string[];
  roleIds: string[];
}

/** Per-game permission entry: which users/roles can run which actions on this game. */
export interface DiscordGamePermission {
  userIds: string[];
  roleIds: string[];
  actions: DiscordAction[];
}

/** Live status of the Discord bot connection (populated by the server). */
export interface DiscordBotStatus {
  state: 'stopped' | 'starting' | 'running' | 'error';
  clientId: string | null;
  username: string | null;
  connectedGuildIds: string[];
  message?: string;
}

/**
 * The Discord bot config as returned by `GET /api/discord/config`. The bot
 * token itself is never sent to the client — `botTokenSet` indicates whether
 * one is configured on the server (via file or `DISCORD_BOT_TOKEN` env).
 */
export interface DiscordConfigRedacted {
  clientId: string;
  allowedGuilds: string[];
  admins: DiscordAdmins;
  gamePermissions: Record<string, DiscordGamePermission>;
  botTokenSet: boolean;
  botStatus: DiscordBotStatus;
}

const TOKEN_STORAGE_KEY = 'apiToken';

/** Read the stored API bearer token from localStorage (returns empty string if unset). */
export function getStoredApiToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Persist the API bearer token for subsequent requests. Clear with `''`. */
export function setStoredApiToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode, etc.); failures are non-fatal — user will just be re-prompted.
  }
}

/**
 * Module-level handler invoked whenever a `/api/*` call returns 401. The
 * `App` component registers one on mount so it can open the "enter API
 * token" modal; other call sites don't need to care.
 */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(h: (() => void) | null): void {
  unauthorizedHandler = h;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredApiToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    // Clear the stored token so the modal re-prompts instead of retrying with it.
    setStoredApiToken('');
    unauthorizedHandler?.();
    // Return a never-resolving promise rather than rejecting: many call sites
    // fire-and-forget (polling intervals, `void api.foo().then(...)`) without a
    // `.catch()`, and rejecting here would surface as unhandled rejections and
    // break those loops. The modal handles re-auth and reloads the page, so any
    // hanging promises are short-lived.
    return new Promise<T>(() => undefined);
  }
  return res.json() as Promise<T>;
}

export const api = {
  games: () => request<{ games: string[] }>('/api/games'),
  status: () => request<GameStatus[]>('/api/status'),
  statusGame: (game: string) => request<GameStatus>(`/api/status/${game}`),
  start: (game: string) => request<ActionResult>(`/api/start/${game}`, { method: 'POST' }),
  stop: (game: string) => request<ActionResult>(`/api/stop/${game}`, { method: 'POST' }),
  config: () => request<WatchdogConfig>('/api/config'),
  saveConfig: (cfg: WatchdogConfig) =>
    request<{ success: boolean; config: WatchdogConfig }>('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    }),
  costsEstimate: () => request<CostEstimates>('/api/costs/estimate'),
  costsActual: (days = 7) => request<ActualCosts>(`/api/costs/actual?days=${days}`),
  logs: (game: string, limit = 50) =>
    request<{ game: string; lines: string[] }>(`/api/logs/${game}?limit=${limit}`),
  filesMgrStatus: (game: string) => request<FileMgrStatus>(`/api/files/${game}`),
  filesMgrStart: (game: string) => request<ActionResult>(`/api/files/${game}/start`, { method: 'POST' }),
  filesMgrStop: (game: string) => request<ActionResult>(`/api/files/${game}/stop`, { method: 'POST' }),

  discordConfig: () => request<DiscordConfigRedacted>('/api/discord/config'),
  discordSaveCredentials: (body: { botToken?: string; clientId?: string }) =>
    request<{ success: boolean; config: DiscordConfigRedacted }>('/api/discord/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  discordAddGuild: (guildId: string) =>
    request<{ success: boolean; guilds: string[] }>('/api/discord/guilds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId }),
    }),
  discordRemoveGuild: (guildId: string) =>
    request<{ success: boolean; guilds: string[] }>(`/api/discord/guilds/${guildId}`, {
      method: 'DELETE',
    }),
  discordSaveAdmins: (admins: DiscordAdmins) =>
    request<{ success: boolean; admins: DiscordAdmins }>('/api/discord/admins', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(admins),
    }),
  discordSavePermission: (game: string, perm: DiscordGamePermission) =>
    request<{ success: boolean; permissions: Record<string, DiscordGamePermission> }>(
      `/api/discord/permissions/${game}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(perm),
      },
    ),
  discordDeletePermission: (game: string) =>
    request<{ success: boolean; permissions: Record<string, DiscordGamePermission> }>(
      `/api/discord/permissions/${game}`,
      { method: 'DELETE' },
    ),
  discordRestart: () =>
    request<{ success: boolean; message: string; botStatus: DiscordBotStatus }>(
      '/api/discord/restart',
      { method: 'POST' },
    ),
};
