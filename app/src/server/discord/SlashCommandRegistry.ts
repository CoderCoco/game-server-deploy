import { Inject, Injectable } from '@nestjs/common';
import type { SlashCommand, SlashCommandDescriptor } from './SlashCommand.js';

/**
 * Injection token for the `SlashCommand[]` array. Declared here so both the
 * registry (consumer) and the Discord module (producer, via its factory
 * provider) agree on one symbol. Using a symbol — not a string — avoids
 * accidental collisions with other providers.
 */
export const SLASH_COMMANDS = Symbol('SLASH_COMMANDS');

/**
 * Indexed collection of every registered {@link SlashCommand}.
 *
 * `DiscordBotService` looks up the command for an incoming interaction here
 * instead of switching on `commandName` inline. The concrete command classes
 * are not referenced from this file — they're gathered into a single array
 * by the `SLASH_COMMANDS` factory provider in `discord.module.ts`, which is
 * the one place that needs to be edited when a new command is added.
 */
@Injectable()
export class SlashCommandRegistry {
  private readonly commands: Map<string, SlashCommand>;

  constructor(@Inject(SLASH_COMMANDS) commands: SlashCommand[]) {
    this.commands = new Map();
    for (const cmd of commands) {
      this.commands.set(cmd.name, cmd);
    }
  }

  /** Look up a command by its Discord name; `undefined` if nothing is registered. */
  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  /** Every registered command, in insertion order. */
  all(): SlashCommand[] {
    return [...this.commands.values()];
  }

  /** Serialize every command's descriptor for a Discord REST PUT. */
  buildAll(): SlashCommandDescriptor[] {
    return this.all().map((c) => c.build());
  }
}
