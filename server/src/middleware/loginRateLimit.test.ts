import { describe, expect, it, beforeEach } from 'vitest';
import {
  _resetLoginRateLimitBuckets,
  loginRateLimit,
  recordFailedLogin,
} from './loginRateLimit.js';
import type { Request, Response } from 'express';

function mockReq(email = 'a@b.com', ip = '1.2.3.4'): Request {
  return {
    body: { email },
    ip,
    headers: {},
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
});
