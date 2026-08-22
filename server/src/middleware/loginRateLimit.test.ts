import { describe, expect, it, beforeEach } from 'vitest';
import {
  _resetLoginRateLimitBuckets,
  loginRateLimit,
  preLoginRateLimit,
  recordFailedLogin,
} from './loginRateLimit.js';
import type { Request, Response } from 'express';

function mockReq(email = 'a@b.com', ip = '1.2.3.4', headers: Record<string, string> = {}): Request {
  return {
    body: { email },
    ip,
    headers,
  } as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: unknown };
}

describe('loginRateLimit', () => {
  beforeEach(() => {
    _resetLoginRateLimitBuckets();
  });

  it('allows first attempts', () => {
    let nextCalled = false;
    loginRateLimit(mockReq(), mockRes(), () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it('blocks after 5 failed attempts', () => {
    const req = mockReq();
    for (let i = 0; i < 5; i += 1) recordFailedLogin(req);
    const res = mockRes();
    let nextCalled = false;
    loginRateLimit(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
  });

  it('does not use X-Forwarded-For for the bucket key', () => {
    const victim = mockReq('a@b.com', '1.2.3.4');
    for (let i = 0; i < 5; i += 1) recordFailedLogin(victim);

    const spoofed = mockReq('a@b.com', '9.9.9.9', { 'x-forwarded-for': '1.2.3.4' });
    const res = mockRes();
    let nextCalled = false;
    loginRateLimit(spoofed, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('limits pre-login checks per IP after 20 hits', () => {
    const req = mockReq('scan@x.com', '8.8.8.8');
    for (let i = 0; i < 20; i += 1) {
      preLoginRateLimit(req, mockRes(), () => undefined);
    }
    const res = mockRes();
    let nextCalled = false;
    preLoginRateLimit(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
  });
});
