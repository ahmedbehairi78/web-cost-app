import type { NextFunction, Request, Response, RequestHandler } from 'express';

/**
 * Wraps an async Express handler so rejected promises are forwarded to the
 * error-handling middleware instead of becoming unhandled rejections.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
