import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { sessionMiddleware } from './auth/session.js';
import { authRouter } from './auth/routes.js';
import { handlePreLoginCheck } from './auth/preLoginCheck.js';
import { createCrudRouter } from './modules/crud.js';
import { enrichBoqItemsFromFirestore } from './modules/boqItemsEnrich.js';
import { glRouter } from './modules/gl.js';
import { billingRouter } from './modules/billing.js';
import { reportsRouter } from './modules/reports.js';
import { sqliteCoreRouter } from './modules/sqliteCore.js';
import { inventoryRouter } from './modules/inventory.js';
import { inventoryTransfersRouter } from './modules/inventoryTransfers.js';
import { projectInventoryTransfersRouter } from './modules/projectInventoryTransfers.js';
import { subcontractorRouter } from './modules/subcontractor.js';
import { materialsRouter } from './modules/materials.js';
import { boqMaterialsRouter } from './modules/boqMaterials.js';
import { consumptionOrdersRouter } from './modules/consumptionOrders.js';
import { purchaseTransactionsRouter } from './modules/purchaseTransactions.js';
import { custodySettlementsRouter } from './modules/custodySettlements.js';
import { consumptionAllocationTemplatesRouter } from './modules/consumptionAllocationTemplates.js';
import { returnOrdersRouter } from './modules/returnOrders.js';
import { warehouseReceiptsRouter } from './modules/warehouseReceipts.js';
import { inventoryMaintenanceRouter } from './modules/inventoryMaintenance.js';
import { financialMaintenanceRouter } from './modules/financialMaintenance.js';
import { chartOfAccountsMaintenanceRouter } from './modules/chartOfAccountsMaintenance.js';
import { mosExtractsRouter } from './modules/mosExtracts.js';
import { bankMovementsGlRouter, bankChequesGlRouter } from './modules/bankGlPosting.js';
import { mosCertificatesRouter } from './modules/mosCertificates.js';
import { documentRegistryRouter } from './modules/documentRegistry.js';
import { variationOrdersRouter } from './modules/variationOrders.js';
import { settingsRouter } from './modules/settings.js';
import { costCentersRouter } from './modules/costCenters.js';
import { overheadAllocationRouter } from './modules/overheadAllocation.js';
import { accountingPeriodsRouter } from './modules/accountingPeriods.js';
import { fiscalClosingsRouter } from './modules/fiscalClosings.js';
import { contractExpenseOrdersRouter } from './modules/contractExpenseOrders.js';
import { notificationsRouter } from './modules/notifications.js';
import { fixedAssetsRouter } from './modules/fixedAssets.js';
import { bootstrapFixedAssetGroupsIfEmpty } from './accounting/fixedAssetGlSync.js';
import { payrollRouter } from './modules/payroll.js';
import { purchaseRequestsRouter } from './modules/purchaseRequests.js';
import { cashBudgetRouter } from './modules/cashBudget.js';
import { bootstrapCoaIfEmpty } from './accounting/ensureCoaSeed.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { prisma } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isDevAllowedOrigin(origin: string): boolean {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  // LAN access when Vite uses --host=0.0.0.0 (private ranges only)
  if (/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin)) {
    return true;
  }
  return false;
}

export function createApp() {
  // Postgres COA bootstrap is async; run best-effort without blocking app startup.
  bootstrapCoaIfEmpty().catch((error) => {
    console.error('[coa-bootstrap] failed:', error);
  });
  bootstrapFixedAssetGroupsIfEmpty().catch((error) => {
    console.error('[fixed-assets-bootstrap] failed:', error);
  });
  const app = express();

  if (env.nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(
    cors({
      origin(origin, callback) {
        // Dev: Vite may use 3000, 3001, 3002… — allow localhost on any port.
        if (env.nodeEnv !== 'production') {
          if (!origin || isDevAllowedOrigin(origin)) {
            callback(null, true);
            return;
          }
        }
        if (!origin || !env.corsOrigin || origin === env.corsOrigin) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS blocked origin: ${origin}`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '50mb' }));
  app.use(sessionMiddleware);

  app.get('/api/health/live', (_req, res) => {
    res.json({ ok: true, live: true, env: env.nodeEnv });
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        ok: true,
        db: 'connected',
        env: env.nodeEnv,
        features: {
          projectInventoryTransfers: true,
          projectInventoryTransfersPaths: [
            '/api/inventory/project-transfers',
            '/api/project-inventory-transfers',
          ],
        },
      });
    } catch (error) {
      console.error('[health] database check failed:', error);
      res.status(503).json({ ok: false, db: 'error' });
    }
  });
  app.post('/api/auth/pre-login-check', handlePreLoginCheck);
  app.use('/api/auth',                authRouter);
  // Reference reads — align with Firestore canReadProjectsRef / canReadContractsRef / canReadBoqRef
  const projectReferenceRead = [
    'dashboard',
    'projects',
    'costs',
    'billing',
    'boq',
    'reports',
    'subcontractor',
    'inventory',
    'banks',
  ] as const;
  const contractReferenceRead = [...projectReferenceRead, 'transfers'] as const;
  const boqReferenceRead = ['boq', 'projects', 'costs', 'billing', 'reports', 'inventory', 'subcontractor'] as const;
  app.use('/api/projects', createCrudRouter(null, 'project', [...projectReferenceRead], { writePermission: 'projects' }));
  app.use('/api/contracts', createCrudRouter(null, 'contract', [...contractReferenceRead], { writePermission: 'projects' }));
  app.use(
    '/api/boq-items',
    createCrudRouter(null, 'boqItem', [...boqReferenceRead], {
      writePermission: 'boq',
      listEnricher: enrichBoqItemsFromFirestore,
    }),
  );
  app.use('/api/materials', materialsRouter);
  app.use('/api/boq-materials', boqMaterialsRouter);
  app.use('/api/consumption-orders', consumptionOrdersRouter);
  app.use('/api/consumption-allocation-templates', consumptionAllocationTemplatesRouter);
  app.use('/api/return-orders', returnOrdersRouter);
  app.use('/api/warehouse-receipts', warehouseReceiptsRouter);
  app.use(
    '/api/chart-of-accounts',
    chartOfAccountsMaintenanceRouter,
  );
  app.use(
    '/api/chart-of-accounts',
    createCrudRouter(null, 'chartOfAccount', [
      'ledger',
      'costs',
      'billing',
      'banks',
      'inventory',
      'projects',
      'boq',
      'suppliers',
      'reports',
      'assets',
      'payroll',
      'cash_budget',
    ], { writePermission: ['ledger', 'costs'] }),
  );
  app.use(
    '/api/suppliers',
    createCrudRouter(null, 'supplier', ['suppliers', 'costs'], { writePermission: ['suppliers', 'costs'] }),
  );
  app.use('/api/purchase-transactions', purchaseTransactionsRouter);
  app.use('/api/custody-settlements', custodySettlementsRouter);
  app.use('/api/billing',             billingRouter);
  app.use('/api/gl',                  glRouter);
  app.use('/api/reports',             reportsRouter);
  app.use('/api/sqlite-core',         sqliteCoreRouter);
  app.use('/api/inventory',           inventoryRouter);
  app.use('/api/inventory-transfers', inventoryTransfersRouter);
  app.use('/api/project-inventory-transfers', projectInventoryTransfersRouter);
  app.use('/api/inventory-maintenance', inventoryMaintenanceRouter);
  app.use('/api/financial-maintenance', financialMaintenanceRouter);
  app.use('/api/mos-extracts',        mosExtractsRouter);
  app.use('/api/mos-certificates',    mosCertificatesRouter);
  app.use('/api/document-registry',   documentRegistryRouter);
  app.use('/api/variation-orders',    variationOrdersRouter);
  app.use('/api/settings',            settingsRouter);
  app.use('/api/cost-centers',        costCentersRouter);
  app.use('/api/overhead-allocation', overheadAllocationRouter);
  app.use('/api/accounting-periods', accountingPeriodsRouter);
  app.use('/api/fiscal-closings', fiscalClosingsRouter);
  app.use('/api/contract-expense-orders', contractExpenseOrdersRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/fixed-assets',  fixedAssetsRouter);
  app.use('/api/payroll',       payrollRouter);
  app.use('/api/purchase-requests', purchaseRequestsRouter);
  app.use('/api/cash-budget', cashBudgetRouter);
  app.use('/api/bank-accounts', createCrudRouter(null, 'bankAccount', 'banks'));
  // GL post/issue/clear must mount before CRUD so `/:id/post` is not treated as a CRUD id.
  app.use('/api/bank-movements', bankMovementsGlRouter);
  app.use('/api/bank-movements', createCrudRouter(null, 'bankMovement', 'banks'));
  app.use('/api/bank-cheques', bankChequesGlRouter);
  app.use('/api/bank-cheques', createCrudRouter(null, 'bankCheque', 'banks'));
  app.use('/api/bank-statements', createCrudRouter(null, 'bankStatement', 'banks'));
  app.use('/api/bank-statement-lines', createCrudRouter(null, 'bankStatementLine', 'banks'));
  app.use('/api',                     subcontractorRouter);

  // dist-server/app.js → ../dist would work, but server/src (tsx dev) → ../../dist.
  // process.cwd() is reliable in Docker (/app) and local dev (repo root).
  const publicDir = path.resolve(process.cwd(), 'dist');
  app.use(express.static(publicDir, {
    setHeaders(res, filePath) {
      if (
        filePath.endsWith(`${path.sep}index.html`)
        || filePath.endsWith('index.html')
        || filePath.endsWith(`${path.sep}spa-build.json`)
        || filePath.endsWith('spa-build.json')
      ) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        // Allow the Google sign-in (signInWithPopup) window to close itself.
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    // Allow the Google sign-in (signInWithPopup) window to close itself.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.sendFile(path.join(publicDir, 'index.html'), err => { if (err) next(); });
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
