/** Resource limits apply before reading files and while producing decoded bytes.
 * Output-note truncation is a presentation limit, not a decompression budget. */
export const EVIDENCE_LIMITS = {
  inputBytes: 25 * 1024 * 1024,
  batchBytes: 50 * 1024 * 1024,
  entryBytes: 8 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  entries: 2048,
  spreadsheetColumns: 16_384,
  spreadsheetCells: 250_000,
  imagePixels: 32_000_000,
  documentTimeoutMs: 10_000,
  batchTimeoutMs: 60_000,
} as const;

export class EvidenceImportLimitError extends Error {
  constructor(message: string) {
    super(`Evidence import stopped: ${message}. No files in this batch were imported.`);
    this.name = 'EvidenceImportLimitError';
  }
}

export function assertEvidenceInput(file: Pick<File, 'size'>): void {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > EVIDENCE_LIMITS.inputBytes) {
    throw new EvidenceImportLimitError('each file must be 25 MiB or smaller');
  }
}
