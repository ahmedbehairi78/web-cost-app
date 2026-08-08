import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireReferenceRead, requireModuleWrite } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { createTransaction } from '../accounting/journal.js';
import { assertTransactionsPeriodUnlocked } from '../accounting/periodLock.js';
import { roundMoney, MONEY_TOLERANCE } from '../lib/money.js';
import { computeEgyptEmployeeStatutory } from '../lib/egyptPayrollStatutory.js';
import { env } from '../env.js';
import {
  applyAttendanceRules,
  DEFAULT_ATTENDANCE_RULE,
  type AttendanceLineInput,
  type AttendanceRuleInput,
} from '../lib/payrollAttendance.js';
import {
  buildPayrollAccrualEntries,
  distributeByPercentage,
  findPayrollLinesMissingCostCenter,
  payrollMissingCostCenterError,
  PAYROLL_ACCRUAL_ACCOUNTS,
  PAYROLL_ACCRUAL_ACCOUNT_NAMES,
  type AccrualLineInput,
} from '../lib/payrollAccrualJournal.js';

/** Load COA account names for payroll expense debit lines. */
async function loadPayrollExpenseCoaNames(
  lines: Array<{
    expenseAccountCode?: string | null;
    allocations?: Array<{ expenseAccountCode?: string | null }> | null;
  }>,
): Promise<Map<string, string>> {
  const codes = new Set<string>();
  for (const l of lines) {
    const c = str(l.expenseAccountCode) || PAYROLL_ACCOUNTS.defaultExpense;
    codes.add(c);
    for (const a of l.allocations ?? []) {
      const ac = str(a.expenseAccountCode) || c;
      if (ac) codes.add(ac);
    }
  }
  if (!codes.size) return new Map();
  const rows = await prisma.chartOfAccount.findMany({
    where: { accountCode: { in: [...codes] } },
    select: { accountCode: true, accountName: true },
  });
  return new Map(rows.map((r) => [r.accountCode, r.accountName]));
}

export const payrollRouter = Router();
payrollRouter.use(requireAuth);

const viewPerm = requireReferenceRead('payroll');
const writePerm = requireModuleWrite('payroll');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  return Number(v) || 0;
}

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function monthsOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Percentage with up to 4 decimals, clamped to [0, 100]. */
function roundPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round(n * 10000) / 10000);
}

/** Default credit/clearing accounts for payroll postings (configurable later). */
const PAYROLL_ACCOUNTS = PAYROLL_ACCRUAL_ACCOUNTS;

const PAYROLL_ACCOUNT_NAMES = PAYROLL_ACCRUAL_ACCOUNT_NAMES;

const MONTH_LABELS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function periodLabel(month: number, year: number): string {
  const m = MONTH_LABELS_AR[month - 1] ?? String(month);
  return `${m} ${year}`;
}

async function generateRunNumber(tx: Prisma.TransactionClient, month: number, year: number): Promise<string> {
  const base = `PAY-${year}${String(month).padStart(2, '0')}`;
  const existing = await tx.payrollRun.findFirst({
    where: { runNumber: { startsWith: base } },
    orderBy: { runNumber: 'desc' },
  });
  if (!existing) return base;
  // Append a suffix if a run already exists for this month
  const cnt = await tx.payrollRun.count({ where: { runNumber: { startsWith: base } } });
  return `${base}-${String(cnt + 1).padStart(2, '0')}`;
}

interface LineInput {
  employeeId?: string | null;
  employeeCode?: string;
  employeeName?: string;
  department?: string | null;
  costCenterId?: string | null;
  costCenterType?: string | null;
  costCenterCode?: string | null;
  expenseAccountCode?: string;
  expenseAccountName?: string | null;
  basicSalary?: number;
  overtime?: number;
  bonus?: number;
  incentiveKpi?: number;
  otherEarnings?: number;
  socialInsurance?: number;
  incomeTax?: number;
  advances?: number;
  penalties?: number;
  otherDeductions?: number;
  notes?: string | null;
}

function computeLineTotals(l: LineInput) {
  const basicSalary = roundMoney(num(l.basicSalary));
  const overtime = roundMoney(num(l.overtime));
  const bonus = roundMoney(num(l.bonus));
  const incentiveKpi = roundMoney(num(l.incentiveKpi));
  const otherEarnings = roundMoney(num(l.otherEarnings));
  const grossSalary = roundMoney(basicSalary + overtime + bonus + incentiveKpi + otherEarnings);

  const { socialInsurance, incomeTax } = computeEgyptEmployeeStatutory(grossSalary);
  const advances = roundMoney(num(l.advances));
  const penalties = roundMoney(num(l.penalties));
  const otherDeductions = roundMoney(num(l.otherDeductions));
  const totalDeductions = roundMoney(socialInsurance + incomeTax + advances + penalties + otherDeductions);

  const netSalary = roundMoney(grossSalary - totalDeductions);
  return {
    basicSalary, overtime, bonus, incentiveKpi, otherEarnings, grossSalary,
    socialInsurance, incomeTax, advances, penalties, otherDeductions, totalDeductions, netSalary,
  };
}

// ─── Employees ──────────────────────────────────────────────────────────────

payrollRouter.get(
  '/employees',
  viewPerm,
  asyncHandler(async (req, res) => {
    const where: Prisma.PayrollEmployeeWhereInput = { isDeleted: false };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.department) where.department = String(req.query.department);
    const rows = await prisma.payrollEmployee.findMany({ where, orderBy: { employeeCode: 'asc' } });
    res.json(rows.map((r) => serialize(r)));
  }),
);

payrollRouter.post(
  '/employees',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const employeeCode = str(b.employeeCode);
    const name = str(b.name);
    if (!employeeCode || !name) {
      res.status(400).json({ error: 'employeeCode and name are required' });
      return;
    }
    const dup = await prisma.payrollEmployee.findUnique({ where: { employeeCode } });
    if (dup && !dup.isDeleted) {
      res.status(409).json({ error: 'Employee code already exists' });
      return;
    }
    const created = await prisma.payrollEmployee.upsert({
      where: { employeeCode },
      update: {
        name,
        nameEn: str(b.nameEn) || null,
        department: str(b.department) || null,
        jobTitle: str(b.jobTitle) || null,
        defaultCostCenterId: str(b.defaultCostCenterId) || null,
        defaultCostCenterType: str(b.defaultCostCenterType) || null,
        defaultExpenseAccountCode: str(b.defaultExpenseAccountCode) || null,
        defaultExpenseAccountName: str(b.defaultExpenseAccountName) || null,
        basicSalary: roundMoney(num(b.basicSalary)),
        hireDate: str(b.hireDate) || null,
        birthDate: str(b.birthDate) || null,
        priorInsuranceMonths: monthsOrNull(b.priorInsuranceMonths),
        phoneE164: str(b.phoneE164) || null,
        whatsappOptIn: b.whatsappOptIn === true,
        status: str(b.status) || 'active',
        notes: str(b.notes) || null,
        isDeleted: false,
      },
      create: {
        employeeCode,
        name,
        nameEn: str(b.nameEn) || null,
        department: str(b.department) || null,
        jobTitle: str(b.jobTitle) || null,
        defaultCostCenterId: str(b.defaultCostCenterId) || null,
        defaultCostCenterType: str(b.defaultCostCenterType) || null,
        defaultExpenseAccountCode: str(b.defaultExpenseAccountCode) || null,
        defaultExpenseAccountName: str(b.defaultExpenseAccountName) || null,
        basicSalary: roundMoney(num(b.basicSalary)),
        hireDate: str(b.hireDate) || null,
        birthDate: str(b.birthDate) || null,
        priorInsuranceMonths: monthsOrNull(b.priorInsuranceMonths),
        phoneE164: str(b.phoneE164) || null,
        whatsappOptIn: b.whatsappOptIn === true,
        status: str(b.status) || 'active',
        notes: str(b.notes) || null,
      },
    });
    res.status(201).json(serialize(created));
  }),
);

payrollRouter.put(
  '/employees/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const b = req.body as Record<string, unknown>;
    const existing = await prisma.payrollEmployee.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }
    const updated = await prisma.payrollEmployee.update({
      where: { id },
      data: {
        name: str(b.name) || existing.name,
        nameEn: str(b.nameEn) || null,
        department: str(b.department) || null,
        jobTitle: str(b.jobTitle) || null,
        defaultCostCenterId: str(b.defaultCostCenterId) || null,
        defaultCostCenterType: str(b.defaultCostCenterType) || null,
        defaultExpenseAccountCode: str(b.defaultExpenseAccountCode) || null,
        defaultExpenseAccountName: str(b.defaultExpenseAccountName) || null,
        basicSalary: roundMoney(num(b.basicSalary)),
        hireDate: str(b.hireDate) || null,
        birthDate: str(b.birthDate) || null,
        priorInsuranceMonths: monthsOrNull(b.priorInsuranceMonths),
        phoneE164: str(b.phoneE164) || null,
        whatsappOptIn: b.whatsappOptIn === true,
        status: str(b.status) || existing.status,
        notes: str(b.notes) || null,
      },
    });
    res.json(serialize(updated));
  }),
);

payrollRouter.delete(
  '/employees/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.payrollEmployee.update({ where: { id }, data: { isDeleted: true } });
    res.json({ ok: true });
  }),
);

// ─── Employee default cost-center split ───────────────────────────────────────

interface AllocationBody {
  costCenterId?: string;
  costCenterType?: string | null;
  expenseAccountCode?: string | null;
  expenseAccountName?: string | null;
  percentage?: unknown;
}

payrollRouter.get(
  '/employees/:id/cost-center-allocations',
  viewPerm,
  asyncHandler(async (req, res) => {
    const rows = await prisma.employeeCostCenterAllocation.findMany({
      where: { employeeId: String(req.params.id) },
      orderBy: { createdAt: 'asc' },
    });
    res.json(rows.map((r) => serialize(r)));
  }),
);

payrollRouter.put(
  '/employees/:id/cost-center-allocations',
  writePerm,
  asyncHandler(async (req, res) => {
    const employeeId = String(req.params.id);
    const employee = await prisma.payrollEmployee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }
    const items = Array.isArray((req.body as { allocations?: AllocationBody[] }).allocations)
      ? (req.body as { allocations: AllocationBody[] }).allocations
      : [];
    const clean = items
      .map((a) => ({
        costCenterId: str(a.costCenterId),
        costCenterType: str(a.costCenterType) || null,
        expenseAccountCode: str(a.expenseAccountCode) || null,
        expenseAccountName: str(a.expenseAccountName) || null,
        percentage: roundPct(a.percentage),
      }))
      .filter((a) => a.costCenterId && a.percentage > 0);

    const sum = clean.reduce((s, a) => s + a.percentage, 0);
    if (clean.length && Math.abs(sum - 100) > 0.01) {
      res.status(400).json({ error: `Allocation percentages must total 100% (got ${sum})` });
      return;
    }

    const saved = await prisma.$transaction(async (tx) => {
      await tx.employeeCostCenterAllocation.deleteMany({ where: { employeeId } });
      for (const a of clean) {
        await tx.employeeCostCenterAllocation.create({ data: { employeeId, ...a } });
      }
      return tx.employeeCostCenterAllocation.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } });
    });
    res.json(saved.map((r) => serialize(r)));
  }),
);

payrollRouter.post(
  '/employees/import',
  writePerm,
  asyncHandler(async (req, res) => {
    const rows = Array.isArray((req.body as { rows?: unknown[] }).rows)
      ? ((req.body as { rows: Record<string, unknown>[] }).rows)
      : [];
    let created = 0;
    let updated = 0;
    const errors: Array<{ row: number; error: string }> = [];

    // Resolve the primary annual leave type once (used to seed carried-over balances).
    const annualLeaveTypes = await prisma.leaveType.findMany({
      where: { isDeleted: false, isActive: true, defaultAnnualDays: { gt: 0 } },
      orderBy: { sortOrder: 'asc' },
    });
    const annualLeaveType =
      annualLeaveTypes.find((lt) => lt.code.toLowerCase() === 'annual') ?? annualLeaveTypes[0] ?? null;
    const currentYear = new Date().getFullYear();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const employeeCode = str(r.employeeCode);
      const name = str(r.name);
      if (!employeeCode || !name) {
        errors.push({ row: i + 1, error: 'employeeCode and name required' });
        continue;
      }
      try {
        const existing = await prisma.payrollEmployee.findUnique({ where: { employeeCode } });
        const data = {
          name,
          nameEn: str(r.nameEn) || null,
          department: str(r.department) || null,
          jobTitle: str(r.jobTitle) || null,
          defaultExpenseAccountCode: str(r.defaultExpenseAccountCode) || null,
          defaultExpenseAccountName: str(r.defaultExpenseAccountName) || null,
          basicSalary: roundMoney(num(r.basicSalary)),
          status: str(r.status) || 'active',
          birthDate: str(r.birthDate) || null,
          hireDate: str(r.hireDate) || null,
          priorInsuranceMonths: monthsOrNull(r.priorInsuranceMonths),
          phoneE164: str(r.phoneE164) || null,
          whatsappOptIn: r.whatsappOptIn === true,
        };
        let employeeId: string;
        if (existing) {
          await prisma.payrollEmployee.update({
            where: { employeeCode },
            data: { ...data, isDeleted: false },
          });
          employeeId = existing.id;
          updated++;
        } else {
          const createdEmp = await prisma.payrollEmployee.create({
            data: { employeeCode, ...data },
          });
          employeeId = createdEmp.id;
          created++;
        }

        // Seed carried-over leave balance for the current year when provided.
        const carried = r.carriedLeaveDays;
        if (annualLeaveType && carried != null && String(carried).trim() !== '') {
          const carriedDays = num(carried);
          await prisma.employeeLeaveBalance.upsert({
            where: {
              employeeId_leaveTypeId_year: {
                employeeId,
                leaveTypeId: annualLeaveType.id,
                year: currentYear,
              },
            },
            create: {
              employeeId,
              leaveTypeId: annualLeaveType.id,
              year: currentYear,
              entitledDays: annualLeaveType.defaultAnnualDays ?? 0,
              carriedDays,
            },
            update: { carriedDays },
          });
        }
      } catch (e) {
        errors.push({ row: i + 1, error: e instanceof Error ? e.message : 'unknown' });
      }
    }
    res.json({ created, updated, errors });
  }),
);

// ─── Payroll Runs ─────────────────────────────────────────────────────────────

payrollRouter.get(
  '/runs',
  viewPerm,
  asyncHandler(async (req, res) => {
    const where: Prisma.PayrollRunWhereInput = { isDeleted: false };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.year) where.periodYear = Number(req.query.year);
    const rows = await prisma.payrollRun.findMany({
      where,
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
    res.json(rows.map((r) => serialize(r)));
  }),
);

payrollRouter.get(
  '/runs/:id',
  viewPerm,
  asyncHandler(async (req, res) => {
    const run = await prisma.payrollRun.findUnique({
      where: { id: String(req.params.id) },
      include: { lines: { orderBy: { employeeCode: 'asc' }, include: { allocations: true } } },
    });
    if (!run || run.isDeleted) {
      res.status(404).json({ error: 'Payroll run not found' });
      return;
    }
    res.json(serialize(run));
  }),
);

payrollRouter.post(
  '/runs',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as {
      periodMonth?: number;
      periodYear?: number;
      description?: string;
      lines?: LineInput[];
    };
    const month = Number(b.periodMonth);
    const year = Number(b.periodYear);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      res.status(400).json({ error: 'Valid periodMonth (1-12) and periodYear are required' });
      return;
    }
    const lines = Array.isArray(b.lines) ? b.lines : [];

    const run = await prisma.$transaction(async (tx) => {
      const runNumber = await generateRunNumber(tx, month, year);

      // Preload each employee's default cost-center split to copy onto run lines
      const empIds = Array.from(new Set(lines.map((l) => str(l.employeeId)).filter(Boolean)));
      const defaultAllocs = empIds.length
        ? await tx.employeeCostCenterAllocation.findMany({ where: { employeeId: { in: empIds } } })
        : [];
      const allocByEmp = new Map<string, typeof defaultAllocs>();
      for (const a of defaultAllocs) {
        const arr = allocByEmp.get(a.employeeId) ?? [];
        arr.push(a);
        allocByEmp.set(a.employeeId, arr);
      }

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      const lineData = lines.map((l) => {
        const t = computeLineTotals(l);
        totalGross = roundMoney(totalGross + t.grossSalary);
        totalDeductions = roundMoney(totalDeductions + t.totalDeductions);
        totalNet = roundMoney(totalNet + t.netSalary);
        const empId = str(l.employeeId) || null;
        const lineCode = str(l.expenseAccountCode) || PAYROLL_ACCOUNTS.defaultExpense;
        const defs = empId ? (allocByEmp.get(empId) ?? []) : [];
        let allocations: Prisma.PayrollRunLineAllocationCreateNestedManyWithoutRunLineInput | undefined;
        if (defs.length) {
          const amounts = distributeByPercentage(t.grossSalary, defs.map((d) => num(d.percentage)));
          allocations = {
            create: defs.map((d, idx) => ({
              costCenterId: d.costCenterId,
              costCenterType: d.costCenterType,
              expenseAccountCode: (d.expenseAccountCode || lineCode),
              expenseAccountName: d.expenseAccountName ?? (str(l.expenseAccountName) || null),
              percentage: num(d.percentage),
              amount: amounts[idx] ?? 0,
            })),
          };
        }
        return {
          employeeId: empId,
          employeeCode: str(l.employeeCode),
          employeeName: str(l.employeeName),
          department: str(l.department) || null,
          costCenterId: str(l.costCenterId) || null,
          costCenterType: str(l.costCenterType) || null,
          costCenterCode: str(l.costCenterCode) || null,
          expenseAccountCode: lineCode,
          expenseAccountName: str(l.expenseAccountName) || null,
          ...t,
          notes: str(l.notes) || null,
          ...(allocations ? { allocations } : {}),
        };
      });
      return tx.payrollRun.create({
        data: {
          runNumber,
          periodMonth: month,
          periodYear: year,
          periodLabel: periodLabel(month, year),
          description: str(b.description) || null,
          status: 'draft',
          totalGross,
          totalDeductions,
          totalNet,
          lines: { create: lineData },
        },
        include: { lines: true },
      });
    });
    res.status(201).json(serialize(run));
  }),
);

/** Replace all lines on a draft run (used after Excel import / editing). */
payrollRouter.put(
  '/runs/:id/lines',
  writePerm,
  asyncHandler(async (req, res) => {
    const runId = String(req.params.id);
    const lines = Array.isArray((req.body as { lines?: LineInput[] }).lines)
      ? (req.body as { lines: LineInput[] }).lines
      : [];

    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new Error('Payroll run not found');
      if (run.status !== 'draft') throw new Error('Only draft runs can be edited');

      await tx.payrollRunLine.deleteMany({ where: { runId } });

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      for (const l of lines) {
        const t = computeLineTotals(l);
        totalGross = roundMoney(totalGross + t.grossSalary);
        totalDeductions = roundMoney(totalDeductions + t.totalDeductions);
        totalNet = roundMoney(totalNet + t.netSalary);
        await tx.payrollRunLine.create({
          data: {
            runId,
            employeeId: str(l.employeeId) || null,
            employeeCode: str(l.employeeCode),
            employeeName: str(l.employeeName),
            department: str(l.department) || null,
            costCenterId: str(l.costCenterId) || null,
            costCenterType: str(l.costCenterType) || null,
            costCenterCode: str(l.costCenterCode) || null,
            expenseAccountCode: str(l.expenseAccountCode) || PAYROLL_ACCOUNTS.defaultExpense,
            expenseAccountName: str(l.expenseAccountName) || null,
            ...t,
            notes: str(l.notes) || null,
          },
        });
      }
      return tx.payrollRun.update({
        where: { id: runId },
        data: { totalGross, totalDeductions, totalNet },
        include: { lines: { orderBy: { employeeCode: 'asc' }, include: { allocations: true } } },
      });
    });
    res.json(serialize(result));
  }),
);

/** Replace the monthly cost-center split for a single run line (draft runs only). */
payrollRouter.put(
  '/run-lines/:lineId/allocations',
  writePerm,
  asyncHandler(async (req, res) => {
    const lineId = String(req.params.lineId);
    const items = Array.isArray((req.body as { allocations?: AllocationBody[] }).allocations)
      ? (req.body as { allocations: AllocationBody[] }).allocations
      : [];

    const result = await prisma.$transaction(async (tx) => {
      const line = await tx.payrollRunLine.findUnique({ where: { id: lineId }, include: { run: true } });
      if (!line) throw new Error('Run line not found');
      if (line.run.status !== 'draft') throw new Error('Only draft runs can be edited');

      const lineCode = line.expenseAccountCode.trim() || PAYROLL_ACCOUNTS.defaultExpense;
      const clean = items
        .map((a) => ({
          costCenterId: str(a.costCenterId),
          costCenterType: str(a.costCenterType) || null,
          expenseAccountCode: str(a.expenseAccountCode) || lineCode,
          expenseAccountName: str(a.expenseAccountName) || null,
          percentage: roundPct(a.percentage),
        }))
        .filter((a) => a.costCenterId && a.percentage > 0);

      const sum = clean.reduce((s, a) => s + a.percentage, 0);
      if (clean.length && Math.abs(sum - 100) > 0.01) {
        throw new Error(`Allocation percentages must total 100% (got ${sum})`);
      }

      await tx.payrollRunLineAllocation.deleteMany({ where: { runLineId: lineId } });
      if (clean.length) {
        const gross = roundMoney(num(line.grossSalary));
        const amounts = distributeByPercentage(gross, clean.map((a) => a.percentage));
        for (let i = 0; i < clean.length; i++) {
          await tx.payrollRunLineAllocation.create({
            data: { runLineId: lineId, ...clean[i]!, amount: amounts[i] ?? 0 },
          });
        }
      }
      return tx.payrollRunLineAllocation.findMany({ where: { runLineId: lineId }, orderBy: { createdAt: 'asc' } });
    });
    res.json(result.map((r) => serialize(r)));
  }),
);

payrollRouter.delete(
  '/runs/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const run = await prisma.payrollRun.findUnique({ where: { id } });
    if (!run) {
      res.status(404).json({ error: 'Payroll run not found' });
      return;
    }
    if (run.status !== 'draft') {
      res.status(400).json({ error: 'Only draft runs can be deleted' });
      return;
    }
    await prisma.payrollRun.update({ where: { id }, data: { isDeleted: true } });
    res.json({ ok: true });
  }),
);

// ─── Accrue (إثبات الاستحقاق) ──────────────────────────────────────────────────

/** Preview the accrual journal lines without posting. */
payrollRouter.get(
  '/runs/:id/accrue-preview',
  viewPerm,
  asyncHandler(async (req, res) => {
    const runId = String(req.params.id);
    const run = await prisma.payrollRun.findUnique({
      where: { id: runId },
      include: { lines: { include: { allocations: true } } },
    });
    if (!run || run.isDeleted) {
      res.status(404).json({ error: 'Payroll run not found' });
      return;
    }
    const missingCc = findPayrollLinesMissingCostCenter(run.lines);
    if (missingCc.length) {
      res.status(400).json({ error: payrollMissingCostCenterError(missingCc) });
      return;
    }
    const coaNames = await loadPayrollExpenseCoaNames(run.lines);
    const entries = buildPayrollAccrualEntries(run.lines as unknown as AccrualLineInput[], coaNames);
    const totalDebit = roundMoney(entries.reduce((s, e) => s + e.debit, 0));
    const totalCredit = roundMoney(entries.reduce((s, e) => s + e.credit, 0));
    res.json({
      reference: `${run.runNumber}-ACC`,
      description: `إثبات استحقاق رواتب وأجور — ${run.periodLabel}`,
      entries,
      totalDebit,
      totalCredit,
      balanced: Math.abs(totalDebit - totalCredit) <= MONEY_TOLERANCE,
    });
  }),
);

payrollRouter.post(
  '/runs/:id/accrue',
  writePerm,
  asyncHandler(async (req, res) => {
    const runId = String(req.params.id);
    const accrualDate = str((req.body as { accrualDate?: string }).accrualDate)
      || new Date().toISOString().slice(0, 10);

    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({
        where: { id: runId },
        include: { lines: { include: { allocations: true } } },
      });
      if (!run) throw new Error('Payroll run not found');
      if (run.status !== 'draft') throw new Error('Run is not in draft status');
      if (!run.lines.length) throw new Error('Run has no employee lines');

      const missingCc = findPayrollLinesMissingCostCenter(run.lines);
      if (missingCc.length) {
        throw new Error(payrollMissingCostCenterError(missingCc));
      }

      const coaNames = await loadPayrollExpenseCoaNames(run.lines);
      const entries = buildPayrollAccrualEntries(run.lines as unknown as AccrualLineInput[], coaNames);

      const journal = await createTransaction(
        {
          date: accrualDate,
          description: `إثبات استحقاق رواتب وأجور — ${run.periodLabel}`,
          reference: `${run.runNumber}-ACC`,
          entries,
        },
        req.user?.id,
        tx,
      );

      const updated = await tx.payrollRun.update({
        where: { id: runId },
        data: { status: 'accrued', accrualDate, accrualTransactionId: journal.id },
        include: { lines: { orderBy: { employeeCode: 'asc' } } },
      });
      return { run: updated, transactionId: journal.id };
    });

    res.json({ ...(serialize(result.run) as Record<string, unknown>), transactionId: result.transactionId });
  }),
);

// ─── Pay (سداد الأجور) ──────────────────────────────────────────────────────────

payrollRouter.post(
  '/runs/:id/pay',
  writePerm,
  asyncHandler(async (req, res) => {
    const runId = String(req.params.id);
    const b = req.body as { paymentAccountCode?: string; paymentAccountName?: string; paymentDate?: string };
    const paymentAccountCode = str(b.paymentAccountCode);
    if (!paymentAccountCode) {
      res.status(400).json({ error: 'paymentAccountCode (bank/cash) is required' });
      return;
    }
    if (!/^1210[12]\d{3}$/.test(paymentAccountCode)) {
      res.status(400).json({
        error: 'paymentAccountCode must be a bank (12101…) or cash (12102…) leaf account',
      });
      return;
    }
    const paymentDate = str(b.paymentDate) || new Date().toISOString().slice(0, 10);

    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new Error('Payroll run not found');
      if (run.status !== 'accrued') throw new Error('Run must be accrued before payment');

      const net = roundMoney(num(run.totalNet));
      if (net <= MONEY_TOLERANCE) throw new Error('Net payable amount is zero');

      const journal = await createTransaction(
        {
          date: paymentDate,
          description: `سداد رواتب وأجور — ${run.periodLabel}`,
          reference: `${run.runNumber}-PAY`,
          entries: [
            {
              accountCode: PAYROLL_ACCOUNTS.netSalaries,
              accountName: PAYROLL_ACCOUNT_NAMES[PAYROLL_ACCOUNTS.netSalaries],
              debit: net,
              credit: 0,
            },
            {
              accountCode: paymentAccountCode,
              accountName: str(b.paymentAccountName) || undefined,
              debit: 0,
              credit: net,
            },
          ],
        },
        req.user?.id,
        tx,
      );

      const updated = await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'paid',
          paymentDate,
          paymentAccountCode,
          paymentAccountName: str(b.paymentAccountName) || null,
          paymentTransactionId: journal.id,
        },
        include: { lines: { orderBy: { employeeCode: 'asc' } } },
      });
      return { run: updated, transactionId: journal.id };
    });

    res.json({ ...(serialize(result.run) as Record<string, unknown>), transactionId: result.transactionId });
  }),
);

// ─── Reopen (admin) — soft-revert accrual/payment ──────────────────────────────

payrollRouter.post(
  '/runs/:id/reopen',
  writePerm,
  asyncHandler(async (req, res) => {
    const runId = String(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new Error('Payroll run not found');
      if (run.status === 'draft') throw new Error('Run is already draft');

      // Soft-delete linked GL transactions
      for (const txId of [run.accrualTransactionId, run.paymentTransactionId]) {
        if (txId) {
          await assertTransactionsPeriodUnlocked(tx, [txId], req.user?.id);
          await tx.transaction.updateMany({ where: { id: txId }, data: { isDeleted: true } });
        }
      }
      return tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'draft',
          accrualTransactionId: null,
          accrualDate: null,
          paymentTransactionId: null,
          paymentDate: null,
          paymentAccountCode: null,
          paymentAccountName: null,
        },
        include: { lines: { orderBy: { employeeCode: 'asc' } } },
      });
    });
    res.json(serialize(result));
  }),
);

// ─── Salary notifications (WhatsApp) ───────────────────────────────────────────

/** Enqueue monthly salary WhatsApp messages for each employee line with a phone + opt-in. */
payrollRouter.post(
  '/runs/:id/notify-salaries',
  writePerm,
  asyncHandler(async (req, res) => {
    const runId = String(req.params.id);
    const langCode = str((req.body as { languageCode?: string }).languageCode) === 'en' ? 'en' : 'ar';
    const run = await prisma.payrollRun.findUnique({
      where: { id: runId },
      include: { lines: true },
    });
    if (!run || run.isDeleted) {
      res.status(404).json({ error: 'Payroll run not found' });
      return;
    }
    if (run.status === 'draft') {
      res.status(400).json({ error: 'Run must be accrued before notifying salaries' });
      return;
    }

    const empIds = Array.from(new Set(run.lines.map((l) => l.employeeId).filter((x): x is string => !!x)));
    const employees = empIds.length
      ? await prisma.payrollEmployee.findMany({ where: { id: { in: empIds } } })
      : [];
    const empById = new Map(employees.map((e) => [e.id, e]));

    let queued = 0;
    let skipped = 0;
    for (const line of run.lines) {
      const emp = line.employeeId ? empById.get(line.employeeId) : null;
      if (!emp || !emp.whatsappOptIn || !emp.phoneE164) {
        skipped += 1;
        continue;
      }
      const net = roundMoney(num(line.netSalary));
      const gross = roundMoney(num(line.grossSalary));
      const bodyParams = [emp.name, run.periodLabel, String(net), String(gross)];
      const dedupeHash = `salary:${run.id}:${emp.id}`;
      await prisma.employeeNotificationOutbox.upsert({
        where: { dedupeHash },
        create: {
          employeeId: emp.id,
          phoneE164: emp.phoneE164,
          templateName: env.whatsappSalaryTemplate,
          payload: { bodyParams, languageCode: langCode },
          dedupeHash,
          status: 'pending',
        },
        update: {
          phoneE164: emp.phoneE164,
          payload: { bodyParams, languageCode: langCode },
          status: 'pending',
          attemptCount: 0,
          lastError: null,
          scheduledAt: new Date(),
        },
      });
      queued += 1;
    }

    res.json({ queued, skipped, dryRun: env.whatsappDryRun });
  }),
);

// ─── Attendance Rules ─────────────────────────────────────────────────────────

async function getOrCreateAttendanceRule() {
  const existing = await prisma.attendanceRule.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  return prisma.attendanceRule.create({ data: {} });
}

function serializeAttendanceRule(row: {
  workingDaysPerMonth: number;
  dailyWorkHours: number;
  overtimeMultiplier: number;
  lateGraceMins: number;
  lateTier1Mins: number;
  lateTier2Mins: number;
  lateTier3Mins: number;
  lateAboveTier3: string;
  absenceDeduction: string;
  absenceFixedAmount: unknown;
  [key: string]: unknown;
}): AttendanceRuleInput & { id: string } {
  return {
    id: String(row.id),
    workingDaysPerMonth: row.workingDaysPerMonth,
    dailyWorkHours: Number(row.dailyWorkHours),
    overtimeMultiplier: Number(row.overtimeMultiplier),
    lateGraceMins: row.lateGraceMins,
    lateTier1Mins: row.lateTier1Mins,
    lateTier2Mins: row.lateTier2Mins,
    lateTier3Mins: row.lateTier3Mins,
    lateAboveTier3: row.lateAboveTier3,
    absenceDeduction: row.absenceDeduction,
    absenceFixedAmount: num(row.absenceFixedAmount),
  };
}

payrollRouter.get(
  '/attendance-rules',
  viewPerm,
  asyncHandler(async (_req, res) => {
    const rule = await getOrCreateAttendanceRule();
    res.json(serializeAttendanceRule(rule));
  }),
);

payrollRouter.put(
  '/attendance-rules',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const existing = await getOrCreateAttendanceRule();
    const updated = await prisma.attendanceRule.update({
      where: { id: existing.id },
      data: {
        workingDaysPerMonth: Number(b.workingDaysPerMonth) || DEFAULT_ATTENDANCE_RULE.workingDaysPerMonth,
        dailyWorkHours: Number(b.dailyWorkHours) || DEFAULT_ATTENDANCE_RULE.dailyWorkHours,
        overtimeMultiplier: Number(b.overtimeMultiplier) || DEFAULT_ATTENDANCE_RULE.overtimeMultiplier,
        lateGraceMins: Number(b.lateGraceMins) ?? DEFAULT_ATTENDANCE_RULE.lateGraceMins,
        lateTier1Mins: Number(b.lateTier1Mins) ?? DEFAULT_ATTENDANCE_RULE.lateTier1Mins,
        lateTier2Mins: Number(b.lateTier2Mins) ?? DEFAULT_ATTENDANCE_RULE.lateTier2Mins,
        lateTier3Mins: Number(b.lateTier3Mins) ?? DEFAULT_ATTENDANCE_RULE.lateTier3Mins,
        lateAboveTier3: str(b.lateAboveTier3) || DEFAULT_ATTENDANCE_RULE.lateAboveTier3,
        absenceDeduction: str(b.absenceDeduction) || DEFAULT_ATTENDANCE_RULE.absenceDeduction,
        absenceFixedAmount: roundMoney(num(b.absenceFixedAmount)),
      },
    });
    res.json(serializeAttendanceRule(updated));
  }),
);

// ─── Attendance Imports ───────────────────────────────────────────────────────

payrollRouter.get(
  '/attendance-imports',
  viewPerm,
  asyncHandler(async (req, res) => {
    const where: Prisma.AttendanceImportWhereInput = {};
    if (req.query.year) where.periodYear = Number(req.query.year);
    if (req.query.month) where.periodMonth = Number(req.query.month);
    const rows = await prisma.attendanceImport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { lines: true } } },
    });
    res.json(rows.map((r) => ({
      ...(serialize(r) as Record<string, unknown>),
      lineCount: r._count.lines,
    })));
  }),
);

payrollRouter.get(
  '/attendance-imports/:id',
  viewPerm,
  asyncHandler(async (req, res) => {
    const row = await prisma.attendanceImport.findUnique({
      where: { id: String(req.params.id) },
      include: { lines: { orderBy: { employeeCode: 'asc' } } },
    });
    if (!row) {
      res.status(404).json({ error: 'Attendance import not found' });
      return;
    }
    res.json(serialize(row));
  }),
);

payrollRouter.post(
  '/attendance-imports',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as {
      periodMonth?: number;
      periodYear?: number;
      fileName?: string;
      lines?: AttendanceLineInput[];
    };
    const month = Number(b.periodMonth);
    const year = Number(b.periodYear);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      res.status(400).json({ error: 'Valid periodMonth (1-12) and periodYear are required' });
      return;
    }
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (!lines.length) {
      res.status(400).json({ error: 'At least one attendance line is required' });
      return;
    }

    const created = await prisma.attendanceImport.create({
      data: {
        periodMonth: month,
        periodYear: year,
        fileName: str(b.fileName) || 'attendance.xlsx',
        rowCount: lines.length,
        importedBy: req.user?.id ?? null,
        lines: {
          create: lines.map((l) => {
            const breakdown = normalizeLeaveBreakdown(l.leaveBreakdown);
            const paidFromBreakdown = breakdown
              ? Object.values(breakdown).reduce((s, v) => s + v, 0)
              : null;
            return {
              employeeCode: str(l.employeeCode),
              employeeName: str(l.employeeName) || null,
              daysPresent: num(l.daysPresent),
              daysAbsent: num(l.daysAbsent),
              daysPaidLeave: paidFromBreakdown ?? num(l.daysPaidLeave),
              leaveBreakdown: breakdown ?? Prisma.JsonNull,
              lateMinutes: num(l.lateMinutes),
              directPenalties: num(l.directPenalties),
              overtimeHours: num(l.overtimeHours),
              notes: str(l.notes) || null,
            };
          }),
        },
      },
      include: { lines: { orderBy: { employeeCode: 'asc' } } },
    });

    // Keep employee leave balances in sync with the imported usage.
    try {
      await recomputeLeaveBalancesUsed(year);
    } catch {
      /* non-fatal — balances can be recomputed manually from the leave tab */
    }

    res.status(201).json(serialize(created));
  }),
);

interface ApplyAttendancePreviewRow {
  employeeCode: string;
  employeeName: string;
  employeeId: string | null;
  department: string | null;
  costCenterId: string | null;
  costCenterType: string | null;
  costCenterCode: string | null;
  expenseAccountCode: string;
  expenseAccountName: string | null;
  basicSalary: number;
  overtime: number;
  socialInsurance: number;
  incomeTax: number;
  penalties: number;
  /** Penalty days from sheet (أيام الجزاءات). */
  penaltyDays: number;
  /** Money from penalty days only. */
  penaltyDaysDeduction: number;
  absenceDeduction: number;
  lateDeduction: number;
  grossSalary: number;
  netSalary: number;
  daysPresent: number;
  daysAbsent: number;
  daysPaidLeave: number;
  lateMinutes: number;
  overtimeHours: number;
  notes: string | null;
  matched: boolean;
  warning?: string;
}

async function buildAttendancePreview(
  attendanceLines: AttendanceLineInput[],
  rule: AttendanceRuleInput,
): Promise<ApplyAttendancePreviewRow[]> {
  const employees = await prisma.payrollEmployee.findMany({
    where: { isDeleted: false },
  });
  const empByCode = new Map(employees.map((e) => [e.employeeCode.trim().toLowerCase(), e]));

  return attendanceLines
    .filter((l) => str(l.employeeCode))
    .map((att) => {
      const code = str(att.employeeCode);
      const emp = empByCode.get(code.toLowerCase());
      const basicSalary = emp ? roundMoney(num(emp.basicSalary)) : 0;
      const paidFromBreakdown = att.leaveBreakdown
        ? Object.values(att.leaveBreakdown).reduce((s, v) => s + num(v), 0)
        : 0;
      const attNorm: AttendanceLineInput = {
        ...att,
        daysPaidLeave: paidFromBreakdown > 0 ? paidFromBreakdown : num(att.daysPaidLeave),
      };
      const computed = applyAttendanceRules(attNorm, rule, basicSalary);
      const t = computeLineTotals({
        basicSalary: computed.basicSalary,
        overtime: computed.overtime,
        penalties: computed.penalties,
        advances: 0,
        otherDeductions: 0,
        bonus: 0,
        incentiveKpi: 0,
        otherEarnings: 0,
      });

      let warning: string | undefined;
      if (!emp) warning = 'Employee code not found in master';
      else if (basicSalary <= 0) warning = 'Employee basic salary is zero — set it on the employee master';

      return {
        employeeCode: code,
        employeeName: str(att.employeeName) || emp?.name || code,
        employeeId: emp?.id ?? null,
        department: emp?.department ?? null,
        costCenterId: emp?.defaultCostCenterId ?? null,
        costCenterType: emp?.defaultCostCenterType ?? null,
        costCenterCode: null,
        expenseAccountCode: emp?.defaultExpenseAccountCode?.trim() || PAYROLL_ACCOUNTS.defaultExpense,
        expenseAccountName: emp?.defaultExpenseAccountName ?? null,
        basicSalary: computed.basicSalary,
        overtime: computed.overtime,
        socialInsurance: t.socialInsurance,
        incomeTax: t.incomeTax,
        penalties: computed.penalties,
        penaltyDays: computed.directPenalties,
        penaltyDaysDeduction: computed.penaltyDaysDeduction,
        absenceDeduction: computed.absenceDeduction,
        lateDeduction: computed.lateDeduction,
        grossSalary: t.grossSalary,
        netSalary: t.netSalary,
        daysPresent: computed.daysPresent,
        daysAbsent: computed.daysAbsent,
        daysPaidLeave: computed.daysPaidLeave,
        lateMinutes: computed.lateMinutes,
        overtimeHours: computed.overtimeHours,
        notes: computed.notes,
        matched: !!emp,
        warning,
      };
    });
}

payrollRouter.post(
  '/runs/:id/apply-attendance',
  writePerm,
  asyncHandler(async (req, res) => {
    const runId = String(req.params.id);
    const b = req.body as {
      importId?: string;
      lines?: AttendanceLineInput[];
      mode?: 'preview' | 'apply';
    };
    const mode = b.mode === 'apply' ? 'apply' : 'preview';

    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run || run.isDeleted) {
      res.status(404).json({ error: 'Payroll run not found' });
      return;
    }
    if (run.status !== 'draft') {
      res.status(400).json({ error: 'Only draft runs can receive attendance data' });
      return;
    }

    let attendanceLines: AttendanceLineInput[] = [];
    // Prefer freshly parsed lines from the client (avoids DB round-trip / header issues).
    if (Array.isArray(b.lines) && b.lines.length > 0) {
      attendanceLines = b.lines;
    } else if (b.importId) {
      const imp = await prisma.attendanceImport.findUnique({
        where: { id: String(b.importId) },
        include: { lines: true },
      });
      if (!imp) {
        res.status(404).json({ error: 'Attendance import not found' });
        return;
      }
      attendanceLines = imp.lines.map((l) => ({
        employeeCode: l.employeeCode,
        employeeName: l.employeeName,
        daysPresent: num(l.daysPresent),
        daysAbsent: num(l.daysAbsent),
        daysPaidLeave: num(l.daysPaidLeave),
        leaveBreakdown: normalizeLeaveBreakdown(l.leaveBreakdown) ?? undefined,
        lateMinutes: num(l.lateMinutes),
        directPenalties: num(l.directPenalties),
        overtimeHours: num(l.overtimeHours),
        notes: l.notes,
      }));
    } else {
      res.status(400).json({ error: 'importId or lines required' });
      return;
    }

    const ruleRow = await getOrCreateAttendanceRule();
    const rule = serializeAttendanceRule(ruleRow);
    const preview = await buildAttendancePreview(attendanceLines, rule);

    if (mode === 'preview') {
      res.json({ preview, rule });
      return;
    }

    const existingLines = await prisma.payrollRunLine.findMany({ where: { runId } });
    const existingByCode = new Map(
      existingLines.map((l) => [l.employeeCode.trim().toLowerCase(), l]),
    );

    const lineInputs: LineInput[] = preview.map((p) => {
      const prev = existingByCode.get(p.employeeCode.trim().toLowerCase());
      return {
        employeeId: p.employeeId,
        employeeCode: p.employeeCode,
        employeeName: p.employeeName,
        department: p.department,
        costCenterId: p.costCenterId,
        costCenterType: p.costCenterType,
        costCenterCode: p.costCenterCode,
        expenseAccountCode: p.expenseAccountCode,
        expenseAccountName: p.expenseAccountName,
        basicSalary: p.basicSalary,
        overtime: p.overtime,
        penalties: p.penalties,
        // Keep manual money fields if the run already had lines for this employee
        bonus: prev ? num(prev.bonus) : 0,
        incentiveKpi: prev ? num(prev.incentiveKpi) : 0,
        otherEarnings: prev ? num(prev.otherEarnings) : 0,
        advances: prev ? num(prev.advances) : 0,
        otherDeductions: prev ? num(prev.otherDeductions) : 0,
        notes: p.notes,
      };
    });

    const result = await prisma.$transaction(async (tx) => {
      await tx.payrollRunLine.deleteMany({ where: { runId } });
      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      for (const l of lineInputs) {
        const t = computeLineTotals(l);
        totalGross = roundMoney(totalGross + t.grossSalary);
        totalDeductions = roundMoney(totalDeductions + t.totalDeductions);
        totalNet = roundMoney(totalNet + t.netSalary);
        await tx.payrollRunLine.create({
          data: {
            runId,
            employeeId: str(l.employeeId) || null,
            employeeCode: str(l.employeeCode),
            employeeName: str(l.employeeName),
            department: str(l.department) || null,
            costCenterId: str(l.costCenterId) || null,
            costCenterType: str(l.costCenterType) || null,
            costCenterCode: str(l.costCenterCode) || null,
            expenseAccountCode: str(l.expenseAccountCode) || PAYROLL_ACCOUNTS.defaultExpense,
            expenseAccountName: str(l.expenseAccountName) || null,
            ...t,
            notes: str(l.notes) || null,
          },
        });
      }
      return tx.payrollRun.update({
        where: { id: runId },
        data: { totalGross, totalDeductions, totalNet },
        include: { lines: { orderBy: { employeeCode: 'asc' } } },
      });
    });

    res.json({ preview, run: serialize(result) });
  }),
);

// ─── Leave types ────────────────────────────────────────────────────────────────

payrollRouter.get(
  '/leave-types',
  viewPerm,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.leaveType.findMany({
      where: { isDeleted: false },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(rows.map((r) => serialize(r)));
  }),
);

payrollRouter.post(
  '/leave-types',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const code = str(b.code).toLowerCase();
    if (!code) {
      res.status(400).json({ error: 'code is required' });
      return;
    }
    const created = await prisma.leaveType.create({
      data: {
        code,
        nameAr: str(b.nameAr) || code,
        nameEn: str(b.nameEn) || code,
        paid: b.paid !== false,
        affectsAnnualBalance: b.affectsAnnualBalance === true,
        defaultAnnualDays: Math.max(0, Math.trunc(num(b.defaultAnnualDays))),
        sortOrder: Math.trunc(num(b.sortOrder)),
      },
    });
    res.status(201).json(serialize(created));
  }),
);

payrollRouter.patch(
  '/leave-types/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const data: Prisma.LeaveTypeUpdateInput = {};
    if (b.nameAr !== undefined) data.nameAr = str(b.nameAr);
    if (b.nameEn !== undefined) data.nameEn = str(b.nameEn);
    if (b.paid !== undefined) data.paid = b.paid === true;
    if (b.affectsAnnualBalance !== undefined) data.affectsAnnualBalance = b.affectsAnnualBalance === true;
    if (b.defaultAnnualDays !== undefined) data.defaultAnnualDays = Math.max(0, Math.trunc(num(b.defaultAnnualDays)));
    if (b.sortOrder !== undefined) data.sortOrder = Math.trunc(num(b.sortOrder));
    if (b.isActive !== undefined) data.isActive = b.isActive === true;
    const updated = await prisma.leaveType.update({ where: { id: String(req.params.id) }, data });
    res.json(serialize(updated));
  }),
);

payrollRouter.delete(
  '/leave-types/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    await prisma.leaveType.update({ where: { id: String(req.params.id) }, data: { isDeleted: true } });
    res.json({ ok: true });
  }),
);

// ─── Official holidays ──────────────────────────────────────────────────────────

payrollRouter.get(
  '/official-holidays',
  viewPerm,
  asyncHandler(async (req, res) => {
    const where: Prisma.OfficialHolidayWhereInput = { isDeleted: false };
    if (req.query.year) where.year = Number(req.query.year);
    const rows = await prisma.officialHoliday.findMany({ where, orderBy: { holidayDate: 'asc' } });
    res.json(rows.map((r) => serialize(r)));
  }),
);

payrollRouter.post(
  '/official-holidays',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const holidayDate = str(b.holidayDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) {
      res.status(400).json({ error: 'holidayDate must be YYYY-MM-DD' });
      return;
    }
    const created = await prisma.officialHoliday.create({
      data: {
        holidayDate,
        year: Number(holidayDate.slice(0, 4)),
        nameAr: str(b.nameAr) || holidayDate,
        nameEn: str(b.nameEn) || holidayDate,
      },
    });
    res.status(201).json(serialize(created));
  }),
);

payrollRouter.patch(
  '/official-holidays/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const data: Prisma.OfficialHolidayUpdateInput = {};
    if (b.holidayDate !== undefined) {
      const d = str(b.holidayDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        res.status(400).json({ error: 'holidayDate must be YYYY-MM-DD' });
        return;
      }
      data.holidayDate = d;
      data.year = Number(d.slice(0, 4));
    }
    if (b.nameAr !== undefined) data.nameAr = str(b.nameAr);
    if (b.nameEn !== undefined) data.nameEn = str(b.nameEn);
    const updated = await prisma.officialHoliday.update({ where: { id: String(req.params.id) }, data });
    res.json(serialize(updated));
  }),
);

payrollRouter.delete(
  '/official-holidays/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    await prisma.officialHoliday.update({ where: { id: String(req.params.id) }, data: { isDeleted: true } });
    res.json({ ok: true });
  }),
);

// ─── Employee leave balances ────────────────────────────────────────────────────

/** Clean an incoming leave breakdown into a positive-only { code: days } map. */
function normalizeLeaveBreakdown(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [code, val] of Object.entries(raw as Record<string, unknown>)) {
    const days = num(val);
    const key = str(code).toLowerCase();
    if (key && days > 0) out[key] = (out[key] ?? 0) + days;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Recompute `usedDays` on employee leave balances for a year from the latest
 * attendance import per month. Idempotent — re-importing a month replaces, never
 * doubles. Preserves entitled/carried; creates a balance row when none exists.
 */
async function recomputeLeaveBalancesUsed(year: number): Promise<{ updated: number; created: number }> {
  const imports = await prisma.attendanceImport.findMany({
    where: { periodYear: year },
    orderBy: { createdAt: 'desc' },
    include: { lines: true },
  });
  // Keep only the most recent import per month (imports are desc by createdAt).
  const latestByMonth = new Map<number, (typeof imports)[number]>();
  for (const imp of imports) {
    if (!latestByMonth.has(imp.periodMonth)) latestByMonth.set(imp.periodMonth, imp);
  }

  const [employees, leaveTypes] = await Promise.all([
    prisma.payrollEmployee.findMany({ where: { isDeleted: false } }),
    prisma.leaveType.findMany({ where: { isDeleted: false } }),
  ]);
  const empByCode = new Map(employees.map((e) => [e.employeeCode.trim().toLowerCase(), e]));
  const typeByCode = new Map(leaveTypes.map((lt) => [lt.code.toLowerCase(), lt]));

  // aggregate: `${employeeId}|${leaveTypeId}` -> used days
  const used = new Map<string, number>();
  for (const imp of latestByMonth.values()) {
    for (const line of imp.lines) {
      const breakdown = normalizeLeaveBreakdown(line.leaveBreakdown);
      if (!breakdown) continue;
      const emp = empByCode.get(line.employeeCode.trim().toLowerCase());
      if (!emp) continue;
      for (const [code, days] of Object.entries(breakdown)) {
        const lt = typeByCode.get(code);
        if (!lt) continue;
        const key = `${emp.id}|${lt.id}`;
        used.set(key, (used.get(key) ?? 0) + days);
      }
    }
  }

  const existing = await prisma.employeeLeaveBalance.findMany({ where: { year } });
  const existingByKey = new Map(existing.map((b) => [`${b.employeeId}|${b.leaveTypeId}`, b]));
  const typeById = new Map(leaveTypes.map((lt) => [lt.id, lt]));

  let updated = 0;
  let created = 0;

  // Reset existing balances to their aggregated value (0 when no usage this year).
  for (const b of existing) {
    const target = used.get(`${b.employeeId}|${b.leaveTypeId}`) ?? 0;
    if (num(b.usedDays) !== target) {
      await prisma.employeeLeaveBalance.update({ where: { id: b.id }, data: { usedDays: target } });
      updated += 1;
    }
  }

  // Create balances for usage that has no existing row yet.
  for (const [key, days] of used.entries()) {
    if (existingByKey.has(key)) continue;
    const [employeeId, leaveTypeId] = key.split('|');
    const lt = typeById.get(leaveTypeId);
    await prisma.employeeLeaveBalance.create({
      data: { employeeId, leaveTypeId, year, entitledDays: lt?.defaultAnnualDays ?? 0, usedDays: days },
    });
    created += 1;
  }

  return { updated, created };
}

payrollRouter.get(
  '/leave-balances',
  viewPerm,
  asyncHandler(async (req, res) => {
    const where: Prisma.EmployeeLeaveBalanceWhereInput = {};
    if (req.query.year) where.year = Number(req.query.year);
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);
    const rows = await prisma.employeeLeaveBalance.findMany({
      where,
      include: { employee: true, leaveType: true },
      orderBy: [{ employee: { employeeCode: 'asc' } }, { leaveType: { sortOrder: 'asc' } }],
    });
    res.json(rows.map((r) => ({
      ...(serialize(r) as Record<string, unknown>),
      employeeCode: r.employee.employeeCode,
      employeeName: r.employee.name,
      leaveTypeCode: r.leaveType.code,
      leaveTypeNameAr: r.leaveType.nameAr,
      leaveTypeNameEn: r.leaveType.nameEn,
    })));
  }),
);

payrollRouter.put(
  '/leave-balances',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const employeeId = str(b.employeeId);
    const leaveTypeId = str(b.leaveTypeId);
    const year = Number(b.year);
    if (!employeeId || !leaveTypeId || !Number.isInteger(year)) {
      res.status(400).json({ error: 'employeeId, leaveTypeId and year are required' });
      return;
    }
    const payload = {
      entitledDays: num(b.entitledDays),
      carriedDays: num(b.carriedDays),
      usedDays: num(b.usedDays),
      notes: str(b.notes) || null,
    };
    const saved = await prisma.employeeLeaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
      create: { employeeId, leaveTypeId, year, ...payload },
      update: payload,
    });
    res.json(serialize(saved));
  }),
);

payrollRouter.post(
  '/leave-balances/initialize',
  writePerm,
  asyncHandler(async (req, res) => {
    const year = Number((req.body as Record<string, unknown>).year);
    if (!Number.isInteger(year)) {
      res.status(400).json({ error: 'year is required' });
      return;
    }
    const [employees, leaveTypes] = await Promise.all([
      prisma.payrollEmployee.findMany({ where: { isDeleted: false, status: 'active' } }),
      prisma.leaveType.findMany({ where: { isDeleted: false, isActive: true, defaultAnnualDays: { gt: 0 } } }),
    ]);
    let created = 0;
    for (const emp of employees) {
      for (const lt of leaveTypes) {
        const existing = await prisma.employeeLeaveBalance.findUnique({
          where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: lt.id, year } },
        });
        if (existing) continue;
        await prisma.employeeLeaveBalance.create({
          data: { employeeId: emp.id, leaveTypeId: lt.id, year, entitledDays: lt.defaultAnnualDays },
        });
        created += 1;
      }
    }
    res.json({ created });
  }),
);

payrollRouter.post(
  '/leave-balances/recompute-used',
  writePerm,
  asyncHandler(async (req, res) => {
    const year = Number((req.body as Record<string, unknown>).year);
    if (!Number.isInteger(year)) {
      res.status(400).json({ error: 'year is required' });
      return;
    }
    const result = await recomputeLeaveBalancesUsed(year);
    res.json(result);
  }),
);
