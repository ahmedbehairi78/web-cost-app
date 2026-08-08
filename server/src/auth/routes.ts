import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  createUser,
  findUserByEmail,
  findUserByEmailInsensitive,
  findUserById,
  listActiveUsers,
  updateUserById,
} from './users.js';
import { verifyFirebaseIdToken } from './firebaseToken.js';
import {
  loadFirestoreUserProfile,
  syncAllEmailProfilesToFirestore,
  syncEmailProfileToFirestore,
} from '../firestore/emailProfileSync.js';
import {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  hasAnyGrantedPermission,
  normalizeUserPermissions,
  permissionsNeedBootstrap,
  resolvePermissionsFromUserData,
  type UserRole,
  type UserPermissions,
} from '../permissions.js';
import type { VerifiedFirebaseIdentity } from './firebaseToken.js';
import { requireAuth, requirePermission, requireRole, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { handlePreLoginCheck } from './preLoginCheck.js';
import {
  clearLoginAttempts,
  loginRateLimit,
  recordFailedLogin,
} from '../middleware/loginRateLimit.js';
import { resolveFirebaseProjectId } from '../firebaseProject.js';
import { env } from '../env.js';
import { serialize } from '../prisma/serialize.js';
import {
  hashLoginPassword,
  isPasswordLoginConfigured,
  unusablePasswordHash,
  verifyLoginPassword,
} from './passwordHelpers.js';

export const authRouter = Router();

function newId(): string {
  return randomUUID();
}

function normalizeLocalRole(role: unknown): UserRole {
  return ['admin', 'projects_manager', 'project_accountant', 'user'].includes(String(role))
    ? (String(role) as UserRole)
    : 'user';
}

function isBootstrapAdminEmail(email: string): boolean {
  const clean = email.trim().toLowerCase();
  return clean.length > 0 && env.bootstrapAdminEmails.includes(clean);
}

/** Railway first login: promote configured email(s) to admin when permissions are empty. */
async function maybeBootstrapAdminUser(
  user: NonNullable<Awaited<ReturnType<typeof findUserByEmailInsensitive>>>,
) {
  if (!isBootstrapAdminEmail(user.email)) return user;
  const perms = normalizeUserPermissions(user.permissions);
  if (user.role === 'admin' && hasAnyGrantedPermission(perms)) return user;
  return (
    (await updateUserById(user.id, {
      role: 'admin',
      permissions: ALL_PERMISSIONS,
      isActive: true,
    })) ?? user
  );
}

function safeUser(user: Awaited<ReturnType<typeof findUserByEmailInsensitive>>) {
  if (!user) return null;
  const { passwordHash: _ph, ...safe } = user;
  return serialize(safe);
}

/** When Postgres user is still default but Firestore admin profile exists — sync on Google login. */
async function maybeSyncUserFromFirestoreProfile(
  user: NonNullable<Awaited<ReturnType<typeof findUserByEmailInsensitive>>>,
  identity: VerifiedFirebaseIdentity,
) {
  if (!identity.uid) return user;
  const fsProfile = await loadFirestoreUserProfile(identity.uid);
  if (!fsProfile) return user;

  const fsRole = normalizeLocalRole(fsProfile.role);
  const fsPermissions = resolvePermissionsFromUserData({
    role: fsRole,
    permissions: fsProfile.permissions,
  });
  const localRole = normalizeLocalRole(user.role);
  const needsSync =
    permissionsNeedBootstrap(user.permissions, localRole) ||
    (localRole === 'user' && (fsRole !== 'user' || hasAnyGrantedPermission(fsPermissions)));

  if (!needsSync) return user;

  const contractIds = Array.isArray(fsProfile.assignedContractIds)
    ? fsProfile.assignedContractIds.filter((id): id is string => typeof id === 'string')
    : (user.assignedContractIds ?? []);

  const updated = await updateUserById(user.id, {
    role: fsRole,
    permissions: fsPermissions,
    assignedContractIds: contractIds,
    displayName: user.displayName ?? identity.displayName,
  });
  return updated ?? user;
}

authRouter.post('/pre-login-check', asyncHandler(handlePreLoginCheck));

authRouter.post(
  '/firebase-session',
  asyncHandler(async (req, res) => {
    const projectId = resolveFirebaseProjectId();
    if (!projectId) {
      res.status(503).json({
        error: 'firebase_project_unconfigured',
        message: 'Set FIREBASE_PROJECT_ID or firebase-applet-config.json projectId',
      });
      return;
    }
    const { idToken } = req.body as { idToken?: string };
    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: 'idToken required' });
      return;
    }
    try {
      const identity = await verifyFirebaseIdToken(idToken);
      const bootstrap = isBootstrapAdminEmail(identity.email);
      let user = await findUserByEmailInsensitive(identity.email);
      if (!user) {
        const created = await createUser({
          id: newId(),
          email: identity.email,
          displayName: identity.displayName,
          passwordHash: await unusablePasswordHash(),
          role: bootstrap ? 'admin' : 'user',
          permissions: bootstrap ? ALL_PERMISSIONS : resolvePermissionsFromUserData({ role: 'user' }),
          assignedContractIds: [],
        });
        req.session.userId = created.id;
        req.session.save((saveErr) => {
          if (saveErr) console.error('[firebase-session] session save error (new user):', saveErr);
          res.status(201).json(safeUser(created));
        });
        return;
      }
      if (!user.isActive) {
        res.status(403).json({ error: 'user_inactive' });
        return;
      }
      user = await maybeBootstrapAdminUser(user);
      user = await maybeSyncUserFromFirestoreProfile(user, identity);
      req.session.userId = user.id;
      void syncEmailProfileToFirestore({
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        assignedContractIds: user.assignedContractIds ?? [],
      }).catch(() => undefined);
      req.session.save((saveErr) => {
        if (saveErr) console.error('[firebase-session] session save error:', saveErr);
        res.json(safeUser(user!));
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'invalid_id_token';
      if (code === 'firebase_project_unconfigured') {
        res.status(503).json({
          error: 'firebase_project_unconfigured',
          message: 'Set FIREBASE_PROJECT_ID or firebase-applet-config.json projectId',
        });
        return;
      }
      if (code === 'invalid_firebase_email') {
        res.status(401).json({ error: 'invalid_firebase_email' });
        return;
      }
      res.status(401).json({ error: 'invalid_id_token' });
    }
  }),
);

authRouter.get(
  '/user-directory',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const users = (await listActiveUsers()).map((user) => {
      const { passwordHash: _ph, ...safe } = user;
      return serialize(safe);
    });
    res.json({ users });
  }),
);

authRouter.post(
  '/sync-email-profiles',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const users = await listActiveUsers();
    const result = await syncAllEmailProfilesToFirestore(
      users.map((user) => ({
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        assignedContractIds: user.assignedContractIds ?? [],
      })),
    );
    res.json(result);
  }),
);

authRouter.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    const user = await findUserByEmailInsensitive(cleanEmail);
    if (!user?.isActive) {
      recordFailedLogin(req);
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    if (!(await isPasswordLoginConfigured(user.passwordHash))) {
      recordFailedLogin(req);
      res.status(401).json({
        error: 'password_not_configured',
        message: 'Password login is not enabled for this account. Ask an administrator to set a password.',
      });
      return;
    }
    if (!(await verifyLoginPassword(password, user.passwordHash))) {
      recordFailedLogin(req);
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    clearLoginAttempts(req);
    const bootstrapped = await maybeBootstrapAdminUser(user);
    req.session.userId = bootstrapped.id;
    req.session.save((saveErr) => {
      if (saveErr) console.error('[auth/login] session save error:', saveErr);
      res.json(safeUser(bootstrapped));
    });
  }),
);

authRouter.post(
  '/verify-admin-password',
  requireAuth,
  requireRole('admin'),
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { password } = req.body as { password?: string };
    const plain = typeof password === 'string' ? password : '';
    if (!plain) {
      res.status(400).json({ error: 'password_required' });
      return;
    }
    const user = await findUserById(req.user!.id);
    if (!user?.isActive) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!(await isPasswordLoginConfigured(user.passwordHash))) {
      res.status(403).json({
        error: 'password_not_configured',
        message: 'Use Google verification or ask an admin to set a login password.',
      });
      return;
    }
    if (!(await verifyLoginPassword(plain, user.passwordHash))) {
      recordFailedLogin(req);
      res.status(401).json({ error: 'invalid_password' });
      return;
    }
    clearLoginAttempts(req);
    res.json({ ok: true });
  }),
);

authRouter.patch(
  '/users/:id/password',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.id ?? '').trim();
    const { password } = req.body as { password?: string };
    if (!userId) {
      res.status(400).json({ error: 'User id is required' });
      return;
    }
    const clean = typeof password === 'string' ? password.trim() : '';
    if (clean.length < 8) {
      res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 8 characters' });
      return;
    }
    const existing = await findUserById(userId);
    if (!existing) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }
    await updateUserById(userId, {
      passwordHash: await hashLoginPassword(clean),
    });
    res.status(204).end();
  }),
);

authRouter.post('/logout', (req, res) => {
  if (req.session?.userId) {
    req.session.destroy(() => res.status(204).end());
  } else {
    res.status(204).end();
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(serialize(req.user));
});

authRouter.get('/session-probe', optionalAuth, (req, res) => {
  if (!req.user) {
    res.json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, user: serialize(req.user) });
});

authRouter.post(
  '/users',
  requireAuth,
  requirePermission('settings'),
  asyncHandler(async (req, res) => {
    const { email, password, displayName, role = 'user', permissions } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
      role?: 'admin' | 'user';
      permissions?: Record<string, boolean>;
    };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    const user = await createUser({
      id: newId(),
      email,
      displayName: displayName ?? null,
      passwordHash: await hashLoginPassword(password),
      role,
      permissions: resolvePermissionsFromUserData({
        role,
        permissions: role === 'admin' ? ALL_PERMISSIONS : permissions,
      }),
    });
    const { passwordHash: _ph, ...safe } = user;
    res.status(201).json(serialize(safe));
  }),
);

authRouter.post(
  '/users/firebase-sync',
  requireAuth,
  requirePermission('settings'),
  asyncHandler(async (req, res) => {
    const {
      email,
      displayName,
      role = 'user',
      permissions,
      assignedContractIds = [],
      password,
    } = req.body as {
      email?: string;
      displayName?: string;
      role?: string;
      permissions?: unknown;
      assignedContractIds?: unknown;
      password?: string;
    };

    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const cleanPassword = typeof password === 'string' ? password.trim() : '';
    if (cleanPassword.length > 0 && cleanPassword.length < 8) {
      res.status(400).json({
        error: 'password_too_short',
        message: 'Password must be at least 8 characters',
      });
      return;
    }
    if (cleanPassword.length > 0 && req.user?.role !== 'admin') {
      res.status(403).json({ error: 'admin_required_for_password' });
      return;
    }
    const passwordHash =
      cleanPassword.length >= 8 ? await hashLoginPassword(cleanPassword) : undefined;

    const localRole = normalizeLocalRole(role);
    const localPermissions =
      permissions !== undefined && permissions !== null
        ? normalizeUserPermissions(permissions)
        : resolvePermissionsFromUserData({ role: localRole });
    const contractIds = Array.isArray(assignedContractIds)
      ? assignedContractIds.filter((id): id is string => typeof id === 'string')
      : [];
    const existing = await findUserByEmailInsensitive(cleanEmail);

    if (existing) {
      const updated = await updateUserById(existing.id, {
        email: cleanEmail,
        displayName:
          typeof displayName === 'string' && displayName.trim() ? displayName.trim() : undefined,
        role: localRole,
        permissions: localPermissions,
        assignedContractIds: contractIds,
        isActive: true,
        ...(passwordHash ? { passwordHash } : {}),
      });
      if (!updated) {
        res.status(500).json({ error: 'user_update_failed' });
        return;
      }
      void syncEmailProfileToFirestore({
        email: cleanEmail,
        role: localRole,
        permissions: localPermissions,
        assignedContractIds: contractIds,
      }).catch(() => undefined);
      res.json(safeUser(updated));
      return;
    }

    const created = await createUser({
      id: newId(),
      email: cleanEmail,
      displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null,
      passwordHash: passwordHash ?? (await unusablePasswordHash()),
      role: localRole,
      permissions: localPermissions,
      assignedContractIds: contractIds,
    });
    void syncEmailProfileToFirestore({
      email: cleanEmail,
      role: localRole,
      permissions: localPermissions,
      assignedContractIds: contractIds,
    }).catch(() => undefined);
    res.status(201).json(safeUser(created));
  }),
);

authRouter.post(
  '/users/firebase-deactivate',
  requireAuth,
  requirePermission('settings'),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email?: string };
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const existing = await findUserByEmailInsensitive(cleanEmail);
    if (!existing) {
      res.status(204).end();
      return;
    }

    await updateUserById(existing.id, {
      role: 'user',
      permissions: DEFAULT_PERMISSIONS,
      assignedContractIds: [],
      isActive: false,
    });

    res.status(204).end();
  }),
);

/** Prevent unmatched /api/auth/* from falling through to /api subcontractor (401). */
authRouter.use((_req, res) => {
  res.status(404).json({ error: 'auth_route_not_found' });
});
