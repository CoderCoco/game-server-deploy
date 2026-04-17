import { Module } from '@nestjs/common';
import { AwsModule } from './aws.module.js';
import { DiscordConfigService } from '../services/DiscordConfigService.js';
import { DiscordBotService } from '../services/DiscordBotService.js';

@Module({
  imports: [AwsModule],
  providers: [DiscordConfigService, DiscordBotService],
  exports: [DiscordConfigService, DiscordBotService],
})
export class DiscordModule {}
