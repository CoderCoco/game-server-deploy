import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  DiscordConfigService,
  type DiscordAction,
} from '../services/DiscordConfigService.js';
import { DiscordCommandRegistrar } from '../services/DiscordCommandRegistrar.js';
import { ConfigService } from '../services/ConfigService.js';

/**
 * Verify a body field is either missing or an array of strings. Returns the
 * validated array (empty if the field was omitted), or throws
 * `BadRequestException` which Nest maps to a 400 with the same shape the
 * legacy Express handlers used.
 */
function requireStringArray(field: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BadRequestException({
      success: false,
      error: `${field} must be an array of strings`,
    });
  }
  return value as string[];
}

@Controller('discord')
export class DiscordController {
  constructor(
    private readonly discord: DiscordConfigService,
    private readonly registrar: DiscordCommandRegistrar,
    private readonly config: ConfigService,
  ) {}

  @Get('config')
  async getConfig() {
    const redacted = await this.discord.getRedacted();
    return { ...redacted, interactionsEndpointUrl: this.config.getTfOutputs()?.interactions_invoke_url ?? null };
  }

  @Put('config')
  async putConfig(
    @Body() body: { botToken?: unknown; clientId?: unknown; publicKey?: unknown } = {},
  ) {
    if (body.botToken !== undefined && typeof body.botToken !== 'string') {
      throw new BadRequestException({ success: false, error: 'botToken must be a string' });
    }
    if (body.clientId !== undefined && typeof body.clientId !== 'string') {
      throw new BadRequestException({ success: false, error: 'clientId must be a string' });
    }
    if (body.publicKey !== undefined && typeof body.publicKey !== 'string') {
      throw new BadRequestException({ success: false, error: 'publicKey must be a string' });
    }
    const ok = await this.discord.setCredentials({
      ...(body.botToken !== undefined ? { botToken: body.botToken } : {}),
      ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
      ...(body.publicKey !== undefined ? { publicKey: body.publicKey } : {}),
    });
    if (!ok) throw new BadRequestException({ success: false, error: 'invalid credentials' });
    const redacted = await this.discord.getRedacted();
    return {
      success: true,
      config: { ...redacted, interactionsEndpointUrl: this.config.getTfOutputs()?.interactions_invoke_url ?? null },
    };
  }

  @Get('guilds')
  async listGuilds() {
    return { guilds: (await this.discord.getConfig()).allowedGuilds };
  }

  @Post('guilds')
  async addGuild(@Body() body: { guildId?: unknown } = {}) {
    if (typeof body.guildId !== 'string') {
      throw new BadRequestException({ success: false, error: 'guildId required' });
    }
    const guildId = body.guildId.trim();
    if (!guildId) throw new BadRequestException({ success: false, error: 'guildId required' });
    await this.discord.addAllowedGuild(guildId);
    return { success: true, guilds: (await this.discord.getConfig()).allowedGuilds };
  }

  @Delete('guilds/:guildId')
  async removeGuild(@Param('guildId') guildIdRaw: string) {
    const guildId = (guildIdRaw ?? '').trim();
    if (!guildId) throw new BadRequestException({ success: false, error: 'guildId required' });
    await this.discord.removeAllowedGuild(guildId);
    return { success: true, guilds: (await this.discord.getConfig()).allowedGuilds };
  }

  @Post('guilds/:guildId/register-commands')
  async registerCommands(@Param('guildId') guildIdRaw: string) {
    const guildId = (guildIdRaw ?? '').trim();
    if (!guildId) throw new BadRequestException({ success: false, error: 'guildId required' });
    return this.registrar.registerForGuild(guildId);
  }

  @Get('admins')
  async getAdmins() {
    return (await this.discord.getConfig()).admins;
  }

  @Put('admins')
  async putAdmins(@Body() body: { userIds?: unknown; roleIds?: unknown } = {}) {
    const userIds = requireStringArray('userIds', body.userIds);
    const roleIds = requireStringArray('roleIds', body.roleIds);
    await this.discord.setAdmins({ userIds, roleIds });
    return { success: true, admins: (await this.discord.getConfig()).admins };
  }

  @Get('permissions')
  async getPermissions() {
    return (await this.discord.getConfig()).gamePermissions;
  }

  @Put('permissions/:game')
  async putPermission(
    @Param('game') game: string,
    @Body() body: { userIds?: unknown; roleIds?: unknown; actions?: unknown } = {},
  ) {
    const userIds = requireStringArray('userIds', body.userIds);
    const roleIds = requireStringArray('roleIds', body.roleIds);
    const actions = requireStringArray('actions', body.actions);
    const written = await this.discord.setGamePermission(game, {
      userIds,
      roleIds,
      actions: actions as DiscordAction[],
    });
    if (!written) {
      throw new BadRequestException({ success: false, error: `invalid game key: ${game}` });
    }
    return { success: true, permissions: (await this.discord.getConfig()).gamePermissions };
  }

  @Delete('permissions/:game')
  async deletePermission(@Param('game') game: string) {
    const deleted = await this.discord.deleteGamePermission(game);
    if (!deleted) {
      throw new BadRequestException({ success: false, error: `invalid game key: ${game}` });
    }
    return { success: true, permissions: (await this.discord.getConfig()).gamePermissions };
  }
}
