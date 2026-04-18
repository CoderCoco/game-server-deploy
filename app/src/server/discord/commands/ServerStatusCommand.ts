import { Injectable } from '@nestjs/common';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ConfigService } from '../../services/ConfigService.js';
import { DiscordConfigService } from '../../services/DiscordConfigService.js';
import { EcsService } from '../../services/EcsService.js';
import { logger } from '../../logger.js';
import { GameOptionSlashCommand } from '../GameOptionSlashCommand.js';
import type { CommandContext } from '../SlashCommand.js';
import { formatGameStatus } from '../formatStatus.js';
import { ServerListCommand } from './ServerListCommand.js';

/**
 * `/server-status [game?]` — report status of a single game, or (when `game`
 * is omitted) fall through to {@link ServerListCommand} so the two commands
 * share one implementation of the multi-game view.
 */
@Injectable()
export class ServerStatusCommand extends GameOptionSlashCommand {
  constructor(
    config: ConfigService,
    discord: DiscordConfigService,
    private readonly ecs: EcsService,
    private readonly list: ServerListCommand,
  ) {
    super('server-status', 'status', config, discord);
  }

  /** @inheritDoc */
  override build() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('Show status of a game server (or all if omitted)')
      .addStringOption((o) =>
        o.setName('game').setDescription('Game to check').setRequired(false).setAutocomplete(true),
      )
      .toJSON();
  }

  /** @inheritDoc */
  override async execute(ctx: CommandContext): Promise<void> {
    const game = ctx.interaction.options.getString('game') ?? undefined;
    if (!game) {
      // `/server-status` with no arg behaves exactly like `/server-list`.
      await this.list.execute(ctx);
      return;
    }
    if (!ctx.invoker.canRun(game, this.action)) {
      logger.warn('Discord command denied', {
        guildId: ctx.invoker.guildId,
        userId: ctx.invoker.userId,
        command: this.name,
        game,
      });
      await ctx.interaction.reply({
        content: `You don't have permission to ${this.action} **${game}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    logger.info('Discord command dispatching', {
      command: this.name,
      userId: ctx.invoker.userId,
      guildId: ctx.invoker.guildId,
      game,
    });
    await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const status = await this.ecs.getStatus(game);
      await ctx.interaction.editReply(formatGameStatus(status));
      logger.info('Discord command completed', { command: this.name, game });
    } catch (err) {
      logger.error('Discord command execution failed', { err, command: this.name, game });
      await ctx.interaction.editReply('❌ Command failed. Check server logs.');
    }
  }
}
