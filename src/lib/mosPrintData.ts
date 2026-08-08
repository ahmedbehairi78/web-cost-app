import type { MosCertificate } from '../types';

export type MosPrintLine = {
  description: string;
  unit?: string;
  itemCode?: string;
  suppliedQtyThisPeriod: number;
  onSitePercentage: number;
  equivalentQty: number;
  equivalentCumulative: number;
  unitPrice: number;
  claimedAmount: number;
};

export type MosPrintData = {
  certificateNo: string;
  extractDate: string;
  phaseLabel: string;
  statusLabel: string;
  deliveryNoteRef?: string;
  notes?: string;
  projectName?: string;
  contractName?: string;
  totalClaimed: number;
  lines: MosPrintLine[];
};

export function mosPrintTitle(data: MosPrintData, language: 'ar' | 'en'): string {
  return language === 'ar'
    ? `شهادة تشوين — ${data.certificateNo}`
    : `MOS Certificate — ${data.certificateNo}`;
}

export function buildMosPrintData(input: {
  cert: MosCertificate;
  projectName?: string;
  contractName?: string;
  phaseLabel: string;
  statusLabel: string;
}): MosPrintData {
  const { cert, projectName, contractName, phaseLabel, statusLabel } = input;
  return {
    certificateNo: cert.certificateNo,
    extractDate: cert.extractDate ?? '—',
    phaseLabel,
    statusLabel,
    deliveryNoteRef: cert.deliveryNoteRef ?? undefined,
    notes: cert.notes ?? undefined,
    projectName,
    contractName,
    totalClaimed: cert.totalClaimed,
    lines: (cert.lines ?? []).map((line) => ({
      description: line.boqItemDescription || line.boqItemId,
      unit: line.boqItemUnit ?? undefined,
      itemCode: line.boqItemCode ?? undefined,
      suppliedQtyThisPeriod: line.suppliedQtyThisPeriod,
      onSitePercentage: line.onSitePercentage,
      equivalentQty: line.equivalentQty,
      equivalentCumulative: line.equivalentCumulative,
      unitPrice: line.unitPrice,
      claimedAmount: line.claimedAmount,
    })),
  };
}
