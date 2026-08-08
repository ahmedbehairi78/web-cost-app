import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';

const HEADER = 'idempotency-key';
const MAX_KEY_LEN = 128;

function readIdempotencyKey(req: Request): string | null {
  const raw = req.headers[HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== 'string') return null;
  const key = value.trim();
  if (!key || key.length > MAX_KEY_LEN) return null;
  return key;
}

function routeKey(req: Request): string {
  return `${req.method.toUpperCase()} ${req.baseUrl || ''}${req.path || ''}`;
}

/**
 * Replay identical responses for the same user + Idempotency-Key.
 * Must run after requireAuth so req.user is set.
 * Only caches successful JSON responses (2xx).
 */
export function withIdempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = readIdempotencyKey(req);
    if (!key || !req.user?.id) {
      next();
      return;
    }

    const userId = req.user.id;
    const route = routeKey(req);

    try {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (existing) {
        res.status(existing.responseStatus).json(existing.responseBody);
        return;
      }
    } catch (err) {
      console.warn('[idempotency] lookup failed:', err);
      next();
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const status = res.statusCode || 200;
      if (status >= 200 && status < 300) {
        void prisma.idempotencyKey
          .create({
            data: {
              key,
              userId,
              route,
              responseStatus: status,
              responseBody: body as object,
            },
          })
          .catch((err) => {
            // Unique race: another request stored first — ignore
            console.warn('[idempotency] store failed:', err);
          });
      }
      return originalJson(body);
    }) as Response['json'];

    next();
  };
}

/** Attach to mutating routers: app.use('/api/...', requireAuth, withIdempotency(), router) */
export { readIdempotencyKey };
