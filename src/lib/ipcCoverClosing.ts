/** Cover-JLL closing block defaults (IN WORDS · prepared/approved · signs · distribution). */

/**
 * Excel `Cover-JLL` row geometry (1-based sheet rows):
 * - 49 IN WORDS · 50 Funds · 51 Prepared/Approved
 * - 52–62 blank signature space (11 rows)
 * - 63 signatory labels
 * - 65–72 acceptance + DISTRIBUTION
 * - 73–75 blank before Contractor (3 rows)
 * - 76 Contractor
 */
export const IPC_COVER_CLOSING_EXCEL = {
  /** Blank rows between Prepared/Approved and the four signature titles. */
  signatureSpaceRows: 11,
  /** Blank rows above the Contractor signature line. */
  contractorSpaceRows: 3,
  /** Approx. printed height of one Excel row on A4 landscape cover. */
  rowHeightMm: 4.2,
} as const;

export type IpcCoverClosingData = {
  amountInWords: string;
  fundsLabel: string;
  preparedByLabel: string;
  preparedBy: string;
  approvedByLabel: string;
  approvedBy: string;
  signatories: string[];
  distributionTitle: string;
  distribution: string[];
  acceptanceText: string;
  contractorLabel: string;
  signatureSpaceRows: number;
  contractorSpaceRows: number;
  rowHeightMm: number;
};

export const IPC_COVER_CLOSING_DEFAULTS = {
  fundsLabel: 'Funds to be Paid to the Contractor .',
  preparedByLabel: 'Prepared By :',
  preparedBy: 'JLL Misr LLC',
  approvedByLabel: 'Approved By :',
  approvedBy: 'Emaar Misr',
  signatories: [
    'JLL Misr LLC',
    'EMAAR Misr Project Manager',
    'EMAAR Misr Cost and Contracts',
    'EMAAR Misr Project Director',
  ],
  distributionTitle: 'DISTRIBUTION',
  distribution: [
    'MD Financial ( Original )',
    'MD Technical',
    'EMAAR MISR PROJECT DIRECTOR FOR TECHNICAL AFFAIRS',
    'JLL Misr LLC',
    'Contractor',
  ],
  acceptanceText:
    'ACCEPTED BY THE CONTRACTOR AS FULL AND FINAL SETTLEMENT OF ALL RELATED AND CONSEQUENTIAL COSTS AND TIME ASSOCIATED WITH THIS PAYMENT CERTIFICATE',
  contractorLabel: 'Contractor',
  ...IPC_COVER_CLOSING_EXCEL,
} as const;

export function buildIpcCoverClosingData(
  amountInWords: string,
  overrides?: Partial<{
    preparedBy: string;
    approvedBy: string;
    signatories: string[];
    distribution: string[];
    signatureSpaceRows: number;
    contractorSpaceRows: number;
    rowHeightMm: number;
  }>,
): IpcCoverClosingData {
  return {
    amountInWords,
    fundsLabel: IPC_COVER_CLOSING_DEFAULTS.fundsLabel,
    preparedByLabel: IPC_COVER_CLOSING_DEFAULTS.preparedByLabel,
    preparedBy: overrides?.preparedBy?.trim() || IPC_COVER_CLOSING_DEFAULTS.preparedBy,
    approvedByLabel: IPC_COVER_CLOSING_DEFAULTS.approvedByLabel,
    approvedBy: overrides?.approvedBy?.trim() || IPC_COVER_CLOSING_DEFAULTS.approvedBy,
    signatories: overrides?.signatories?.length
      ? overrides.signatories
      : [...IPC_COVER_CLOSING_DEFAULTS.signatories],
    distributionTitle: IPC_COVER_CLOSING_DEFAULTS.distributionTitle,
    distribution: overrides?.distribution?.length
      ? overrides.distribution
      : [...IPC_COVER_CLOSING_DEFAULTS.distribution],
    acceptanceText: IPC_COVER_CLOSING_DEFAULTS.acceptanceText,
    contractorLabel: IPC_COVER_CLOSING_DEFAULTS.contractorLabel,
    signatureSpaceRows:
      overrides?.signatureSpaceRows ?? IPC_COVER_CLOSING_EXCEL.signatureSpaceRows,
    contractorSpaceRows:
      overrides?.contractorSpaceRows ?? IPC_COVER_CLOSING_EXCEL.contractorSpaceRows,
    rowHeightMm: overrides?.rowHeightMm ?? IPC_COVER_CLOSING_EXCEL.rowHeightMm,
  };
}
