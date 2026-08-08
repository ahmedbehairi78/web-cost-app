import * as XLSX from 'xlsx';

export type FixedAssetImportRow = {
  assetName: string;
  groupName?: string;
  acquisitionDate: string;
  assetValue: number;
  salvageValue?: number;
  usefulLifeYears?: number;
  depreciationModel?: string;
  assetAccountCode?: string;
  assetAccountName?: string;
  accumulatedDepreciationAccountCode?: string;
  accumulatedDepreciationAccountName?: string;
  expenseAccountCode?: string;
  expenseAccountName?: string;
  costCenterId?: string;
  costCenterType?: string;
  notes?: string;
};

const HEADERS_AR = [
  'اسم الأصل',
  'مجموعة الأصول',
  'تاريخ الاقتناء',
  'قيمة الأصل',
  'قيمة الخردة',
  'العمر المفيد (سنوات)',
  'نموذج الإهلاك',
  'كود حساب الأصل',
  'اسم حساب الأصل',
  'كود حساب مجمع الإهلاك',
  'اسم حساب مجمع الإهلاك',
  'كود حساب مصروف الإهلاك',
  'اسم حساب مصروف الإهلاك',
  'كود مركز التكلفة',
  'نوع مركز التكلفة',
  'ملاحظات',
];

const HEADERS_EN = [
  'Asset Name',
  'Asset Group',
  'Acquisition Date',
  'Asset Value',
  'Salvage Value',
  'Useful Life (Years)',
  'Depreciation Model',
  'Asset Account Code',
  'Asset Account Name',
  'Accumulated Depr. Account Code',
  'Accumulated Depr. Account Name',
  'Expense Account Code',
  'Expense Account Name',
  'Cost Center ID',
  'Cost Center Type',
  'Notes',
];

const COL_AR: Record<string, keyof FixedAssetImportRow> = {
  'اسم الأصل': 'assetName',
  'مجموعة الأصول': 'groupName',
  'تاريخ الاقتناء': 'acquisitionDate',
  'قيمة الأصل': 'assetValue',
  'قيمة الخردة': 'salvageValue',
  'العمر المفيد (سنوات)': 'usefulLifeYears',
  'نموذج الإهلاك': 'depreciationModel',
  'كود حساب الأصل': 'assetAccountCode',
  'اسم حساب الأصل': 'assetAccountName',
  'كود حساب مجمع الإهلاك': 'accumulatedDepreciationAccountCode',
  'اسم حساب مجمع الإهلاك': 'accumulatedDepreciationAccountName',
  'كود حساب مصروف الإهلاك': 'expenseAccountCode',
  'اسم حساب مصروف الإهلاك': 'expenseAccountName',
  'كود مركز التكلفة': 'costCenterId',
  'نوع مركز التكلفة': 'costCenterType',
  'ملاحظات': 'notes',
};

const COL_EN: Record<string, keyof FixedAssetImportRow> = {
  'Asset Name': 'assetName',
  'Asset Group': 'groupName',
  'Acquisition Date': 'acquisitionDate',
  'Asset Value': 'assetValue',
  'Salvage Value': 'salvageValue',
  'Useful Life (Years)': 'usefulLifeYears',
  'Depreciation Model': 'depreciationModel',
  'Asset Account Code': 'assetAccountCode',
  'Asset Account Name': 'assetAccountName',
  'Accumulated Depr. Account Code': 'accumulatedDepreciationAccountCode',
  'Accumulated Depr. Account Name': 'accumulatedDepreciationAccountName',
  'Expense Account Code': 'expenseAccountCode',
  'Expense Account Name': 'expenseAccountName',
  'Cost Center ID': 'costCenterId',
  'Cost Center Type': 'costCenterType',
  'Notes': 'notes',
};

/** Download an empty Excel template for fixed assets import. */
export function downloadFixedAssetsTemplate(language: 'ar' | 'en' = 'ar'): void {
  const headers = language === 'ar' ? HEADERS_AR : HEADERS_EN;
  const sampleRow =
    language === 'ar'
      ? [
          'سيارة تويوتا هايلاكس',
          'وسائل النقل',
          '2023-01-15',
          250000,
          0,
          5,
          'straight_line',
          '11101001',
          'سيارات نقل',
          '11901001',
          'مجمع إهلاك سيارات النقل',
          '52201001',
          'مصروف إهلاك وسائل النقل',
          '',
          'direct',
          '',
        ]
      : [
          'Toyota Hilux',
          'Vehicles',
          '2023-01-15',
          250000,
          0,
          5,
          'straight_line',
          '11101001',
          'Transport Vehicles',
          '11901001',
          'Accumulated Depr. - Vehicles',
          '52201001',
          'Depreciation Expense - Vehicles',
          '',
          'direct',
          '',
        ];

  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  ws['!cols'] = headers.map(() => ({ wch: 28 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'الأصول الثابتة' : 'Fixed Assets');
  XLSX.writeFile(wb, language === 'ar' ? 'قالب_الأصول_الثابتة.xlsx' : 'fixed_assets_template.xlsx');
}

/** Parse an uploaded Excel file and return rows for import. */
export function parseFixedAssetsImportFile(file: File): Promise<FixedAssetImportRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

        if (!rawRows.length) {
          resolve([]);
          return;
        }

        // Detect language from first header key
        const firstKey = Object.keys(rawRows[0])[0] ?? '';
        const colMap = COL_AR[firstKey] !== undefined ? COL_AR : COL_EN;

        const rows: FixedAssetImportRow[] = rawRows
          .filter((r) => {
            const name = r[firstKey];
            return name != null && String(name).trim() !== '';
          })
          .map((r) => {
            const get = (header: string) => {
              const key = colMap[header] as keyof FixedAssetImportRow | undefined;
              if (!key) return undefined;
              const v = r[header];
              return v != null && String(v).trim() !== '' ? String(v).trim() : undefined;
            };

            const getNum = (header: string) => {
              const v = get(header);
              if (v === undefined) return undefined;
              const n = parseFloat(v);
              return isNaN(n) ? undefined : n;
            };

            const getDate = (header: string) => {
              const v = r[header];
              if (v instanceof Date) return v.toISOString().split('T')[0];
              const s = String(v ?? '').trim();
              if (!s) return undefined;
              // Handle numeric Excel serial
              const n = parseFloat(s);
              if (!isNaN(n) && n > 1000) {
                return new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().split('T')[0];
              }
              return s;
            };

            const nameHeader = HEADERS_AR[0] in colMap ? HEADERS_AR[0] : HEADERS_EN[0];
            const dateHeader = HEADERS_AR[2] in colMap ? HEADERS_AR[2] : HEADERS_EN[2];
            const valueHeader = HEADERS_AR[3] in colMap ? HEADERS_AR[3] : HEADERS_EN[3];

            return {
              assetName: String(r[nameHeader] ?? '').trim(),
              groupName: get(HEADERS_AR[1] in colMap ? HEADERS_AR[1] : HEADERS_EN[1]),
              acquisitionDate: getDate(dateHeader) ?? '',
              assetValue: getNum(valueHeader) ?? 0,
              salvageValue: getNum(HEADERS_AR[4] in colMap ? HEADERS_AR[4] : HEADERS_EN[4]),
              usefulLifeYears: getNum(HEADERS_AR[5] in colMap ? HEADERS_AR[5] : HEADERS_EN[5]),
              depreciationModel: get(HEADERS_AR[6] in colMap ? HEADERS_AR[6] : HEADERS_EN[6]),
              assetAccountCode: get(HEADERS_AR[7] in colMap ? HEADERS_AR[7] : HEADERS_EN[7]),
              assetAccountName: get(HEADERS_AR[8] in colMap ? HEADERS_AR[8] : HEADERS_EN[8]),
              accumulatedDepreciationAccountCode: get(HEADERS_AR[9] in colMap ? HEADERS_AR[9] : HEADERS_EN[9]),
              accumulatedDepreciationAccountName: get(HEADERS_AR[10] in colMap ? HEADERS_AR[10] : HEADERS_EN[10]),
              expenseAccountCode: get(HEADERS_AR[11] in colMap ? HEADERS_AR[11] : HEADERS_EN[11]),
              expenseAccountName: get(HEADERS_AR[12] in colMap ? HEADERS_AR[12] : HEADERS_EN[12]),
              costCenterId: get(HEADERS_AR[13] in colMap ? HEADERS_AR[13] : HEADERS_EN[13]),
              costCenterType: get(HEADERS_AR[14] in colMap ? HEADERS_AR[14] : HEADERS_EN[14]),
              notes: get(HEADERS_AR[15] in colMap ? HEADERS_AR[15] : HEADERS_EN[15]),
            } satisfies FixedAssetImportRow;
          });

        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}

/** Export asset register to Excel. */
export function exportFixedAssetsRegister(
  rows: Array<{
    assetNumber: string;
    assetName: string;
    groupName: string | null;
    acquisitionDate: string;
    assetValue: number;
    accumulatedDepreciation: number;
    netBookValue: number;
    depreciationModel: string;
    status: string;
  }>,
  language: 'ar' | 'en' = 'ar',
): void {
  const headers =
    language === 'ar'
      ? ['رقم الأصل', 'اسم الأصل', 'المجموعة', 'تاريخ الاقتناء', 'قيمة الأصل', 'مجمع الإهلاك', 'القيمة الدفترية', 'نموذج الإهلاك', 'الحالة']
      : ['Asset No.', 'Asset Name', 'Group', 'Acquisition Date', 'Asset Value', 'Accumulated Depr.', 'Book Value', 'Model', 'Status'];

  const data = rows.map((r) => [
    r.assetNumber,
    r.assetName,
    r.groupName ?? '',
    r.acquisitionDate,
    r.assetValue,
    r.accumulatedDepreciation,
    r.netBookValue,
    r.depreciationModel,
    r.status,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'سجل الأصول' : 'Asset Register');
  XLSX.writeFile(wb, language === 'ar' ? 'سجل_الأصول_الثابتة.xlsx' : 'fixed_assets_register.xlsx');
}
