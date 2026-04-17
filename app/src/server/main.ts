import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import { AppModule } from './app.module.js';
import { ConfigService } from './services/ConfigService.js';
import { DiscordConfigService } from './services/DiscordConfigService.js';
import { DiscordBotService } from './services/DiscordBotService.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const isDev = process.env['NODE_ENV'] !== 'production';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Refuse to start in production without an API token — this is where
  // Copilot (PR #4) flagged the un-authenticated exposure risk.
  const configService = app.get(ConfigService);
  if (!isDev && !configService.getApiToken()) {
    logger.error(
      'NODE_ENV=production but no API_TOKEN is configured (neither env nor server_config.json.api_token). Refusing to start. ' +
        'Set API_TOKEN or api_token to a random secret before running in production.',
    );
    process.exit(1);
  }

  app.setGlobalPrefix('api');

  // Serve the Vite-built React app in production. Both handlers short-circuit
  // on `/api` paths so they never shadow controllers or Nest's 404 handler —
  // Copilot (PR #8) flagged that a naive `.get('*')` can intercept API routes
  // because Nest registers its routes later during `listen()`/init and also
  // installs its own not-found handler at the end of the Express stack.
  if (!isDev) {
    // dist/server/main.js → ../client gives dist/client (vite's build.outDir).
    const clientDist = join(__dirname, '../client');
    const httpAdapter = app.getHttpAdapter().getInstance() as express.Express;
    const staticHandler = express.static(clientDist);
    const isApiRequest = (req: express.Request): boolean =>
      req.path === '/api' || req.path.startsWith('/api/');
    httpAdapter.use((req, res, next) => {
      if (isApiRequest(req)) return next();
      staticHandler(req, res, next);
    });
    httpAdapter.get('*', (req, res, next) => {
      if (isApiRequest(req)) return next();
      res.sendFile(join(clientDist, 'index.html'));
    });
  }

  await app.listen(PORT);
  logger.info(`Game Server Manager API running on http://localhost:${PORT}`, {
    mode: isDev ? 'development' : 'production',
    port: PORT,
  });

  // Auto-start the Discord bot if a token is configured. Failures are logged but non-fatal.
  const discordConfig = app.get(DiscordConfigService);
  const discordBot = app.get(DiscordBotService);
  if (discordConfig.getEffectiveToken()) {
    void discordBot.start().then((r) => {
      if (!r.success) logger.warn('Discord bot did not start', { message: r.message });
    });
  } else {
    logger.info('Discord bot token not configured — bot remains stopped.');
  }
}

void bootstrap();
