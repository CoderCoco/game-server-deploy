import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createApiTokenMiddleware } from './auth.js';

/**
 * Build a minimal Express `Request`/`Response` pair for one middleware
 * invocation. `res.status(...)` is chainable and `res.json` records the
 * payload so tests can assert on the rejection body.
 */
function makeReqRes(headers: Record<string, string | undefined> = {}): {
  req: Request;
  res: Response;
  next: NextFunction;
  jsonPayload: { value: unknown };
  statusCode: { value: number | null };
} {
  const statusCode = { value: null as number | null };
  const jsonPayload = { value: undefined as unknown };
  const res = {
    status(code: number) {
      statusCode.value = code;
      return this as unknown as Response;
    },
    json(payload: unknown) {
      jsonPayload.value = payload;
      return this as unknown as Response;
    },
  } as unknown as Response;
  const req = { headers, path: '/api/status', method: 'GET' } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, jsonPayload, statusCode };
}

describe('createApiTokenMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('no token configured', () => {
    it('should pass the request through and log a warning the first time', () => {
      const mw = createApiTokenMiddleware(() => null);
      const { req, res, next, statusCode } = makeReqRes();
      mw(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(statusCode.value).toBeNull();
    });

    it('should warn only once across many requests', async () => {
      const { logger } = await import('../logger.js');
      const mw = createApiTokenMiddleware(() => null);
      for (let i = 0; i < 5; i++) {
        const { req, res, next } = makeReqRes();
        mw(req, res, next);
      }
      expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
    });
  });

  describe('token configured', () => {
    it('should 401 when no Authorization header is present', () => {
      const mw = createApiTokenMiddleware(() => 'secret');
      const { req, res, next, statusCode, jsonPayload } = makeReqRes();
      mw(req, res, next);
      expect(statusCode.value).toBe(401);
      expect(jsonPayload.value).toEqual({ error: 'missing bearer token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should 401 when Authorization is not a Bearer scheme', () => {
      const mw = createApiTokenMiddleware(() => 'secret');
      const { req, res, next, statusCode } = makeReqRes({ authorization: 'Basic abc' });
      mw(req, res, next);
      expect(statusCode.value).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should 401 on a mismatched bearer token', () => {
      const mw = createApiTokenMiddleware(() => 'secret');
      const { req, res, next, statusCode, jsonPayload } = makeReqRes({
        authorization: 'Bearer wrong',
      });
      mw(req, res, next);
      expect(statusCode.value).toBe(401);
      expect(jsonPayload.value).toEqual({ error: 'invalid bearer token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should pass the request through when the bearer token matches', () => {
      const mw = createApiTokenMiddleware(() => 'secret');
      const { req, res, next, statusCode } = makeReqRes({ authorization: 'Bearer secret' });
      mw(req, res, next);
      expect(statusCode.value).toBeNull();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should tolerate extra whitespace around the bearer token', () => {
      const mw = createApiTokenMiddleware(() => 'secret');
      const { req, res, next } = makeReqRes({ authorization: 'Bearer   secret  ' });
      mw(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should re-resolve the token on every call (so rotation takes effect live)', () => {
      let current = 'first';
      const mw = createApiTokenMiddleware(() => current);

      const a = makeReqRes({ authorization: 'Bearer first' });
      mw(a.req, a.res, a.next);
      expect(a.next).toHaveBeenCalled();

      current = 'second';
      const b = makeReqRes({ authorization: 'Bearer first' });
      mw(b.req, b.res, b.next);
      expect(b.statusCode.value).toBe(401);

      const c = makeReqRes({ authorization: 'Bearer second' });
      mw(c.req, c.res, c.next);
      expect(c.next).toHaveBeenCalled();
    });
  });
});
