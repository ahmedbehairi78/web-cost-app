import * as XLSX from 'xlsx';

export type PurchaseRequestExportRow = {
  requestNumber: string;
  materialLabel: string;
  quantity: number | string;
  unit?: string | null;
  neededByDate: string;
  priority: string;
  projectLabel: string;
  contractLabel: string;
  requestedDate: string;
  requestedTime: string;
  status: string;
};

export function exportPurchaseRequestsExcel(
  rows: PurchaseRequestExportRow[],
  language: 'ar' | 'en' = 'ar',
  /** When true, date/time columns are response (status update) timestamps. */
  closedList = false,
): void {
  const isAr = language === 'ar';
  const dateKeyAr = closedList ? 'تاريخ الرد' : 'تاريخ الطلب';
  const timeKeyAr = closedList ? 'وقت الرد' : 'وقت الطلب';
  const dateKeyEn = closedList ? 'Response date' : 'Request date';
  const timeKeyEn = closedList ? 'Response time' : 'Request time';
  const sheetRows = rows.map((r) =>
    isAr
      ? {
          'رقم الطلب': r.requestNumber,
          الصنف: r.materialLabel,
          الكمية: r.quantity,
          الوحدة: r.unit ?? '',
          'موعد الاحتياج': r.neededByDate,
          الأهمية: r.priority,
          المشروع: r.projectLabel,
          العقد: r.contractLabel,
          [dateKeyAr]: r.requestedDate,
          [timeKeyAr]: r.requestedTime,
          الحالة: r.status,
        }
      : {
          'Request No.': r.requestNumber,
          Material: r.materialLabel,
          Qty: r.quantity,
          Unit: r.unit ?? '',
          'Needed by': r.neededByDate,
          Priority: r.priority,
          Project: r.projectLabel,
          Contract: r.contractLabel,
          [dateKeyEn]: r.requestedDate,
          [timeKeyEn]: r.requestedTime,
          Status: r.status,
        },
  );
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isAr ? 'أوامر الشراء' : 'Purchase Requests');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `purchase_requests_${stamp}.xlsx`);
}
