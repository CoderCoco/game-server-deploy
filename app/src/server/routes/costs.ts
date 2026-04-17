import { Router } from 'express';
import { ConfigService } from '../services/ConfigService.js';
import { CostService } from '../services/CostService.js';
import { EcsService } from '../services/EcsService.js';

export function createCostsRouter(
  config: ConfigService,
  costs: CostService,
  ecs: EcsService,
): Router {
  const router = Router();

  router.get('/costs/estimate', async (_req, res) => {
    const outputs = config.getTfOutputs();
    if (!outputs) {
      res.json({ games: {}, totalPerHourIfAllOn: 0 });
      return;
    }

    const estimates: Record<string, ReturnType<CostService['estimateForSpec']>> = {};
    for (const game of outputs.game_names) {
      const td = await ecs.getTaskDefinition(game);
      const est = costs.estimateForSpec(td?.cpu ?? 2048, td?.memory ?? 8192);
      estimates[game] = est;
    }

    const totalPerHourIfAllOn = Object.values(estimates).reduce(
      (sum, e) => sum + e.costPerHour,
      0,
    );

    res.json({ games: estimates, totalPerHourIfAllOn: Math.round(totalPerHourIfAllOn * 10000) / 10000 });
  });

  router.get('/costs/actual', async (req, res) => {
    const days = parseInt(String(req.query['days'] ?? '7'), 10);
    res.json(await costs.getActualCosts(days));
  });

  return router;
}
