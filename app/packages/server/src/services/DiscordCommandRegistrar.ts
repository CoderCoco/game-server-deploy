/**
 * DiscordCommandRegistrar — calls Discord's REST API to install our four
 * slash commands into a single guild.
 *
 * Replaces the on-`ready` and on-`guildCreate` registration that the old
 * always-on `DiscordBotService` did. With the bot now serverless, there is no
 * gateway connection to react to those events; instead the operator clicks
 * "Register commands" in the web UI for each allowlisted guild.
 *
 * Uses native `fetch` rather than `discord.js` so we don't reintroduce the
 * dependency we just removed.
 */
import { Injectable } from '@nestjs/common';
import { logger } from '../logger.js';
import { DiscordConfigService } from './DiscordConfigService.js';
import { COMMAND_DESCRIPTORS } from '@gsd/shared';

const DISCORD_API = 'https://discord.com/api/v10';

export interface RegisterResult {
  success: boolean;
  message: string;
}

@Injectable()
export class DiscordCommandRegistrar {
  constructor(private readonly discord: DiscordConfigService) {}

  /**
   * Install (or overwrite) the four game-server slash commands in a single
   * Discord guild. The underlying endpoint is `PUT /applications/{app_id}/
   * guilds/{guild_id}/commands` with the full command descriptor array as
   * the body — Discord replaces everything for that guild in one call.
   *
   * Returns a `RegisterResult` the controller can surface verbatim:
   *  - Success: `{ success: true, message: 'Registered N commands in guild {id}.' }`
   *  - Missing client ID / token: `success: false` with an actionable message.
   *  - Non-2xx from Discord: status + response body passed through.
   *  - Network/unexpected error: `Request failed: <error>`.
   */
  async registerForGuild(guildId: string): Promise<RegisterResult> {
    if (!guildId) return { success: false, message: 'guildId is required' };

    const cfg = await this.discord.getConfig();
    const clientId = cfg.clientId;
    if (!clientId) {
      return { success: false, message: 'clientId is not configured. Save it in the Credentials tab.' };
    }
    const token = await this.discord.getEffectiveToken();
    if (!token) {
      return { success: false, message: 'Bot token is not configured. Save it in the Credentials tab.' };
    }

    const url = `${DISCORD_API}/applications/${clientId}/guilds/${guildId}/commands`;
    try {
      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${token}`,
        },
        body: JSON.stringify(COMMAND_DESCRIPTORS),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        logger.warn('Discord command registration failed', { status: resp.status, body, guildId });
        return { success: false, message: `Discord returned ${resp.status}: ${body || 'no body'}` };
      }
      logger.info('Discord commands registered', { guildId, count: COMMAND_DESCRIPTORS.length });
      return { success: true, message: `Registered ${COMMAND_DESCRIPTORS.length} commands in guild ${guildId}.` };
    } catch (err) {
      logger.error('Discord command registration threw', { err, guildId });
      return { success: false, message: `Request failed: ${String(err)}` };
    }
  }
}
