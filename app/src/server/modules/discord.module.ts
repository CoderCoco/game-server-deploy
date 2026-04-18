import { Module } from '@nestjs/common';
import { AwsModule } from './aws.module.js';
import { DiscordConfigService } from '../services/DiscordConfigService.js';
import { DiscordBotService } from '../services/DiscordBotService.js';
import { SLASH_COMMANDS, SlashCommandRegistry } from '../discord/SlashCommandRegistry.js';
import type { SlashCommand } from '../discord/SlashCommand.js';
import { ServerStartCommand } from '../discord/commands/ServerStartCommand.js';
import { ServerStopCommand } from '../discord/commands/ServerStopCommand.js';
import { ServerStatusCommand } from '../discord/commands/ServerStatusCommand.js';
import { ServerListCommand } from '../discord/commands/ServerListCommand.js';

/**
 * Factory provider that gathers every concrete {@link SlashCommand} into the
 * `SLASH_COMMANDS` array. This is the single place to edit when adding a new
 * slash command — register the class as a provider below and add it to both
 * this factory's `inject` list and its returned array.
 *
 * Nest doesn't support Angular-style `multi: true` provider registration, so
 * this factory is the idiomatic way to inject "all providers of type T" as a
 * single array.
 */
const slashCommandsProvider = {
  provide: SLASH_COMMANDS,
  useFactory: (...cmds: SlashCommand[]): SlashCommand[] => cmds,
  inject: [ServerStartCommand, ServerStopCommand, ServerStatusCommand, ServerListCommand],
};

@Module({
  imports: [AwsModule],
  providers: [
    DiscordConfigService,
    DiscordBotService,
    SlashCommandRegistry,
    ServerStartCommand,
    ServerStopCommand,
    ServerStatusCommand,
    ServerListCommand,
    slashCommandsProvider,
  ],
  exports: [DiscordConfigService, DiscordBotService],
})
export class DiscordModule {}
