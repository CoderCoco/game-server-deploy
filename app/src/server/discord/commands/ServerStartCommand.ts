import { Injectable } from '@nestjs/common';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ConfigService } from '../../services/ConfigService.js';
import { DiscordConfigService, type DiscordAction } from '../../services/DiscordConfigService.js';
import { EcsService } from '../../services/EcsService.js';
import { logger } from '../../logger.js';
import { GameOptionSlashCommand } from '../GameOptionSlashCommand.js';
import type { CommandContext } from '../SlashCommand.js';

/** `/server-start <game>` — start a configured game server via ECS `RunTask`. */
@Injectable()
export class ServerStartCommand extends GameOptionSlashCommand {
  readonly name = 'server-start';
  readonly action: DiscordAction = 'start';

  constructor(
    config: ConfigService,
    discord: DiscordConfigService,
    private readonly ecs: EcsService,
  ) {
    super(config, discord);
  }

  build() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('Start a game server')
      .addStringOption((o) =>
        o.setName('game').setDescription('Game to start').setRequired(true).setAutocomplete(true),
      )
      .toJSON();
  }

  async execute(ctx: CommandContext): Promise<void> {
    const game = ctx.interaction.options.getString('game') ?? undefined;
    if (!game) {
      await ctx.interaction.reply({ content: 'Game is required.', flags: MessageFlags.Ephemeral });
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
      const result = await this.ecs.start(game);
      await ctx.interaction.editReply((result.success ? '✅ ' : '❌ ') + result.message);
      logger.info('Discord command completed', { command: this.name, game });
    } catch (err) {
      logger.error('Discord command execution failed', { err, command: this.name, game });
      await ctx.interaction.editReply('❌ Command failed. Check server logs.');
    }
  }
}
