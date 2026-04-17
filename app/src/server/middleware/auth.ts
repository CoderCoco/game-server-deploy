import type { RequestHandler } from 'express';
import { logger } from '../logger.js';

/**
 * Build an Express middleware that gates `/api/*` behind a bearer token.
 *
 * The middleware reads the configured token **on every request** via the
 * supplied `getToken` callback, so rotating the token (e.g. by editing
 * `server_config.json` and calling `POST /api/discord/restart` style flow
 * later) takes effect without a server restart.
 *
 * Behavior:
 * - `getToken()` returns `null` → the app has no token configured. We log a
 *   warning once and allow the request through (dev convenience). This is
 *   only reachable in production when the startup check in `index.ts` has
 *   been bypassed deliberately; normally production boot refuses to start.
 * - `getToken()` returns a string → require an `Authorization: Bearer <token>`
 *   header whose token matches exactly. A timing-safe comparison isn't used
 *   because the token lives on the local dashboard and the risk model
 *   doesn't include a timing-side-channel attacker; simple string equality
 *   keeps the code readable.
 *
 * Missing/malformed headers → 401. Mismatched token → 401.
 */
export function createApiTokenMiddleware(getToken: () => string | null): RequestHandler {
  let warnedUnauthenticated = false;
  return (req, res, next) => {
    const configured = getToken();
    if (!configured) {
      if (!warnedUnauthenticated) {
        logger.warn(
          'API_TOKEN is not configured — /api/* is accepting UNAUTHENTICATED requests. ' +
            'Set the API_TOKEN env var or api_token in server_config.json for production use.',
        );
        warnedUnauthenticated = true;
      }
      next();
      return;
    }

    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing bearer token' });
      return;
    }
    const presented = header.slice('Bearer '.length).trim();
    if (presented !== configured) {
      logger.warn('Rejected /api request with bad bearer token', {
        path: req.path,
        method: req.method,
      });
      res.status(401).json({ error: 'invalid bearer token' });
      return;
    }
    next();
  };
}
