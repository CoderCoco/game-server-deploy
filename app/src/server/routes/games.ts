import { Router } from 'express';
import { ConfigService } from '../services/ConfigService.js';
import { EcsService } from '../services/EcsService.js';
import { Ec2Service } from '../services/Ec2Service.js';

export function createGamesRouter(
  config: ConfigService,
  ecs: EcsService,
  _ec2: Ec2Service,
): Router {
  const router = Router();

  router.get('/games', (_req, res) => {
    config.invalidateCache();
    const outputs = config.getTfOutputs();
    res.json({ games: outputs?.game_names ?? [] });
  });

  router.get('/status', async (_req, res) => {
    config.invalidateCache();
    const outputs = config.getTfOutputs();
    if (!outputs) {
      res.json([]);
      return;
    }
    const statuses = await Promise.all(outputs.game_names.map((g) => ecs.getStatus(g)));
    res.json(statuses);
  });

  router.get('/status/:game', async (req, res) => {
    res.json(await ecs.getStatus(req.params['game']!));
  });

  router.post('/start/:game', async (req, res) => {
    res.json(await ecs.start(req.params['game']!));
  });

  router.post('/stop/:game', async (req, res) => {
    res.json(await ecs.stop(req.params['game']!));
  });

  return router;
}
