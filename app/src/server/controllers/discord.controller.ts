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
import { DiscordBotService } from '../services/DiscordBotService.js';

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
    private readonly config: DiscordConfigService,
    private readonly bot: DiscordBotService,
  ) {}

  @Get('config')
  getConfig() {
    return { ...this.config.getRedacted(), botStatus: this.bot.getStatus() };
  }

  @Put('config')
  putConfig(@Body() body: { botToken?: unknown; clientId?: unknown } = {}) {
    if (body.botToken !== undefined && typeof body.botToken !== 'string') {
      throw new BadRequestException({ success: false, error: 'botToken must be a string' });
    }
    if (body.clientId !== undefined && typeof body.clientId !== 'string') {
      throw new BadRequestException({ success: false, error: 'clientId must be a string' });
    }
    const ok = this.config.setCredentials({
      ...(body.botToken !== undefined ? { botToken: body.botToken } : {}),
      ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
    });
    if (!ok) {
      throw new BadRequestException({ success: false, error: 'invalid credentials' });
    }
    return {
      success: true,
      config: { ...this.config.getRedacted(), botStatus: this.bot.getStatus() },
    };
  }

  @Get('guilds')
  listGuilds() {
    return { guilds: this.config.getConfig().allowedGuilds };
  }

  @Post('guilds')
  addGuild(@Body() body: { guildId?: unknown } = {}) {
    if (typeof body.guildId !== 'string') {
      throw new BadRequestException({ success: false, error: 'guildId required' });
    }
    const guildId = body.guildId.trim();
    if (!guildId) {
      throw new BadRequestException({ success: false, error: 'guildId required' });
    }
    this.config.addAllowedGuild(guildId);
    return { success: true, guilds: this.config.getConfig().allowedGuilds };
  }

  @Delete('guilds/:guildId')
  removeGuild(@Param('guildId') guildIdRaw: string) {
    const guildId = (guildIdRaw ?? '').trim();
    if (!guildId) {
      throw new BadRequestException({ success: false, error: 'guildId required' });
    }
    this.config.removeAllowedGuild(guildId);
    return { success: true, guilds: this.config.getConfig().allowedGuilds };
  }

  @Get('admins')
  getAdmins() {
    return this.config.getConfig().admins;
  }

  @Put('admins')
  putAdmins(@Body() body: { userIds?: unknown; roleIds?: unknown } = {}) {
    const userIds = requireStringArray('userIds', body.userIds);
    const roleIds = requireStringArray('roleIds', body.roleIds);
    this.config.setAdmins({ userIds, roleIds });
    return { success: true, admins: this.config.getConfig().admins };
  }

  @Get('permissions')
  getPermissions() {
    return this.config.getConfig().gamePermissions;
  }

  @Put('permissions/:game')
  putPermission(
    @Param('game') game: string,
    @Body() body: { userIds?: unknown; roleIds?: unknown; actions?: unknown } = {},
  ) {
    const userIds = requireStringArray('userIds', body.userIds);
    const roleIds = requireStringArray('roleIds', body.roleIds);
    const actions = requireStringArray('actions', body.actions);
    const written = this.config.setGamePermission(game, {
      userIds,
      roleIds,
      actions: actions as DiscordAction[],
    });
    if (!written) {
      throw new BadRequestException({ success: false, error: `invalid game key: ${game}` });
    }
    return { success: true, permissions: this.config.getConfig().gamePermissions };
  }

  @Delete('permissions/:game')
  deletePermission(@Param('game') game: string) {
    const deleted = this.config.deleteGamePermission(game);
    if (!deleted) {
      throw new BadRequestException({ success: false, error: `invalid game key: ${game}` });
    }
    return { success: true, permissions: this.config.getConfig().gamePermissions };
  }

  @Post('restart')
  async restart() {
    const result = await this.bot.restart();
    return { success: result.success, message: result.message, botStatus: this.bot.getStatus() };
  }
}
