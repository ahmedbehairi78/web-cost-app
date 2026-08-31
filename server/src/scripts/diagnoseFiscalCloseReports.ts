/**
 * Diagnose whether YE-PL close zeros class 4/5 on rolling BS aggregates.
 *   npx tsx server/src/scripts/diagnoseFiscalCloseReports.ts
 */
import { prisma, closeDb } from '../db.js';

async function main() {
  const ye = await prisma.$queryRaw`
    SELECT id, date, reference, journal_kind, is_deleted,
           LEFT(description, 80) AS descr,
           created_at
    FROM transactions
    WHERE reference ILIKE 'YE-PL%' OR journal_kind = 'fiscal_pl_close'
    ORDER BY created_at DESC
    LIMIT 10
  `;
  console.log('YE-PL rows:', JSON.stringify(ye, null, 2));

  const closings = await prisma.$queryRaw`
    SELECT id, label, status, period_start, period_end,
           pl_close_transaction_id, balance_gap::text AS balance_gap
    FROM fiscal_period_closings
    ORDER BY created_at DESC
    LIMIT 5
  `;
  console.log('closings:', JSON.stringify(closings, null, 2));

  const withClose = await prisma.$queryRaw`
    SELECT
      LEFT(TRIM(je.account_code), 1) AS cls,
      ROUND(SUM(je.debit::numeric - je.credit::numeric)::numeric, 2) AS net
    FROM journal_entries je
    JOIN transactions t ON t.id = je.transaction_id
    WHERE t.is_deleted = false
      AND (t.journal_kind IS NULL OR t.journal_kind <> 'fiscal_opening')
      AND (t.reference IS NULL OR t.reference !~* '^OPEN-')
      AND (
        TRIM(je.account_code) LIKE '4%'
        OR TRIM(je.account_code) LIKE '5%'
        OR TRIM(je.account_code) LIKE '313%'
      )
    GROUP BY LEFT(TRIM(je.account_code), 1)
    ORDER BY 1
  `;
  console.log('nets WITH close (excl opening):', JSON.stringify(withClose, null, 2));

  const withoutClose = await prisma.$queryRaw`
    SELECT
      LEFT(TRIM(je.account_code), 1) AS cls,
      ROUND(SUM(je.debit::numeric - je.credit::numeric)::numeric, 2) AS net
    FROM journal_entries je
    JOIN transactions t ON t.id = je.transaction_id
    WHERE t.is_deleted = false
      AND (t.journal_kind IS NULL OR t.journal_kind NOT IN ('fiscal_opening', 'fiscal_pl_close'))
      AND (t.reference IS NULL OR (t.reference !~* '^OPEN-' AND t.reference !~* '^YE-PL-'))
      AND (TRIM(je.account_code) LIKE '4%' OR TRIM(je.account_code) LIKE '5%')
    GROUP BY LEFT(TRIM(je.account_code), 1)
    ORDER BY 1
  `;
  console.log('nets WITHOUT close journal:', JSON.stringify(withoutClose, null, 2));

  const bsGap = await prisma.$queryRaw`
    WITH nets AS (
      SELECT
        TRIM(je.account_code) AS code,
        SUM(je.debit::numeric - je.credit::numeric) AS net
      FROM journal_entries je
      JOIN transactions t ON t.id = je.transaction_id
      WHERE t.is_deleted = false
        AND (t.journal_kind IS NULL OR t.journal_kind <> 'fiscal_opening')
        AND (t.reference IS NULL OR t.reference !~* '^OPEN-')
      GROUP BY TRIM(je.account_code)
    )
    SELECT
      ROUND(SUM(CASE WHEN code LIKE '1%' THEN net ELSE 0 END)::numeric, 2) AS assets,
      ROUND(SUM(CASE WHEN code LIKE '2%' THEN -net ELSE 0 END)::numeric, 2) AS liab,
      ROUND(SUM(CASE WHEN code LIKE '3%' THEN -net ELSE 0 END)::numeric, 2) AS equity,
      ROUND(SUM(CASE WHEN code LIKE '4%' THEN -net ELSE 0 END)::numeric, 2) AS revenue,
      ROUND(SUM(CASE WHEN code LIKE '5%' THEN net ELSE 0 END)::numeric, 2) AS costs
    FROM nets
  `;
  console.log('BS-style totals:', JSON.stringify(bsGap, null, 2));

  const txCount = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n FROM transactions WHERE is_deleted = false
  `;
  console.log('tx count:', JSON.stringify(txCount));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
