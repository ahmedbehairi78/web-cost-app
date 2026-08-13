/** Poll interval for Electron `powerMonitor.getSystemIdleTime()`. */
export const SYSTEM_IDLE_POLL_MS = 2000;

export function systemIdleReached(idleSeconds: number, idleMs: number): boolean {
  if (!Number.isFinite(idleSeconds) || idleSeconds < 0) return false;
  if (!Number.isFinite(idleMs) || idleMs <= 0) return false;
  return idleSeconds * 1000 >= idleMs;
}
