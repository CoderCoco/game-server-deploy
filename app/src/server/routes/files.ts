import { Router } from 'express';
import { ConfigService } from '../services/ConfigService.js';
import { FileManagerService } from '../services/FileManagerService.js';
import { Ec2Service } from '../services/Ec2Service.js';

export function createFilesRouter(
  _config: ConfigService,
  files: FileManagerService,
  _ec2: Ec2Service,
): Router {
  const router = Router();

  router.get('/files/:game', async (req, res) => {
    res.json(await files.getStatus(req.params['game']!));
  });

  router.post('/files/:game/start', async (req, res) => {
    res.json(await files.start(req.params['game']!));
  });

  router.post('/files/:game/stop', async (req, res) => {
    res.json(await files.stop(req.params['game']!));
  });

  return router;
}
