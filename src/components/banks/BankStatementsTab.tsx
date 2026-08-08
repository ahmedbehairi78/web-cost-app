import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { listenQuery } from '../../lib/firestoreListen';
import toast from 'react-hot-toast';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { cn } from '../../lib/utils';
import { isLocalBackend } from '../../lib/dataBackend';
import { banksApi } from '../../services/local/modulesApi';
import {
  createBankStatement,
  updateBankStatementLine,
} from '../../lib/bankPersistence';
import type { BankAccount, BankStatement, BankStatementLine } from './types';

type LineDraft = {
  lineDate: string;
  debit: string;
  credit: string;
  reference: string;
  description: string;
};

const emptyLine = (): LineDraft => ({
  lineDate: new Date().toISOString().slice(0, 10),
  debit: '',
  credit: '',
  reference: '',
  description: '',
});

type Props = {
  statements: BankStatement[];
  language: 'ar' | 'en';
  theme: string;
  allowCreate: boolean;
  allowEdit: boolean;
  accounts: BankAccount[];
  onMutated?: () => void;
};

export function BankStatementsTab({
  statements,
  language,
  theme,
  allowCreate,
  allowEdit,
  accounts,
  onMutated,
}: Props) {
  const isAr = language === 'ar';
  const [selectedStmt, setSelectedStmt] = useState('');
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    bankAccountId: '',
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: new Date().toISOString().slice(0, 10),
    openingBalance: '0',
    closingBalance: '',
    sourceLabel: '',
  });
  const [lineRows, setLineRows] = useState<LineDraft[]>([emptyLine()]);

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-700 text-white'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] text-[#37474f]'
        : 'bg-white border-gray-300 text-gray-900',
  );
  const panelCls = cn(
    'rounded-xl border',
    theme === 'dark'
      ? 'border-gray-800 bg-[#151619]'
      : theme === 'soft'
        ? 'border-[#cfd8dc] bg-white'
        : 'border-gray-200 bg-white',
  );

  useEffect(() => {
    if (!selectedStmt) {
      setLines([]);
      return;
    }

    if (isLocalBackend) {
      let cancelled = false;
      void banksApi.statementLines
        .list(`?statementId=${encodeURIComponent(selectedStmt)}`)
        .then((rows) => {
          if (cancelled) return;
          setLines(
            (Array.isArray(rows) ? rows : []).map((raw) => {
              const x = raw as Record<string, unknown>;
              return {
                id: String(x.id ?? ''),
                statementId: String(x.statementId ?? ''),
                lineDate: String(x.lineDate ?? ''),
                reference: String(x.reference ?? ''),
                description: String(x.description ?? ''),
                debit: Number(x.debit ?? 0),
                credit: Number(x.credit ?? 0),
                matchStatus: (x.matchStatus as BankStatementLine['matchStatus']) ?? 'unmatched',
                matchedEntityType: String(x.matchedEntityType ?? ''),
                matchedEntityId: String(x.matchedEntityId ?? ''),
              };
            }),
          );
        })
        .catch((err) => {
          console.error('Failed to load statement lines:', err);
          if (!cancelled) setLines([]);
        });
      return () => {
        cancelled = true;
      };
    }

    const q = query(
      collection(db, 'bank_statement_lines'),
      where('statementId', '==', selectedStmt),
      orderBy('lineDate', 'desc'),
    );
    const unsub = listenQuery(
      q,
      (snap) => {
        setLines(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              statementId: String(x.statementId ?? ''),
              lineDate: String(x.lineDate ?? ''),
              reference: String(x.reference ?? ''),
              description: String(x.description ?? ''),
              debit: Number(x.debit ?? 0),
              credit: Number(x.credit ?? 0),
              matchStatus: (x.matchStatus as BankStatementLine['matchStatus']) ?? 'unmatched',
              matchedEntityType: String(x.matchedEntityType ?? ''),
              matchedEntityId: String(x.matchedEntityId ?? ''),
            };
          }),
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'bank_statement_lines'),
    );
    return () => unsub();
  }, [selectedStmt]);

  const statementOptions = useMemo(
    () =>
      [...statements].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
    [statements],
  );

  const submitImport = async () => {
    if (!allowCreate) return;
    if (!form.bankAccountId) {
      toast.error(isAr ? 'اختر الحساب البنكي.' : 'Select a bank account.');
      return;
    }
    const rows = lineRows
      .filter((r) => r.lineDate.trim())
      .map((r) => ({
        lineDate: r.lineDate.trim(),
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
        reference: r.reference.trim() || null,
        description: r.description.trim() || null,
      }));
    if (rows.length === 0) {
      toast.error(isAr ? 'أضف سطراً واحداً على الأقل.' : 'Add at least one line.');
      return;
    }
    setSaving(true);
    try {
      const stmtId = await createBankStatement(
        {
          bankAccountId: form.bankAccountId,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          openingBalance: Number(form.openingBalance) || 0,
          closingBalance: form.closingBalance.trim() ? Number(form.closingBalance) : null,
          sourceLabel: form.sourceLabel.trim() || null,
          createdAt: Timestamp.now(),
        },
        rows.map((r) => ({
          ...r,
          matchStatus: 'unmatched',
          matchedEntityType: null,
          matchedEntityId: null,
          createdAt: Timestamp.now(),
        })),
      );
      onMutated?.();
      toast.success(isAr ? 'تم استيراد الكشف.' : 'Statement imported.');
      setLineRows([emptyLine()]);
      setSelectedStmt(stmtId);
    } catch {
      toast.error(isAr ? 'تعذر استيراد الكشف.' : 'Failed to import statement.');
    } finally {
      setSaving(false);
    }
  };

  const saveLine = async (l: BankStatementLine) => {
    if (!allowEdit) return;
    try {
      await updateBankStatementLine(l.id, {
        matchStatus: l.matchStatus,
        matchedEntityType: l.matchedEntityType || null,
        matchedEntityId: l.matchedEntityId || null,
        updatedAt: Timestamp.now(),
      });
      toast.success(isAr ? 'تم حفظ المطابقة.' : 'Reconciliation saved.');
    } catch {
      toast.error(isAr ? 'تعذر حفظ المطابقة.' : 'Failed to save reconciliation.');
    }
  };

  const patchLineLocal = (id: string, patch: Partial<BankStatementLine>) => {
    setLines((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  return (
    <div className="space-y-6">
      <div className={cn(panelCls, 'p-4 md:p-5 space-y-4 shadow-sm')}>
        <div>
          <h3 className="font-bold text-sm">{isAr ? 'استيراد كشف حساب (يدوي)' : 'Manual statement import'}</h3>
          <p className="text-xs text-gray-500 mt-1">
            {isAr
              ? 'أدخل سطور الكشف يدويًا ثم راجع المطابقة في الجدول أدناه.'
              : 'Enter statement lines manually, then reconcile below.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          <select aria-label="statement bank account" className={inputCls} value={form.bankAccountId} onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
            <option value="">{isAr ? 'اختر الحساب البنكي' : 'Select bank account'}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {isAr ? a.nameAr : a.nameEn || a.nameAr}</option>)}
          </select>
          <input aria-label="period start" className={inputCls} type="date" value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} />
          <input aria-label="period end" className={inputCls} type="date" value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} />
          <input aria-label="opening balance" className={inputCls} type="number" step="0.01" placeholder={isAr ? 'رصيد افتتاحي' : 'Opening balance'} value={form.openingBalance} onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))} />
          <input aria-label="closing balance" className={inputCls} type="number" step="0.01" placeholder={isAr ? 'رصيد ختامي (اختياري)' : 'Closing balance (optional)'} value={form.closingBalance} onChange={(e) => setForm((f) => ({ ...f, closingBalance: e.target.value }))} />
          <input aria-label="source label" className={inputCls} placeholder={isAr ? 'مصدر الملف / ملاحظة' : 'Source label / note'} value={form.sourceLabel} onChange={(e) => setForm((f) => ({ ...f, sourceLabel: e.target.value }))} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-gray-500">{isAr ? 'سطور الكشف' : 'Statement lines'}</span>
            <button type="button" className="text-xs font-bold text-blue-600 hover:underline" onClick={() => setLineRows((r) => [...r, emptyLine()])}>
              + {isAr ? 'إضافة سطر' : 'Add line'}
            </button>
          </div>
          {lineRows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-6 gap-2">
              <input aria-label="line date" type="date" className={inputCls} value={row.lineDate} onChange={(e) => setLineRows((rs) => rs.map((x, i) => (i === idx ? { ...x, lineDate: e.target.value } : x)))} />
              <input aria-label="line debit" type="number" step="0.01" className={inputCls} placeholder="Dr" value={row.debit} onChange={(e) => setLineRows((rs) => rs.map((x, i) => (i === idx ? { ...x, debit: e.target.value } : x)))} />
              <input aria-label="line credit" type="number" step="0.01" className={inputCls} placeholder="Cr" value={row.credit} onChange={(e) => setLineRows((rs) => rs.map((x, i) => (i === idx ? { ...x, credit: e.target.value } : x)))} />
              <input aria-label="line reference" className={inputCls} placeholder={isAr ? 'مرجع' : 'Reference'} value={row.reference} onChange={(e) => setLineRows((rs) => rs.map((x, i) => (i === idx ? { ...x, reference: e.target.value } : x)))} />
              <input aria-label="line description" className={cn(inputCls, 'md:col-span-2')} placeholder={isAr ? 'بيان' : 'Description'} value={row.description} onChange={(e) => setLineRows((rs) => rs.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} />
            </div>
          ))}
        </div>

        <button type="button" disabled={saving || !allowCreate} onClick={() => void submitImport()} className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-bold disabled:opacity-50">
          {saving ? '…' : isAr ? 'حفظ الكشف' : 'Save statement'}
        </button>
      </div>

      <div className="space-y-3">
        <h3 className="font-bold text-sm">{isAr ? 'مطابقة سطور الكشف' : 'Statement reconciliation'}</h3>
        <select aria-label="select statement" className={cn(inputCls, 'max-w-md')} value={selectedStmt} onChange={(e) => setSelectedStmt(e.target.value)}>
          <option value="">{isAr ? 'اختر كشفاً' : 'Select statement'}</option>
          {statementOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.periodStart} → {s.periodEnd} · {accounts.find((a) => a.id === s.bankAccountId)?.code ?? s.bankAccountId}
            </option>
          ))}
        </select>

        {selectedStmt ? (
          <div className={cn(panelCls, 'overflow-x-auto')}>
            <table className="w-full text-xs min-w-[980px]">
              <thead>
                <tr className={cn('border-b text-left', theme === 'dark' ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-gray-50')}>
                  <th className="px-2 py-2">{isAr ? 'تاريخ' : 'Date'}</th>
                  <th className="px-2 py-2 text-end">Dr</th>
                  <th className="px-2 py-2 text-end">Cr</th>
                  <th className="px-2 py-2">{isAr ? 'مرجع' : 'Ref'}</th>
                  <th className="px-2 py-2">{isAr ? 'بيان' : 'Description'}</th>
                  <th className="px-2 py-2">{isAr ? 'حالة المطابقة' : 'Match status'}</th>
                  <th className="px-2 py-2">{isAr ? 'نوع المرجع' : 'Entity type'}</th>
                  <th className="px-2 py-2">{isAr ? 'معرف المرجع' : 'Entity id'}</th>
                  <th className="px-2 py-2 w-20">{isAr ? 'حفظ' : 'Save'}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={cn('border-b', theme === 'dark' ? 'border-gray-800' : 'border-gray-100')}>
                    <td className="px-2 py-1">{l.lineDate}</td>
                    <td className="px-2 py-1 text-end font-mono">{Number(l.debit).toFixed(2)}</td>
                    <td className="px-2 py-1 text-end font-mono">{Number(l.credit).toFixed(2)}</td>
                    <td className="px-2 py-1">{l.reference || '—'}</td>
                    <td className="px-2 py-1">{l.description || '—'}</td>
                    <td className="px-2 py-1">
                      <select aria-label="match status" className={inputCls} disabled={!allowEdit} value={l.matchStatus} onChange={(e) => patchLineLocal(l.id, { matchStatus: e.target.value as BankStatementLine['matchStatus'] })}>
                        <option value="unmatched">unmatched</option>
                        <option value="matched">matched</option>
                        <option value="suggested">suggested</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input aria-label="matched entity type" className={inputCls} disabled={!allowEdit} value={l.matchedEntityType || ''} onChange={(e) => patchLineLocal(l.id, { matchedEntityType: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <input aria-label="matched entity id" className={inputCls} disabled={!allowEdit} value={l.matchedEntityId || ''} onChange={(e) => patchLineLocal(l.id, { matchedEntityId: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <button type="button" disabled={!allowEdit} className="text-blue-600 font-bold disabled:opacity-40" onClick={() => void saveLine(l)}>
                        {isAr ? 'حفظ' : 'Save'}
                      </button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 ? (
                  <tr><td colSpan={9} className="px-2 py-8 text-center text-gray-500">{isAr ? 'لا توجد سطور لهذا الكشف.' : 'No lines for this statement.'}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
