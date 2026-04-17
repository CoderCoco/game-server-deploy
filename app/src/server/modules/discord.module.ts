import { Module } from '@nestjs/common';
import { AwsModule } from './aws.module.js';
import { DiscordConfigService } from '../services/DiscordConfigService.js';
import { DiscordBotService } from '../services/DiscordBotService.js';
import { SlashCommandRegistry } from '../discord/SlashCommandRegistry.js';
import { ServerStartCommand } from '../discord/commands/ServerStartCommand.js';
import { ServerStopCommand } from '../discord/commands/ServerStopCommand.js';
import { ServerStatusCommand } from '../discord/commands/ServerStatusCommand.js';
import { ServerListCommand } from '../discord/commands/ServerListCommand.js';

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
  ],
  exports: [DiscordConfigService, DiscordBotService],
})
export class DiscordModule {}
