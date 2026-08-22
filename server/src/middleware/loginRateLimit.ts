import type { NextFunction, Request, Response } from 'express';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  // Use Express `req.ip` only. In production `trust proxy` is 1, so this is the
  // socket / first trusted hop — not a client-spoofable X-Forwarded-For value.
  return req.ip || 'unknown';
}

function bucketKey(req: Request): string {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `${clientIp(req)}:${email || '_'}`;
}

/** In-memory login rate limit — 5 failures per IP+email per 15 minutes. */
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  rejectIfLimited(req, res, next, bucketKey(req), MAX_ATTEMPTS);
}

const PRELOGIN_MAX = 20;

function preLoginBucketKey(req: Request): string {
  return `prelogin:${clientIp(req)}`;
}

/** Public email check — per IP, not per email (stops directory scans). Same 15-minute window. */
export function preLoginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = preLoginBucketKey(req);
  rejectIfLimited(req, res, next, key, PRELOGIN_MAX);
  if (res.headersSent) return;
  recordHit(key);
}

function rejectIfLimited(
  req: Request,
  res: Response,
  next: NextFunction,
  key: string,
  max: number,
): void {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  if (bucket.count >= max) {
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

function recordHit(key: string): void {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
  }
  bucket.count += 1;
  buckets.set(key, bucket);
}

export function recordFailedLogin(req: Request): void {
  recordHit(bucketKey(req));
}

export function clearLoginAttempts(req: Request): void {
  buckets.delete(bucketKey(req));
}

/** Test helper — reset all buckets. */
export function _resetLoginRateLimitBuckets(): void {
  buckets.clear();
}
