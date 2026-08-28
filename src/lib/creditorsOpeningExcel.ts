import * as XLSX from 'xlsx';
import { cleanExcelText } from './materialsTreeExcel';

export type CreditorPartyType = 'supplier' | 'subcontractor';

export type CreditorOpeningImportRow = {
  type: CreditorPartyType;
  name: string;
  nameEn?: string;
  taxNumber?: string;
  phone?: string;
  address?: string;
  accountCode?: string;
  openingBalance: number;
};

export const CREDITORS_OPENING_SHEET = 'Parties';

const COL = {
  type: ['النوع', 'Type', 'type', 'party_type'],
  name: ['الاسم', 'Name', 'name', 'الاسم العربي'],
  nameEn: ['الاسم الإنجليزي', 'Name EN', 'Name En', 'nameEn', 'name_en'],
  taxNumber: ['الرقم الضريبي', 'Tax Number', 'taxNumber', 'tax_number', 'VAT'],
  phone: ['الهاتف', 'Phone', 'phone'],
  address: ['العنوان', 'Address', 'address'],
  accountCode: ['كود الحساب', 'Account Code', 'accountCode', 'account_code'],
  openingBalance: [
    'الرصيد الافتتاحي',
    'Opening Balance',
    'openingBalance',
    'opening_balance',
    'الرصيد',
  ],
} as const;

export function parseCreditorPartyType(raw: string): CreditorPartyType | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (
    v === 'supplier' ||
    v === 'مورد' ||
    v === 'موردين' ||
    v === 'الموردون' ||
    v.startsWith('21101')
  ) {
    return 'supplier';
  }
  if (
    v === 'subcontractor' ||
    v === 'sub-contractor' ||
    v === 'مقاول' ||
    v === 'مقاول باطن' ||
    v === 'مقاولو باطن' ||
    v === 'مقاول الباطن' ||
    v === 'باطن' ||
    v.startsWith('21102')
  ) {
    return 'subcontractor';
  }
  return null;
}

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = cleanExcelText(k);
    if (!key) continue;
    out[key] = v;
  }
  return out;
}

function cell(row: Record<string, unknown>, keys: readonly string[]): string {
  const aliases = new Map(keys.map((k) => [k.toLowerCase(), k]));
  for (const [rawKey, v] of Object.entries(row)) {
    if (!aliases.has(rawKey.toLowerCase())) continue;
    const text = cleanExcelText(v);
    if (text) return text;
  }
  return '';
}

function cellNumber(row: Record<string, unknown>, keys: readonly string[]): number {
  const aliases = new Set(keys.map((k) => k.toLowerCase()));
  for (const [rawKey, v] of Object.entries(row)) {
    if (!aliases.has(rawKey.toLowerCase())) continue;
    if (v == null || String(v).trim() === '') continue;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const n = Number(String(v).replace(/,/g, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function sheetHasPartyHeaders(keys: string[]): boolean {
  const n = new Set(keys.map((k) => cleanExcelText(k).toLowerCase()).filter(Boolean));
  const hasType = COL.type.some((k) => n.has(k.toLowerCase()));
  const hasName = COL.name.some((k) => n.has(k.toLowerCase()));
  return hasType && hasName;
}

export function parseCreditorsOpeningWorkbook(input: ArrayBuffer | Uint8Array): CreditorOpeningImportRow[] {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const preferred = wb.Sheets[CREDITORS_OPENING_SHEET];
  const sheets = preferred
    ? [preferred]
    : wb.SheetNames.map((name) => wb.Sheets[name]).filter(Boolean);
  for (const ws of sheets) {
    if (!ws) continue;
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    if (json.length === 0) continue;
    const keys = Object.keys(normalizeRowKeys(json[0] ?? {}));
    if (!sheetHasPartyHeaders(keys)) continue;
    const rows: CreditorOpeningImportRow[] = [];
    for (const raw of json) {
      const row = normalizeRowKeys(raw);
      const type = parseCreditorPartyType(cell(row, COL.type));
      const name = cell(row, COL.name);
      const nameEn = cell(row, COL.nameEn);
      if (!type || (!name && !nameEn)) continue;
      const accountCode = cell(row, COL.accountCode).replace(/\s+/g, '');
      rows.push({
        type,
        name: name || nameEn,
        nameEn: nameEn || undefined,
        taxNumber: cell(row, COL.taxNumber) || undefined,
        phone: cell(row, COL.phone) || undefined,
        address: cell(row, COL.address) || undefined,
        accountCode: accountCode || undefined,
        openingBalance: cellNumber(row, COL.openingBalance),
      });
    }
    return rows;
  }
  return [];
}

export function exportCreditorsOpeningTemplate(language: 'ar' | 'en'): void {
  const ar = language === 'ar';
  const sample = ar
    ? [
        {
          النوع: 'مورد',
          الاسم: 'شركة الحديد',
          'الاسم الإنجليزي': 'Steel Co',
          'الرقم الضريبي': '',
          الهاتف: '',
          العنوان: '',
          'كود الحساب': '',
          'الرصيد الافتتاحي': 150000,
        },
        {
          النوع: 'مقاول باطن',
          الاسم: 'مقاول التشطيب',
          'الاسم الإنجليزي': 'Finishing Subcontractor',
          'الرقم الضريبي': '',
          الهاتف: '',
          العنوان: '',
          'كود الحساب': '',
          'الرصيد الافتتاحي': 80000,
        },
      ]
    : [
        {
          Type: 'supplier',
          Name: 'Steel Co',
          'Name EN': 'Steel Co',
          'Tax Number': '',
          Phone: '',
          Address: '',
          'Account Code': '',
          'Opening Balance': 150000,
        },
        {
          Type: 'subcontractor',
          Name: 'Finishing Subcontractor',
          'Name EN': 'Finishing Subcontractor',
          'Tax Number': '',
          Phone: '',
          Address: '',
          'Account Code': '',
          'Opening Balance': 80000,
        },
      ];

  const ws = XLSX.utils.json_to_sheet(sample);
  const notes = ar
    ? [
        ['تعليمات'],
        ['النوع: مورد أو مقاول باطن (supplier / subcontractor)'],
        ['كود الحساب اختياري — إن تُرك فارغاً يُنشأ تلقائياً تحت 21101 (مورد) أو 21102 (باطن) من 8 أرقام'],
        ['لا تستخدم 21101001 أو 21102001 — هما الحسابان العامان'],
        ['الرصيد الافتتاحي = دائن (مستحق عليهم لكم). رقم سالب = مدين (دفعات مقدمة)'],
        ['القيد: مدين جاري الشركاء 31401001 / دائن حساب المورد أو المقاول'],
        ['صف بلا اسم يُتجاهل. إعادة الاستيراد تتخطى الاسم المكرر ولا تكرر القيد إن وُجدت حركة على الحساب'],
      ]
    : [
        ['Instructions'],
        ['Type: supplier or subcontractor'],
        ['Account Code is optional — blank creates the next 8-digit leaf under 21101 (supplier) or 21102 (subcontractor)'],
        ['Do not use 21101001 or 21102001 — those are the generic control accounts'],
        ['Opening Balance = credit (amount you owe). Negative = debit (advances)'],
        ['Journal: Dr partners current 31401001 / Cr the party leaf'],
        ['Rows without a name are skipped. Re-import skips duplicate names and skips opening if the leaf already has GL activity'],
      ];
  const notesWs = XLSX.utils.aoa_to_sheet(notes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, CREDITORS_OPENING_SHEET);
  XLSX.utils.book_append_sheet(wb, notesWs, ar ? 'تعليمات' : 'Instructions');
  XLSX.writeFile(wb, ar ? 'قالب_موردين_ومقاولي_باطن.xlsx' : 'Suppliers_Subcontractors_Opening_Template.xlsx');
}
