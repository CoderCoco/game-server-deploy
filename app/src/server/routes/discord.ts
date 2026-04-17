import { Router } from 'express';
import {
  DiscordConfigService,
  type DiscordAdmins,
  type DiscordGamePermission,
} from '../services/DiscordConfigService.js';
import { DiscordBotService } from '../services/DiscordBotService.js';

export function createDiscordRouter(
  config: DiscordConfigService,
  bot: DiscordBotService,
): Router {
  const router = Router();

  router.get('/discord/config', (_req, res) => {
    res.json({ ...config.getRedacted(), botStatus: bot.getStatus() });
  });

  router.put('/discord/config', (req, res) => {
    const body = req.body as { botToken?: string; clientId?: string };
    config.setCredentials({
      ...(body.botToken !== undefined ? { botToken: body.botToken } : {}),
      ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
    });
    res.json({ success: true, config: config.getRedacted() });
  });

  router.get('/discord/guilds', (_req, res) => {
    res.json({ guilds: config.getConfig().allowedGuilds });
  });

  router.post('/discord/guilds', (req, res) => {
    const { guildId } = req.body as { guildId?: string };
    if (!guildId || typeof guildId !== 'string') {
      res.status(400).json({ error: 'guildId required' });
      return;
    }
    config.addAllowedGuild(guildId);
    res.json({ success: true, guilds: config.getConfig().allowedGuilds });
  });

  router.delete('/discord/guilds/:guildId', (req, res) => {
    config.removeAllowedGuild(req.params['guildId']!);
    res.json({ success: true, guilds: config.getConfig().allowedGuilds });
  });

  router.get('/discord/admins', (_req, res) => {
    res.json(config.getConfig().admins);
  });

  router.put('/discord/admins', (req, res) => {
    const body = req.body as DiscordAdmins;
    config.setAdmins({
      userIds: body.userIds ?? [],
      roleIds: body.roleIds ?? [],
    });
    res.json({ success: true, admins: config.getConfig().admins });
  });

  router.get('/discord/permissions', (_req, res) => {
    res.json(config.getConfig().gamePermissions);
  });

  router.put('/discord/permissions/:game', (req, res) => {
    const body = req.body as DiscordGamePermission;
    config.setGamePermission(req.params['game']!, {
      userIds: body.userIds ?? [],
      roleIds: body.roleIds ?? [],
      actions: body.actions ?? [],
    });
    res.json({ success: true, permissions: config.getConfig().gamePermissions });
  });

  router.delete('/discord/permissions/:game', (req, res) => {
    config.deleteGamePermission(req.params['game']!);
    res.json({ success: true, permissions: config.getConfig().gamePermissions });
  });

  router.post('/discord/restart', async (_req, res) => {
    const result = await bot.restart();
    res.json({ success: result.success, message: result.message, botStatus: bot.getStatus() });
  });

  return router;
}
