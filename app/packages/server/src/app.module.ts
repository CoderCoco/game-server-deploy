import {
  MiddlewareConsumer,
  Module,
  NestModule,
  type NestMiddleware,
  Injectable,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import { AwsModule } from './modules/aws.module.js';
import { DiscordModule } from './modules/discord.module.js';
import { GamesController } from './controllers/games.controller.js';
import { ConfigController } from './controllers/config.controller.js';
import { CostsController } from './controllers/costs.controller.js';
import { LogsController } from './controllers/logs.controller.js';
import { FilesController } from './controllers/files.controller.js';
import { DiscordController } from './controllers/discord.controller.js';
import { ApiTokenGuard } from './guards/api-token.guard.js';
import { logger } from './logger.js';

/** Request logger middleware — emits one line per request with status + latency. */
@Injectable()
class RequestLoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
      logger.log(level, `${req.method} ${req.path}`, {
        status: res.statusCode,
        ms,
        query: Object.keys(req.query).length ? req.query : undefined,
      });
    });
    next();
  }
}

@Module({
  imports: [AwsModule, DiscordModule],
  controllers: [
    GamesController,
    ConfigController,
    CostsController,
    LogsController,
    FilesController,
    DiscordController,
  ],
  providers: [{ provide: APP_GUARD, useClass: ApiTokenGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
