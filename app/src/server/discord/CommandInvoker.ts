import {
  GuildMember,
  type APIInteractionGuildMember,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { DiscordAction, DiscordConfigService } from '../services/DiscordConfigService.js';

/** The union shape discord.js gives us for `interaction.member` on a guild command. */
type InteractionMember = GuildMember | APIInteractionGuildMember;

/**
 * Per-interaction bundle of "who is calling this command, and what may they do".
 *
 * Centralizes the (guildId, userId, roleIds) tuple that every command and
 * autocomplete handler needs, plus exposes a `canRun` that defers to the
 * shared {@link DiscordConfigService.canRun} resolver. Commands never have to
 * touch the raw `interaction.member` shape — {@link CommandInvoker.from}
 * discriminates between `GuildMember` (cached) and `APIInteractionGuildMember`
 * (uncached) in one place, so the old `as { roles?: unknown }` cast that
 * review feedback on #7 flagged is no longer needed.
 */
export class CommandInvoker {
  constructor(
    private readonly discord: DiscordConfigService,
    /** The guild the interaction originated in. */
    public readonly guildId: string,
    /** The Discord user ID of the caller. */
    public readonly userId: string,
    /** All role IDs the caller holds in `guildId`. */
    public readonly roleIds: string[],
  ) {}

  /**
   * Build an invoker from a slash-command or autocomplete interaction.
   * Returns `null` when the interaction is not in a guild — the dispatcher
   * handles that case separately (reply / empty-respond) so commands can
   * assume a real guild context.
   */
  static from(
    interaction: ChatInputCommandInteraction | AutocompleteInteraction,
    discord: DiscordConfigService,
  ): CommandInvoker | null {
    const guildId = interaction.guildId;
    if (!guildId) return null;
    return new CommandInvoker(
      discord,
      guildId,
      interaction.user.id,
      CommandInvoker.extractRoleIds(interaction.member),
    );
  }

  /** Delegate to {@link DiscordConfigService.canRun} with this invoker's identity. */
  canRun(game: string, action: DiscordAction): boolean {
    return this.discord.canRun({
      guildId: this.guildId,
      userId: this.userId,
      roleIds: this.roleIds,
      game,
      action,
    });
  }

  /**
   * Pull role IDs out of `interaction.member` across both shapes discord.js
   * produces:
   * - `GuildMember` (cached) — `.roles.cache` is a Collection keyed by role ID.
   * - `APIInteractionGuildMember` (uncached) — `.roles` is a `readonly string[]`.
   *
   * `null` means no member context (shouldn't happen for guild commands).
   */
  static extractRoleIds(member: InteractionMember | null): string[] {
    if (!member) return [];
    if (member instanceof GuildMember) {
      return [...member.roles.cache.keys()];
    }
    return [...member.roles];
  }
}
