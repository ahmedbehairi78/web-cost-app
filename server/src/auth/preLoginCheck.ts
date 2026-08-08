import type { Request, Response } from 'express';
import { findUserByEmailInsensitive } from './users.js';

/** Public: login screen verifies email before Google (no self-registration on login). */
export async function handlePreLoginCheck(req: Request, res: Response) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) {
    res.status(400).json({ error: 'email_required' });
    return;
  }
  const user = await findUserByEmailInsensitive(email);
  if (user?.isActive) {
    res.json({ allowed: true, status: 'registered' });
    return;
  }
  res.json({ allowed: false, status: 'not_found' });
}
