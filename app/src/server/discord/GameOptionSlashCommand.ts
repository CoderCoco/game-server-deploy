import { ConfigService } from '../services/ConfigService.js';
import { DiscordConfigService } from '../services/DiscordConfigService.js';
import { SlashCommand, type AutocompleteContext } from './SlashCommand.js';

/**
 * Shared base for every command that takes a `game` option with autocomplete
 * (`/server-start`, `/server-stop`, `/server-status`).
 *
 * The autocomplete flow is identical for all three — re-read the Terraform
 * state, filter by the user's partial input, then filter again by
 * `canRun(game, this.action)` so the suggestion list matches the permission
 * check done at execution time. Keeping this in one place avoids the three
 * commands drifting out of sync.
 */
export abstract class GameOptionSlashCommand extends SlashCommand {
  constructor(
    protected readonly config: ConfigService,
    protected readonly discord: DiscordConfigService,
  ) {
    super();
  }

  override async autocomplete(ctx: AutocompleteContext): Promise<void> {
    if (ctx.focused.name !== 'game') return;
    this.config.invalidateCache();
    const games = this.config.getTfOutputs()?.game_names ?? [];
    const query = ctx.focused.value.toLowerCase();
    const matches = games
      .filter((g) => g.toLowerCase().includes(query))
      .filter((g) => ctx.invoker.canRun(g, this.action))
      .slice(0, 25)
      .map((g) => ({ name: g, value: g }));
    await ctx.interaction.respond(matches).catch(() => undefined);
  }
}
