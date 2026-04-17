import { Router } from 'express';
import { LogsService } from '../services/LogsService.js';

export function createLogsRouter(logs: LogsService): Router {
  const router = Router();

  router.get('/logs/:game', async (req, res) => {
    const game = req.params['game']!;
    const limit = parseInt(String(req.query['limit'] ?? '50'), 10);
    const lines = await logs.getRecentLogs(game, limit);
    res.json({ game, lines });
  });

  return router;
}
