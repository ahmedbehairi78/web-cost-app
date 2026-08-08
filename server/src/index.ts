import { closeDb } from './db.js';
import { assertProductionEnv, env } from './env.js';

async function main() {
  assertProductionEnv();

  if (env.sqliteCoreEnabled) {
    const { initSqliteCore } = await import('./sqlite/core.js');
    initSqliteCore();
  } else {
    console.log('[sqlite-core] disabled (Postgres-only mode)');
  }

  const { createApp } = await import('./app.js');
  const { startNotificationWorker } = await import('./jobs/notificationWorker.js');
  startNotificationWorker();
  const app = createApp();
  const server = app.listen(env.port, '0.0.0.0', () => {
    let dbHost = '(unknown)';
    try {
      dbHost = new URL(env.databaseUrl).host;
    } catch {
      /* ignore */
    }
    console.log(`API listening on http://0.0.0.0:${env.port} (${env.nodeEnv}) · db ${dbHost}`);
  });

  async function shutdown() {
    server.close();
    const { stopNotificationWorker } = await import('./jobs/notificationWorker.js');
    stopNotificationWorker();
    if (env.sqliteCoreEnabled) {
      const { closeSqliteCore } = await import('./sqlite/core.js');
      closeSqliteCore();
    }
    await closeDb();
    process.exit(0);
  }

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch((error) => {
  console.error('[start] fatal:', error);
  process.exit(1);
});
