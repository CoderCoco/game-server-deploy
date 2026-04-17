import './container.js'; // must be first — sets up DI registrations
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { container } from 'tsyringe';
import { logger, requestLogger } from './logger.js';
import { createGamesRouter } from './routes/games.js';
import { createConfigRouter } from './routes/config.js';
import { createCostsRouter } from './routes/costs.js';
import { createLogsRouter } from './routes/logs.js';
import { createFilesRouter } from './routes/files.js';
import { ConfigService } from './services/ConfigService.js';
import { EcsService } from './services/EcsService.js';
import { Ec2Service } from './services/Ec2Service.js';
import { LogsService } from './services/LogsService.js';
import { CostService } from './services/CostService.js';
import { FileManagerService } from './services/FileManagerService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const isDev = process.env['NODE_ENV'] !== 'production';

const app = express();
app.use(express.json());
app.use(requestLogger);

// Resolve services from DI container
const configService = container.resolve(ConfigService);
const ecsService = container.resolve(EcsService);
const ec2Service = container.resolve(Ec2Service);
const logsService = container.resolve(LogsService);
const costService = container.resolve(CostService);
const fileManagerService = container.resolve(FileManagerService);

// Mount API routes
app.use('/api', createGamesRouter(configService, ecsService, ec2Service));
app.use('/api', createConfigRouter(configService));
app.use('/api', createCostsRouter(configService, costService, ecsService));
app.use('/api', createLogsRouter(logsService));
app.use('/api', createFilesRouter(configService, fileManagerService, ec2Service));

// Serve the Vite-built React app in production
if (!isDev) {
  const clientDist = join(__dirname, '../../client');
  app.use(express.static(clientDist));
  app.get('*', (_req: express.Request, res: express.Response) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  logger.info(`Game Server Manager API running on http://localhost:${PORT}`, {
    mode: isDev ? 'development' : 'production',
    port: PORT,
  });
});
