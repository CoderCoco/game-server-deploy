import { Injectable } from '@nestjs/common';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ConfigService } from '../../services/ConfigService.js';
import { type DiscordAction } from '../../services/DiscordConfigService.js';
import { EcsService } from '../../services/EcsService.js';
import { logger } from '../../logger.js';
import { SlashCommand, type CommandContext } from '../SlashCommand.js';
import { formatGameStatus } from '../formatStatus.js';

/**
 * `/server-list` — print a status summary filtered to the games the caller
 * has `status` permission on. Admins see everything.
 *
 * Also the shared implementation for `/server-status` with no `game` arg —
 * `ServerStatusCommand` delegates to this class in that branch rather than
 * duplicating the logic.
 */
@Injectable()
export class ServerListCommand extends SlashCommand {
  readonly name = 'server-list';
  readonly action: DiscordAction = 'status';

  constructor(
    private readonly config: ConfigService,
    private readonly ecs: EcsService,
  ) {
    super();
  }

  build() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('List all configured game servers and their state')
      .toJSON();
  }

  async execute(ctx: CommandContext): Promise<void> {
    // Re-read Terraform state so the list reflects recent deploys (matches
    // /api/status behavior — see routes/games.ts).
    this.config.invalidateCache();
    const games = this.config.getTfOutputs()?.game_names ?? [];
    if (!games.length) {
      await ctx.interaction.reply({ content: 'No games configured.', flags: MessageFlags.Ephemeral });
      return;
    }
    const visible = games.filter((g) => ctx.invoker.canRun(g, 'status'));
    if (!visible.length) {
      logger.warn('Discord list/status command denied (no visible games)', {
        guildId: ctx.invoker.guildId,
        userId: ctx.invoker.userId,
        command: ctx.interaction.commandName,
      });
      await ctx.interaction.reply({
        content: "You don't have permission to view any server statuses.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const statuses = await Promise.all(visible.map((g) => this.ecs.getStatus(g)));
      const lines = statuses.map((s) => formatGameStatus(s));
      await ctx.interaction.editReply(lines.join('\n'));
    } catch (err) {
      logger.error('Failed to fetch Discord server statuses', {
        err,
        guildId: ctx.invoker.guildId,
        userId: ctx.invoker.userId,
        command: ctx.interaction.commandName,
        visibleGames: visible,
      });
      const content = '❌ Could not fetch server statuses right now. Check server logs.';
      // deferReply may or may not have succeeded; pick the matching finisher
      // so we don't throw "already replied" on top of the original failure.
      if (ctx.interaction.deferred || ctx.interaction.replied) {
        await ctx.interaction.editReply(content).catch(() => undefined);
      } else {
        await ctx.interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  }
}
