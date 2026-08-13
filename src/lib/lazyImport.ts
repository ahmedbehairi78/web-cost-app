import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { markSpaUpdateAvailable } from './spaBuild';

const CHUNK_RELOAD_KEY = 'web-cost-app:chunk-reload';

export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('Failed to fetch dynamically imported module')
    || msg.includes('Importing a module script failed')
    || msg.includes('error loading dynamically imported module')
    || msg.includes('Loading chunk')
  );
}

/**
 * After a Railway deploy, hashed chunks 404. Do not auto-reload (that looks like a crash).
 * Surface an in-app notification so the user starts the update and lands on the login screen.
 */
export function importWithChunkRetry<T>(importer: () => Promise<T>): Promise<T> {
  return importer().catch((error: unknown) => {
    if (isChunkLoadError(error)) {
      markSpaUpdateAvailable();
    }
    throw error;
  });
}

export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

export function lazyWithRetry<T extends ComponentType<object>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => importWithChunkRetry(factory));
}
