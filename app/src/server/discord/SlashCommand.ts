import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { DiscordAction } from '../services/DiscordConfigService.js';
import type { CommandInvoker } from './CommandInvoker.js';

/** Context passed to a command's `execute()` — the interaction plus resolved invoker. */
export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  invoker: CommandInvoker;
}

/** Context for an `autocomplete()` call — includes the focused option the user is typing into. */
export interface AutocompleteContext {
  interaction: AutocompleteInteraction;
  invoker: CommandInvoker;
  focused: { name: string; value: string };
}

/**
 * Contract every slash command implements. One subclass per Discord command;
 * each is a Nest `@Injectable()` provider and is registered in
 * {@link SlashCommandRegistry}.
 *
 * Split of responsibilities:
 * - `build()` returns the Discord-facing command descriptor (name, options).
 * - `execute()` runs after the dispatcher has verified the interaction is in
 *   an allowlisted guild — the command itself performs its permission check
 *   (via `ctx.invoker.canRun`) and dispatches to whichever service it needs.
 * - `action` names the permission bucket checked by
 *   {@link DiscordConfigService.canRun}. The dispatcher uses it for autocomplete
 *   filtering too: `/server-start <tab>` only shows games the user has the
 *   `start` action on.
 * - `autocomplete()` handles option-autocomplete; commands without options
 *   inherit the default no-op.
 */
export abstract class SlashCommand {
  /** The Discord command name (without the leading slash). */
  abstract readonly name: string;
  /** Permission bucket for {@link DiscordConfigService.canRun} lookups. */
  abstract readonly action: DiscordAction;

  /** Serialize the command's name/description/options into the Discord REST payload. */
  abstract build(): RESTPostAPIChatInputApplicationCommandsJSONBody;

  /** Handle a slash-command invocation. The dispatcher has already verified guild + allowlist. */
  abstract execute(ctx: CommandContext): Promise<void>;

  /**
   * Handle option autocomplete. Default is a no-op for commands with no
   * options; commands with a `game` option override this.
   */
  async autocomplete(_ctx: AutocompleteContext): Promise<void> {
    // no-op by default
  }
}
