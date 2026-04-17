import { Injectable } from '@nestjs/common';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { ServerStartCommand } from './commands/ServerStartCommand.js';
import { ServerStopCommand } from './commands/ServerStopCommand.js';
import { ServerStatusCommand } from './commands/ServerStatusCommand.js';
import { ServerListCommand } from './commands/ServerListCommand.js';
import type { SlashCommand } from './SlashCommand.js';

/**
 * Indexed collection of every registered {@link SlashCommand}.
 *
 * `DiscordBotService` looks up the command for an incoming interaction here
 * instead of switching on `commandName` inline. New commands are added by
 * constructing a class that extends `SlashCommand` (or `GameOptionSlashCommand`)
 * and wiring it into both `discord.module.ts` and this registry's constructor.
 */
@Injectable()
export class SlashCommandRegistry {
  private readonly commands: Map<string, SlashCommand>;

  constructor(
    start: ServerStartCommand,
    stop: ServerStopCommand,
    status: ServerStatusCommand,
    list: ServerListCommand,
  ) {
    this.commands = new Map();
    for (const cmd of [start, stop, status, list] as SlashCommand[]) {
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
  buildAll(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    return this.all().map((c) => c.build());
  }
}
