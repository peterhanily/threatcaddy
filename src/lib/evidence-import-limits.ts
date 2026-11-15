import { MAX_EVIDENCE_IMPORT_FILES } from './evidence-import-constants';

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

const MIB = 1024 * 1024;

// Stable codes cross the worker boundary as data and the view translates them
// (evidence:importError.<code>). The English text is a log and test fallback.
const LIMIT_REASONS = {
  inputBytes: `each file must be ${EVIDENCE_LIMITS.inputBytes / MIB} MiB or smaller`,
  batchBytes: `selected files exceed ${EVIDENCE_LIMITS.batchBytes / MIB} MiB`,
  fileCount: `select at most ${MAX_EVIDENCE_IMPORT_FILES} files`,
  archiveEntries: `archive contains more than ${EVIDENCE_LIMITS.entries} entries`,
  archiveCompressedBytes: `archive compressed parts exceed ${EVIDENCE_LIMITS.inputBytes / MIB} MiB`,
  archiveSizeMismatch: 'a compressed part does not match its declared size',
  spreadsheetColumns: 'spreadsheet dimensions exceed the supported limit',
  imagePixels: `image dimensions exceed ${EVIDENCE_LIMITS.imagePixels / 1_000_000} million pixels`,
  documentTimeout: `document parsing exceeded ${EVIDENCE_LIMITS.documentTimeoutMs / 1000} seconds`,
  batchTimeout: `batch parsing exceeded ${EVIDENCE_LIMITS.batchTimeoutMs / 1000} seconds`,
} as const;

const MESSAGES = {
  workerUnavailable: 'Evidence import requires an available Web Worker. No files were imported.',
  workerFailed: 'Evidence worker failed. No files were imported.',
  extractionFailed: 'Evidence extraction failed. No files were imported.',
  sessionChanged: 'The workspace session changed. Unlock the workspace and import the files again.',
  contextChanged: 'The investigation context changed. Select the destination and import the files again.',
  destinationUnavailable: 'The destination investigation is no longer available. Select an active investigation and import again.',
  interrupted: 'The evidence import was interrupted before anything was saved. Import the files again.',
  notReady: 'Investigation data is still loading. Import the files again once it has loaded.',
  screenshareActive: 'Evidence import is unavailable in screenshare mode.',
  investigationArchived: 'This investigation is archived. Restore it to import evidence.',
} as const;

export type EvidenceImportLimitCode = keyof typeof LIMIT_REASONS;
export type EvidenceImportErrorCode = EvidenceImportLimitCode | keyof typeof MESSAGES;
export type EvidenceImportErrorParams = Record<string, number>;

function isLimitCode(code: string): code is EvidenceImportLimitCode {
  return Object.hasOwn(LIMIT_REASONS, code);
}

export function isEvidenceImportErrorCode(code: unknown): code is EvidenceImportErrorCode {
  return typeof code === 'string' && (isLimitCode(code) || Object.hasOwn(MESSAGES, code));
}

/** The values each translated message interpolates; they derive from the limits. */
export function evidenceImportErrorParams(code: EvidenceImportErrorCode): EvidenceImportErrorParams {
  switch (code) {
    case 'inputBytes': case 'archiveCompressedBytes': return { mib: EVIDENCE_LIMITS.inputBytes / MIB };
    case 'batchBytes': return { mib: EVIDENCE_LIMITS.batchBytes / MIB };
    case 'fileCount': return { count: MAX_EVIDENCE_IMPORT_FILES };
    case 'archiveEntries': return { limit: EVIDENCE_LIMITS.entries };
    case 'imagePixels': return { megapixels: EVIDENCE_LIMITS.imagePixels / 1_000_000 };
    case 'documentTimeout': return { seconds: EVIDENCE_LIMITS.documentTimeoutMs / 1000 };
    case 'batchTimeout': return { seconds: EVIDENCE_LIMITS.batchTimeoutMs / 1000 };
    default: return {};
  }
}

export class EvidenceImportError extends Error {
  readonly code: EvidenceImportErrorCode;
  readonly fileName?: string;

  constructor(code: EvidenceImportErrorCode, options: { fileName?: string; message?: string } = {}) {
    super(options.message || (isLimitCode(code)
      ? `Evidence import stopped: ${LIMIT_REASONS[code]}. No files in this batch were imported.`
      : MESSAGES[code]));
    this.name = 'EvidenceImportError';
    this.code = code;
    this.fileName = options.fileName;
  }
}

/** A bomb shape or resource limit; any other parser failure keeps the file's metadata. */
export class EvidenceImportLimitError extends EvidenceImportError {
  constructor(code: EvidenceImportLimitCode, options: { fileName?: string } = {}) {
    super(code, options);
    this.name = 'EvidenceImportLimitError';
  }
}

export function assertEvidenceInput(file: Pick<File, 'size'> & { name?: string }): void {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > EVIDENCE_LIMITS.inputBytes) {
    throw new EvidenceImportLimitError('inputBytes', { fileName: file.name });
  }
}

/** The code and file of an import error, read from its fields because class
 * identity does not survive postMessage or an abort reason. */
export function evidenceImportErrorDetails(error: unknown): { code: EvidenceImportErrorCode; fileName?: string } | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { code, fileName } = error as { code?: unknown; fileName?: unknown };
  if (!isEvidenceImportErrorCode(code)) return undefined;
  return { code, fileName: typeof fileName === 'string' && fileName ? fileName : undefined };
}
