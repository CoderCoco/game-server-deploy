import { Router, type RequestHandler } from 'express';
import {
  DiscordConfigService,
  type DiscordAdmins,
  type DiscordGamePermission,
} from '../services/DiscordConfigService.js';
import { DiscordBotService } from '../services/DiscordBotService.js';

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

  /** `PUT /discord/config` — update bot token and/or client ID (fields are individually optional). */
  const putConfig: RequestHandler = (req, res) => {
    const body = req.body as { botToken?: string; clientId?: string };
    config.setCredentials({
      ...(body.botToken !== undefined ? { botToken: body.botToken } : {}),
      ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
    });
    res.json({ success: true, config: config.getRedacted() });
  };

  /** `GET /discord/guilds` — list guild IDs the bot is allowed to operate in. */
  const listGuilds: RequestHandler = (_req, res) => {
    res.json({ guilds: config.getConfig().allowedGuilds });
  };

  /** `POST /discord/guilds` — add a guild to the allowlist; body: `{ guildId: string }`. */
  const addGuild: RequestHandler = (req, res) => {
    const { guildId } = req.body as { guildId?: string };
    if (!guildId || typeof guildId !== 'string') {
      res.status(400).json({ error: 'guildId required' });
      return;
    }
    config.addAllowedGuild(guildId);
    res.json({ success: true, guilds: config.getConfig().allowedGuilds });
  };

  /** `DELETE /discord/guilds/:guildId` — remove a guild from the allowlist. */
  const removeGuild: RequestHandler = (req, res) => {
    config.removeAllowedGuild(req.params['guildId']!);
    res.json({ success: true, guilds: config.getConfig().allowedGuilds });
  };

  /** `GET /discord/admins` — return the server-wide admin user/role lists. */
  const getAdmins: RequestHandler = (_req, res) => {
    res.json(config.getConfig().admins);
  };

  /** `PUT /discord/admins` — replace the admin user/role lists. */
  const putAdmins: RequestHandler = (req, res) => {
    const body = req.body as DiscordAdmins;
    config.setAdmins({
      userIds: body.userIds ?? [],
      roleIds: body.roleIds ?? [],
    });
    res.json({ success: true, admins: config.getConfig().admins });
  };

  /** `GET /discord/permissions` — return the full per-game permission map. */
  const getPermissions: RequestHandler = (_req, res) => {
    res.json(config.getConfig().gamePermissions);
  };

  /** `PUT /discord/permissions/:game` — overwrite the permission entry for one game. */
  const putPermission: RequestHandler = (req, res) => {
    const body = req.body as DiscordGamePermission;
    config.setGamePermission(req.params['game']!, {
      userIds: body.userIds ?? [],
      roleIds: body.roleIds ?? [],
      actions: body.actions ?? [],
    });
    res.json({ success: true, permissions: config.getConfig().gamePermissions });
  };

  /** `DELETE /discord/permissions/:game` — remove the permission entry for one game. */
  const deletePermission: RequestHandler = (req, res) => {
    config.deleteGamePermission(req.params['game']!);
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
