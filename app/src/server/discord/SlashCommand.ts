import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { DiscordAction } from '../services/DiscordConfigService.js';
import type { CommandInvoker } from './CommandInvoker.js';

/** Context passed to a command's `execute()` — the interaction plus resolved invoker. */
export interface CommandContext {
  /** The live discord.js slash-command interaction this command is handling. */
  interaction: ChatInputCommandInteraction;
  /** Resolved identity + permission helper for whoever invoked the command. */
  invoker: CommandInvoker;
}

/** Context for an `autocomplete()` call — includes the focused option the user is typing into. */
export interface AutocompleteContext {
  /** The live discord.js autocomplete interaction being answered. */
  interaction: AutocompleteInteraction;
  /** Resolved identity + permission helper for the user typing in the option. */
  invoker: CommandInvoker;
  /** Name + partial value of the option the user is currently editing. */
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
 *
 * `name` and `action` are supplied by subclasses through `super(name, action)`
 * rather than being separately declared on each subclass — this keeps both
 * identity fields in one place and avoids the `abstract readonly` + override
 * pattern at every command.
 */
export abstract class SlashCommand {
  /**
   * @param name   The Discord command name (without the leading slash).
   * @param action Permission bucket for {@link DiscordConfigService.canRun} lookups.
   */
  protected constructor(
    public readonly name: string,
    public readonly action: DiscordAction,
  ) {}

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
