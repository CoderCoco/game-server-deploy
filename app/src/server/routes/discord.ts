import { Router, type RequestHandler, type Response } from 'express';
import { DiscordConfigService, type DiscordAction } from '../services/DiscordConfigService.js';
import { DiscordBotService } from '../services/DiscordBotService.js';

/**
 * Verify a body field is either missing or an array of strings. On failure
 * writes a 400 with a specific error message and returns `null`. On success
 * returns the validated array (empty if the field was omitted).
 */
function requireStringArray(res: Response, field: string, value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    res.status(400).json({ success: false, error: `${field} must be an array of strings` });
    return null;
  }
  return value as string[];
}

/**
 * Build the Discord router. Each route is a small named handler declared
 * below so the responsibilities are easy to read and extend; services are
 * captured via closure so handlers don't need to thread them through params.
 */
export function createDiscordRouter(
  config: DiscordConfigService,
  bot: DiscordBotService,
): Router {
  const router = Router();

  /** `GET /discord/config` — return the client-safe config (no token) and live bot status. */
  const getConfig: RequestHandler = (_req, res) => {
    res.json({ ...config.getRedacted(), botStatus: bot.getStatus() });
  };

  /**
   * `PUT /discord/config` — update bot token and/or client ID (fields are individually optional).
   * Returns 400 if either field is present but not a string — we don't want
   * to persist garbage that would crash `client.login` on the next bot start.
   */
  const putConfig: RequestHandler = (req, res) => {
    const body = (req.body ?? {}) as { botToken?: unknown; clientId?: unknown };
    if (body.botToken !== undefined && typeof body.botToken !== 'string') {
      res.status(400).json({ success: false, error: 'botToken must be a string' });
      return;
    }
    if (body.clientId !== undefined && typeof body.clientId !== 'string') {
      res.status(400).json({ success: false, error: 'clientId must be a string' });
      return;
    }
    const ok = config.setCredentials({
      ...(body.botToken !== undefined ? { botToken: body.botToken } : {}),
      ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
    });
    if (!ok) {
      res.status(400).json({ success: false, error: 'invalid credentials' });
      return;
    }
    res.json({
      success: true,
      config: { ...config.getRedacted(), botStatus: bot.getStatus() },
    });
  };

  /** `GET /discord/guilds` — list guild IDs the bot is allowed to operate in. */
  const listGuilds: RequestHandler = (_req, res) => {
    res.json({ guilds: config.getConfig().allowedGuilds });
  };

  /**
   * `POST /discord/guilds` — add a guild to the allowlist; body: `{ guildId: string }`.
   * Trims whitespace so a pasted ID with surrounding newlines/spaces doesn't get
   * stored and then silently fail later allowlist checks.
   */
  const addGuild: RequestHandler = (req, res) => {
    const raw = (req.body as { guildId?: unknown })?.guildId;
    if (typeof raw !== 'string') {
      res.status(400).json({ success: false, error: 'guildId required' });
      return;
    }
    const guildId = raw.trim();
    if (!guildId) {
      res.status(400).json({ success: false, error: 'guildId required' });
      return;
    }
    config.addAllowedGuild(guildId);
    res.json({ success: true, guilds: config.getConfig().allowedGuilds });
  };

  /**
   * `DELETE /discord/guilds/:guildId` — remove a guild from the allowlist.
   * Trimmed so an ID with surrounding whitespace (e.g. URL-encoded weirdness)
   * still matches the stored value.
   */
  const removeGuild: RequestHandler = (req, res) => {
    const guildId = (req.params['guildId'] ?? '').trim();
    if (!guildId) {
      res.status(400).json({ success: false, error: 'guildId required' });
      return;
    }
    config.removeAllowedGuild(guildId);
    res.json({ success: true, guilds: config.getConfig().allowedGuilds });
  };

  /** `GET /discord/admins` — return the server-wide admin user/role lists. */
  const getAdmins: RequestHandler = (_req, res) => {
    res.json(config.getConfig().admins);
  };

  /**
   * `PUT /discord/admins` — replace the admin user/role lists.
   * Returns 400 if either field is present but not an array of strings.
   */
  const putAdmins: RequestHandler = (req, res) => {
    const body = (req.body ?? {}) as { userIds?: unknown; roleIds?: unknown };
    const userIds = requireStringArray(res, 'userIds', body.userIds);
    if (userIds === null) return;
    const roleIds = requireStringArray(res, 'roleIds', body.roleIds);
    if (roleIds === null) return;
    config.setAdmins({ userIds, roleIds });
    res.json({ success: true, admins: config.getConfig().admins });
  };

  /** `GET /discord/permissions` — return the full per-game permission map. */
  const getPermissions: RequestHandler = (_req, res) => {
    res.json(config.getConfig().gamePermissions);
  };

  /**
   * `PUT /discord/permissions/:game` — overwrite the permission entry for one game.
   * Returns 400 if the `:game` key is rejected as unsafe (prototype-pollution
   * guard) or if any of `userIds` / `roleIds` / `actions` isn't an array of strings.
   */
  const putPermission: RequestHandler = (req, res) => {
    const body = (req.body ?? {}) as {
      userIds?: unknown;
      roleIds?: unknown;
      actions?: unknown;
    };
    const userIds = requireStringArray(res, 'userIds', body.userIds);
    if (userIds === null) return;
    const roleIds = requireStringArray(res, 'roleIds', body.roleIds);
    if (roleIds === null) return;
    const actions = requireStringArray(res, 'actions', body.actions);
    if (actions === null) return;
    const game = req.params['game']!;
    const written = config.setGamePermission(game, {
      userIds,
      roleIds,
      actions: actions as DiscordAction[],
    });
    if (!written) {
      res.status(400).json({ success: false, error: `invalid game key: ${game}` });
      return;
    }
    res.json({ success: true, permissions: config.getConfig().gamePermissions });
  };

  /**
   * `DELETE /discord/permissions/:game` — remove the permission entry for one game.
   * Returns 400 if the `:game` key is rejected as unsafe.
   */
  const deletePermission: RequestHandler = (req, res) => {
    const game = req.params['game']!;
    const deleted = config.deleteGamePermission(game);
    if (!deleted) {
      res.status(400).json({ success: false, error: `invalid game key: ${game}` });
      return;
    }
    res.json({ success: true, permissions: config.getConfig().gamePermissions });
  };

  /** `POST /discord/restart` — stop and re-start the bot (picks up new credentials/allowlist). */
  const restartBot: RequestHandler = async (_req, res) => {
    const result = await bot.restart();
    res.json({ success: result.success, message: result.message, botStatus: bot.getStatus() });
  };

  router.get('/discord/config', getConfig);
  router.put('/discord/config', putConfig);
  router.get('/discord/guilds', listGuilds);
  router.post('/discord/guilds', addGuild);
  router.delete('/discord/guilds/:guildId', removeGuild);
  router.get('/discord/admins', getAdmins);
  router.put('/discord/admins', putAdmins);
  router.get('/discord/permissions', getPermissions);
  router.put('/discord/permissions/:game', putPermission);
  router.delete('/discord/permissions/:game', deletePermission);
  router.post('/discord/restart', restartBot);

  return router;
}
