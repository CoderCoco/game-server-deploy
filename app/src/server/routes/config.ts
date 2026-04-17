import { Router } from 'express';
import { ConfigService, type WatchdogConfig } from '../services/ConfigService.js';

export function createConfigRouter(config: ConfigService): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json(config.getConfig());
  });

  router.post('/config', (req, res) => {
    const current = config.getConfig();
    const body = req.body as Partial<WatchdogConfig>;
    const updated: WatchdogConfig = {
      watchdog_interval_minutes: body.watchdog_interval_minutes ?? current.watchdog_interval_minutes,
      watchdog_idle_checks: body.watchdog_idle_checks ?? current.watchdog_idle_checks,
      watchdog_min_packets: body.watchdog_min_packets ?? current.watchdog_min_packets,
    };
    config.saveConfig(updated);
    res.json({ success: true, config: updated });
  });

  return router;
}
