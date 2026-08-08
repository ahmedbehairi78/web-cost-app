import type { NextFunction, Request, Response } from 'express';
import { verifyFirebaseIdToken } from '../auth/firebaseToken.js';
import { findUserByEmailInsensitive, findUserById } from '../auth/users.js';
import {
  hasModuleWrite,
  hasReferenceRead,
  normalizeUserPermissions,
  type PermissionKey,
  type UserPermissions,
} from '../permissions.js';

async function resolveAuthenticatedUser(req: Request) {
  if (req.session.userId) {
    return findUserById(req.session.userId);
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    try {
      const identity = await verifyFirebaseIdToken(token);
      return findUserByEmailInsensitive(identity.email);
    } catch {
      return null;
    }
  }

  return null;
}

function attachUser(
  req: Request,
  user: NonNullable<Awaited<ReturnType<typeof findUserById>>>,
) {
  const permissions = normalizeUserPermissions(user.permissions);
  req.user = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    permissions,
    assignedContractIds: user.assignedContractIds,
    isActive: user.isActive,
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await resolveAuthenticatedUser(req);
  if (!user?.isActive) {
    if (req.session.userId) {
      req.session.destroy(() => undefined);
    }
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  attachUser(req, user);
  next();
}

/** Attach user when present; never reject (password-session probe, soft checks). */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const user = await resolveAuthenticatedUser(req);
  if (user?.isActive) attachUser(req, user);
  next();
}

/** Reference read — view OR create OR edit on any listed module (COA pickers, lookups). */
export function requireReferenceRead(...keys: PermissionKey[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.user.role === 'admin') {
      next();
      return;
    }
    const perms = req.user.permissions as UserPermissions;
    const ok = keys.some((k) => hasReferenceRead(perms, k));
    if (ok) {
      next();
      return;
    }
    res.status(403).json({ error: `Missing reference permission (need one of: ${keys.join(', ')})` });
  };
}

/** @deprecated alias — use `requireReferenceRead`. */
export function requireAnyPermission(...keys: PermissionKey[]) {
  return requireReferenceRead(...keys);
}

/** Strict module write — create OR edit (POST/PUT/DELETE). */
export function requireModuleWrite(...keys: PermissionKey[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.user.role === 'admin') {
      next();
      return;
    }
    const perms = req.user.permissions as UserPermissions;
    const ok = keys.some((k) => hasModuleWrite(perms, k));
    if (ok) {
      next();
      return;
    }
    res.status(403).json({ error: `Missing write permission (need one of: ${keys.join(', ')})` });
  };
}

/** Any module use — same as reference read (view|create|edit). */
export function requirePermission(permission: PermissionKey) {
  return requireReferenceRead(permission);
}

/** يتحقق أن المستخدم لديه أحد الأدوار المحددة */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.user.role === 'admin' || roles.includes(req.user.role)) {
      next();
      return;
    }
    res.status(403).json({ error: `Role required: ${roles.join(' or ')}` });
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        displayName: string | null;
        role: string;
        permissions: UserPermissions;
        assignedContractIds?: string[];
        isActive: boolean;
      };
    }
  }
}
