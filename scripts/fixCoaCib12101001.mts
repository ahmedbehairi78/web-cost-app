/**
 * Restore COA 12101001 to CIB (was wrongly renamed to computers under parent 11101).
 * Relink bank_accounts row for CIB to the restored leaf.
 *
 *   npx tsx scripts/fixCoaCib12101001.mts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env') });

const p = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const code = '12101001';
  const leaf = await p.chartOfAccount.findUnique({ where: { accountCode: code } });
  if (!leaf) {
    console.error(`Missing COA leaf ${code}`);
    process.exit(1);
  }

  const updated = await p.chartOfAccount.update({
    where: { accountCode: code },
    data: {
      accountName: 'البنك التجاري الدولي',
      accountNameEn: 'Commercial International Bank',
      parentCode: '12101',
      type: 'asset',
      isGroup: false,
      status: 'active',
    },
  });
  console.log('Restored COA:', {
    id: updated.id,
    accountCode: updated.accountCode,
    accountName: updated.accountName,
    parentCode: updated.parentCode,
  });

  const bank = await p.bankAccount.findFirst({
    where: { OR: [{ code }, { nameAr: { contains: 'تجاري' } }] },
  });
  if (bank) {
    const linked = await p.bankAccount.update({
      where: { id: bank.id },
      data: { coaAccountId: updated.id, code, isActive: true },
    });
    console.log('Relinked bank_accounts:', {
      id: linked.id,
      nameAr: linked.nameAr,
      code: linked.code,
      coaAccountId: linked.coaAccountId,
    });
  } else {
    console.warn('No bank_accounts row found for CIB — create one in Banks module if needed.');
  }

  console.log(
    '\nNote: If you need a computers fixed-asset leaf, create a new 11… account under the correct FA group — do not reuse 12101001.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
