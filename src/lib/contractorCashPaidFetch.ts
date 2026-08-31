import { glApi } from '../services/local/modulesApi';
import { sumContractorCashPaymentsFromGl } from './serviceContractor';

/**
 * المسدد for an IPC: prefer server aggregate; fall back to client GL scan
 * (old API without /contractor-cash-payments, or transient network errors).
 */
export async function fetchContractorCashPaidAmount(
  accountCode: string,
  costCenterIds: string[],
  projectIds?: string[],
): Promise<number> {
  const code = String(accountCode || '').trim();
  const centers = [...new Set(costCenterIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!code || centers.length === 0) return 0;
  const projects = projectIds?.map((id) => String(id).trim()).filter(Boolean);

  try {
    const res = await glApi.contractorCashPayments(code, centers, {
      projectIds: projects?.length ? projects : undefined,
    });
    return Number(res.paid) || 0;
  } catch {
    try {
      const txs = await glApi.transactionsQuery({
        accountFrom: code,
        accountTo: code,
        limit: 5000,
      });
      return sumContractorCashPaymentsFromGl(txs, code, centers, {
        projectIds: projects,
      });
    } catch {
      return 0;
    }
  }
}
