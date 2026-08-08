import type { NextFunction, Request, Response } from 'express';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || req.ip || 'unknown';
  }
  return req.ip || 'unknown';
}

function bucketKey(req: Request): string {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `${clientIp(req)}:${email || '_'}`;
}

/** In-memory login rate limit — 5 failures per IP+email per 15 minutes. */
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = bucketKey(req);
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  if (bucket.count >= MAX_ATTEMPTS) {
    const retrySec = Math.ceil((bucket.resetAt - now) / 1000);
    res.status(429).json({
      error: 'too_many_login_attempts',
      message: `Too many login attempts. Retry in ${retrySec} seconds.`,
      retryAfterSec: retrySec,
    });
    return;
  }
  next();
}

export function recordFailedLogin(req: Request): void {
  const key = bucketKey(req);
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
  }
  bucket.count += 1;
  buckets.set(key, bucket);
}

export function clearLoginAttempts(req: Request): void {
  buckets.delete(bucketKey(req));
}

/** Test helper — reset all buckets. */
export function _resetLoginRateLimitBuckets(): void {
  buckets.clear();
}
