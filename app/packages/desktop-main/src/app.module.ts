import { Module } from '@nestjs/common';
import { AwsModule } from './modules/aws.module.js';
import { DiscordModule } from './modules/discord.module.js';
import { GamesController } from './controllers/games.controller.js';
import { ConfigController } from './controllers/config.controller.js';
import { CostsController } from './controllers/costs.controller.js';
import { LogsController } from './controllers/logs.controller.js';
import { FilesController } from './controllers/files.controller.js';
import { DiscordController } from './controllers/discord.controller.js';
import { EnvController } from './controllers/env.controller.js';

/**
 * Root Nest module. Wires the feature modules (`AwsModule`, `DiscordModule`) to
 * the IPC controllers.
 */
@Module({
  imports: [AwsModule, DiscordModule],
  controllers: [
    GamesController,
    ConfigController,
    CostsController,
    LogsController,
    FilesController,
    DiscordController,
    EnvController,
  ],
  providers: [],
})
export class AppModule {}
