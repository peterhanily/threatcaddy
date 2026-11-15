import * as pako from 'pako';
import type { EvidenceExtractionStatus, EvidenceKind, Note } from '../types';
import { assertEvidenceInput, EVIDENCE_LIMITS, EvidenceImportLimitError } from './evidence-import-limits';

import { EVIDENCE_TAG } from './evidence-import-constants';
export { EVIDENCE_TAG, EVIDENCE_ACCEPT, MAX_EVIDENCE_IMPORT_FILES } from './evidence-import-constants';
export { evidenceFileKeyFromFile, evidenceFileKeyFromItem, evidenceDuplicateGroupKey, findDuplicateEvidenceItemIds } from './evidence-duplicates';

const MAX_NOTE_TEXT_CHARS = 450_000;
const MAX_IMAGE_ANALYSIS_BYTES = 3 * 1024 * 1024;
const VALID_RASTER_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
]);

export interface EvidenceItemDraft {
  title: string;
  content: string;
  fileName: string;
  fileType: EvidenceKind;
  mimeType?: string;
  size: number;
  lastModified?: number;
  imageWidth?: number;
  imageHeight?: number;
  imageAspectRatio?: string;
  imagePixelCount?: number;
  imageData?: string;
  imageDataMimeType?: string;
  tags: string[];
  extractionStatus: EvidenceExtractionStatus;
  extractionWarning?: string;
  importedAt: number;
  chunkIndex: number;
  chunkCount: number;
}

export interface EvidenceNoteDraft {
  title: string;
  content: string;
  sourceTitle: string;
  tags: string[];
}

export interface EvidenceDraftOptions {
  folderName?: string;
  importedAt?: number;
}

/** File bytes read on the main thread. WebKit workers at a file:// origin
 * cannot read a posted File or Blob, so the bytes are transferred instead. */
export interface EvidenceFileSource {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  bytes: Uint8Array;
}

interface ExtractedEvidence {
  text: string;
  kind: EvidenceKind;
  status: EvidenceExtractionStatus;
  warning?: string;
}

interface ImageEvidenceMetadata {
  width?: number;
  height?: number;
  aspectRatio?: string;
  pixelCount?: number;
  data?: string;
  dataMimeType?: string;
  warning?: string;
}

interface DocxEvidence {
  text: string;
  warning?: string;
  truncated?: boolean;
  unreadable?: boolean;
}

export async function buildEvidenceItemDrafts(
  input: File | EvidenceFileSource,
  options: EvidenceDraftOptions = {},
): Promise<EvidenceItemDraft[]> {
  const importedAt = options.importedAt ?? Date.now();
  const file = await readEvidenceSource(input);
  const extracted = await extractEvidenceText(file);
  const imageMetadata = extracted.kind === 'image' ? await extractImageMetadata(file) : undefined;
  const capped = capExtractedText(extracted.text);
  const warning = mergeWarnings(
    extracted.warning,
    imageMetadata?.warning,
    capped.truncated ? `Extracted text exceeded ${formatBytes(MAX_NOTE_TEXT_CHARS)} and was truncated for import/export safety.` : undefined,
  );
  const status: EvidenceExtractionStatus = capped.truncated ? 'partial' : extracted.status;
  const chunks = chunkText(capped.text, MAX_NOTE_TEXT_CHARS);
  const partCount = Math.max(chunks.length, 1);
  const ext = getExtension(file.name);
  const tags = buildEvidenceTags(ext, status);

  if (chunks.length === 0) {
    return [{
      title: file.name,
      fileName: file.name,
      fileType: extracted.kind,
      mimeType: file.type || undefined,
      size: file.size,
      lastModified: file.lastModified || undefined,
      ...imageDraftFields(imageMetadata),
      tags,
      extractionStatus: status,
      extractionWarning: warning,
      importedAt,
      chunkIndex: 1,
      chunkCount: partCount,
      content: renderEvidenceContent({
        file,
        kind: extracted.kind,
        status,
        warning,
        imageMetadata,
        importedAt,
        folderName: options.folderName,
        partIndex: 1,
        partCount,
        text: '',
      }),
    }];
  }

  return chunks.map((text, index) => ({
    title: partCount > 1 ? `${file.name} (${index + 1} of ${partCount})` : file.name,
    fileName: file.name,
    fileType: extracted.kind,
    mimeType: file.type || undefined,
    size: file.size,
    lastModified: file.lastModified || undefined,
    ...imageDraftFields(imageMetadata),
    tags,
    extractionStatus: status,
    extractionWarning: warning,
    importedAt,
    chunkIndex: index + 1,
    chunkCount: partCount,
    content: renderEvidenceContent({
      file,
      kind: extracted.kind,
      status,
      warning,
      imageMetadata,
      importedAt,
      folderName: options.folderName,
      partIndex: index + 1,
      partCount,
      text,
    }),
  }));
}

export async function buildEvidenceNoteDrafts(
  input: File | EvidenceFileSource,
  options: EvidenceDraftOptions = {},
): Promise<EvidenceNoteDraft[]> {
  const importedAt = options.importedAt ?? Date.now();
  const file = await readEvidenceSource(input);
  const extracted = await extractEvidenceText(file);
  const imageMetadata = extracted.kind === 'image' ? await extractImageMetadata(file) : undefined;
  const capped = capExtractedText(extracted.text);
  const status: EvidenceExtractionStatus = capped.truncated ? 'partial' : extracted.status;
  const warning = mergeWarnings(
    extracted.warning,
    imageMetadata?.warning,
    capped.truncated ? `Extracted text exceeded ${formatBytes(MAX_NOTE_TEXT_CHARS)} and was truncated for import/export safety.` : undefined,
  );
  const ext = getExtension(file.name);

  return [{
    title: `Evidence - ${file.name}`,
    sourceTitle: file.name,
    tags: buildEvidenceTags(ext, status),
    content: renderEvidenceContent({
      file,
      kind: extracted.kind,
      status,
      warning,
      imageMetadata,
      importedAt,
      folderName: options.folderName,
      partIndex: 1,
      partCount: 1,
      text: capped.text,
    }),
  }];
}

export function isEvidenceNote(note: Note): boolean {
  const tags = note.tags || [];
  const hasEvidenceFileTags = tags.includes(EVIDENCE_TAG) && tags.includes('source:file');
  const looksLikeImportedEvidence =
    /^Evidence\s*-/i.test(note.title) ||
    /^# Evidence:\s*.+$/m.test(note.content);

  return hasEvidenceFileTags && looksLikeImportedEvidence;
}

export function isLegacyEvidenceNote(note: Note): boolean {
  return isEvidenceNote(note) &&
    Boolean(note.tags?.includes('source:file') || note.tags?.some((tag) => tag.startsWith('extraction:')) || note.title.startsWith('Evidence -'));
}

/** Check the size before reading anything, then read the bytes once. */
async function readEvidenceSource(input: File | EvidenceFileSource): Promise<EvidenceFileSource> {
  assertEvidenceInput(input);
  if (isTransferredSource(input)) {
    assertEvidenceInput({ size: input.bytes.byteLength });
    return input;
  }
  return {
    name: input.name,
    type: input.type,
    size: input.size,
    lastModified: input.lastModified,
    bytes: new Uint8Array(await input.arrayBuffer()),
  };
}

// Blob.bytes() is a method; a transferred source carries the bytes themselves.
function isTransferredSource(input: File | EvidenceFileSource): input is EvidenceFileSource {
  return ArrayBuffer.isView((input as { bytes?: unknown }).bytes);
}

async function extractEvidenceText(file: EvidenceFileSource): Promise<ExtractedEvidence> {
  const kind = detectEvidenceKind(file);

  if (kind === 'text' || kind === 'spreadsheet') {
    const text = decodeUtf8(file.bytes);
    return { text: normalizeExtractedText(text), kind, status: 'extracted' };
  }

  if (kind === 'rtf') {
    const text = extractRtfText(decodeUtf8(file.bytes));
    return text
      ? { text, kind, status: 'extracted' }
      : { text: '', kind, status: 'metadata-only', warning: 'No readable text could be extracted from this RTF file.' };
  }

  if (kind === 'image') {
    return {
      text: '',
      kind,
      status: 'metadata-only',
      warning: 'Image pixels were imported with metadata. OCR and visual description require CaddyAI with a vision-capable provider.',
    };
  }

  const bytes = file.bytes;

  if (kind === 'pdf') {
    const pdf = extractPdfText(bytes);
    const truncated = pdf.truncated ? PDF_TRUNCATED_WARNING : undefined;
    return pdf.text
      ? { text: pdf.text, kind, status: 'partial', warning: mergeWarnings('PDF extraction is best-effort for selectable text objects. Scanned pages, encoded fonts, charts, and images may still require OCR or vision analysis.', truncated) }
      : {
        text: '',
        kind,
        status: 'metadata-only',
        warning: mergeWarnings(pdf.rejected
          ? 'PDF text streams were detected but rejected because they looked encoded or garbled. Use OCR, export selectable text, or analyze page images with a vision-capable CaddyAI provider.'
          : 'No readable PDF text could be extracted. If this PDF is scanned or uses encoded fonts, import an OCR/text copy or analyze page images with a vision-capable CaddyAI provider.', truncated),
      };
  }

  if (kind === 'docx') {
    const docx = extractDocxEvidence(bytes);
    if (docx.unreadable) return { text: '', kind, status: 'metadata-only', warning: unreadableArchiveWarning('DOCX') };
    const truncated = docx.truncated ? archiveTruncatedWarning('DOCX') : undefined;
    return docx.text
      ? { text: docx.text, kind, status: docx.truncated ? 'partial' : 'extracted', warning: mergeWarnings(docx.warning, truncated) }
      : { text: '', kind, status: 'metadata-only', warning: mergeWarnings('No document text could be extracted from this DOCX.', truncated) };
  }

  if (kind === 'xlsx') {
    const workbook = extractXlsxWorkbook(bytes);
    if (workbook.unreadable) return { text: '', kind, status: 'metadata-only', warning: unreadableArchiveWarning('XLSX') };
    const truncated = workbook.truncated ? archiveTruncatedWarning('XLSX') : undefined;
    return workbook.text
      ? { text: workbook.text, kind, status: workbook.truncated ? 'partial' : 'extracted', warning: mergeWarnings(workbook.warning, truncated) }
      : { text: '', kind, status: 'metadata-only', warning: mergeWarnings('No cell text could be extracted from this XLSX.', truncated) };
  }

  if (kind === 'doc' || kind === 'xls') {
    const text = extractLegacyOfficeText(bytes);
    return text
      ? { text, kind, status: 'partial', warning: 'Legacy Office extraction is best-effort. Convert to DOCX or XLSX for cleaner text.' }
      : { text: '', kind, status: 'metadata-only', warning: 'Legacy binary Office text could not be extracted. Convert to DOCX or XLSX for searchable evidence.' };
  }

  const fallback = extractLegacyOfficeText(bytes);
  return fallback
    ? { text: fallback, kind, status: 'partial', warning: 'Unknown file type imported with best-effort text extraction.' }
    : { text: '', kind, status: 'metadata-only', warning: 'Unsupported file type. Only metadata was imported.' };
}

const PDF_TRUNCATED_WARNING = 'PDF extraction stopped at the decoding limit (8 MiB per stream, 32 MiB or 2048 text streams per file); later text was not read.';
/** Twice the note cap: the text kept is then always cut (with its own warning),
 * and the readability check still sees more than the text kept. */
const PDF_TEXT_READ_CHARS = 2 * MAX_NOTE_TEXT_CHARS;

function archiveTruncatedWarning(label: string): string {
  return `Part of this ${label} was not read because it exceeded the decoding limit (8 MiB per part, 32 MiB per file, 250,000 cells per sheet).`;
}

function unreadableArchiveWarning(label: string): string {
  return `This file is not a readable ${label} archive. It may be password-protected, truncated, damaged or use unsupported ZIP64 sizes. Only metadata was imported.`;
}

function renderEvidenceContent({
  file,
  kind,
  status,
  warning,
  imageMetadata,
  importedAt,
  folderName,
  partIndex,
  partCount,
  text,
}: {
  file: EvidenceFileSource;
  kind: EvidenceKind;
  status: EvidenceExtractionStatus;
  warning?: string;
  imageMetadata?: ImageEvidenceMetadata;
  importedAt: number;
  folderName?: string;
  partIndex: number;
  partCount: number;
  text: string;
}): string {
  const metadata = [
    `# Evidence: ${file.name}`,
    '',
    `**Imported:** ${new Date(importedAt).toISOString()}`,
    folderName ? `**Investigation:** ${folderName}` : undefined,
    `**File type:** ${kind.toUpperCase()}`,
    `**Size:** ${formatBytes(file.size)}`,
    file.lastModified ? `**Modified:** ${new Date(file.lastModified).toISOString()}` : undefined,
    `**Extraction:** ${status}`,
    partCount > 1 ? `**Part:** ${partIndex} of ${partCount}` : undefined,
    warning ? `**Note:** ${warning}` : undefined,
  ].filter(Boolean).join('\n');

  const imageBlock = kind === 'image'
    ? `\n\n## Image Metadata\n\n${renderImageMetadata(file, imageMetadata)}`
    : '';

  if (!text.trim()) {
    const emptyText = kind === 'image'
      ? 'No OCR text has been extracted for this image yet.'
      : 'No extracted text is available for this file.';
    return `${metadata}${imageBlock}\n\n## Extracted Text\n\n${emptyText}`;
  }

  return `${metadata}${imageBlock}\n\n## Extracted Text\n\n${text.trim()}`;
}

function detectEvidenceKind(file: EvidenceFileSource): EvidenceKind {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx') || type.includes('wordprocessingml.document')) return 'docx';
  if (name.endsWith('.doc') || type === 'application/msword') return 'doc';
  if (name.endsWith('.rtf') || name.endsWith('.rtfs') || type === 'application/rtf' || type === 'text/rtf') return 'rtf';
  if (name.endsWith('.xlsx') || type.includes('spreadsheetml.sheet')) return 'xlsx';
  if (name.endsWith('.xls') || type === 'application/vnd.ms-excel') return 'xls';
  if (type.startsWith('image/') && type !== 'image/svg+xml') return 'image';
  if (/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name)) return 'image';
  if (name.endsWith('.csv') || name.endsWith('.tsv')) return 'spreadsheet';
  if (
    type.startsWith('text/') ||
    /\.(txt|md|markdown|log|json|xml|yaml|yml)$/i.test(name)
  ) {
    return 'text';
  }

  return 'unknown';
}

function imageDraftFields(metadata?: ImageEvidenceMetadata): Partial<EvidenceItemDraft> {
  if (!metadata) return {};
  return {
    imageWidth: metadata.width,
    imageHeight: metadata.height,
    imageAspectRatio: metadata.aspectRatio,
    imagePixelCount: metadata.pixelCount,
    imageData: metadata.data,
    imageDataMimeType: metadata.dataMimeType,
  };
}

async function extractImageMetadata(file: EvidenceFileSource): Promise<ImageEvidenceMetadata> {
  const dimensions = await readImageDimensions(file);
  const mimeType = rasterImageMimeType(file.type, file.name);
  const pixelCount = dimensions.width && dimensions.height ? dimensions.width * dimensions.height : undefined;
  const aspectRatio = dimensions.width && dimensions.height ? formatAspectRatio(dimensions.width, dimensions.height) : undefined;
  const warnings: string[] = [];
  let data: string | undefined;

  if (pixelCount && pixelCount > EVIDENCE_LIMITS.imagePixels) {
    // Every viewer would decode a stored preview; keep the dimensions only.
    warnings.push(`Image is larger than ${EVIDENCE_LIMITS.imagePixels / 1_000_000} million pixels, so only metadata was stored for import/export safety.`);
  } else if (!pixelCount) {
    // Without a size the pixel bound cannot be checked for later viewers either.
    warnings.push('Image dimensions could not be read from the file header, so only metadata was stored for import/export safety.');
  } else if (file.size <= MAX_IMAGE_ANALYSIS_BYTES) {
    try {
      data = bytesToBase64(file.bytes);
    } catch {
      warnings.push('Image preview payload could not be stored for later vision analysis.');
    }
  } else {
    warnings.push(`Image is larger than ${formatBytes(MAX_IMAGE_ANALYSIS_BYTES)}, so only metadata was stored for import/export safety.`);
  }

  return {
    width: dimensions.width,
    height: dimensions.height,
    aspectRatio,
    pixelCount,
    data,
    dataMimeType: data ? mimeType : undefined,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
}

async function readImageDimensions(file: EvidenceFileSource): Promise<{ width?: number; height?: number }> {
  // Only an image whose header gives a size within the bound is decoded; one
  // without a readable header or with more pixels than the bound never is.
  const header = readImageHeaderDimensions(file.bytes);
  if (!header || header.width * header.height > EVIDENCE_LIMITS.imagePixels) return header ?? {};
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.type }));
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      // WebKit workers on file:// cannot decode a Blob; the header size stands.
    }
  }
  return header;
}

/** Width and height from a PNG, GIF, BMP, WebP, JPEG or AVIF header, without decoding. */
function readImageHeaderDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const u24 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : undefined);
  if (bytes.length >= 24 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') return size(view.getUint32(16), view.getUint32(20));
  if (bytes.length >= 16 && ascii(4, 4) === 'ftyp') {
    const extent = readAvifExtent(bytes, view);
    return extent && size(extent.width, extent.height);
  }
  if (bytes.length >= 10 && ascii(0, 3) === 'GIF') return size(view.getUint16(6, true), view.getUint16(8, true));
  if (bytes.length >= 26 && ascii(0, 2) === 'BM') return size(Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)));
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return size(u24(24) + 1, u24(27) + 1);
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8 ') return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    return undefined;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { offset += 2; continue; }
      // Start-of-frame markers, excluding DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return size(view.getUint16(offset + 7), view.getUint16(offset + 5));
      }
      const length = view.getUint16(offset + 2);
      if (length < 2) return undefined;
      offset += 2 + length;
    }
  }
  return undefined;
}

/** The largest image spatial extent ('ispe' in meta > iprp > ipco) of an AVIF
 * file. Every AVIF image item has one; decoders reject frames that differ. */
function readAvifExtent(bytes: Uint8Array, view: DataView): { width: number; height: number } | undefined {
  const code = (fourcc: string) => Array.from(fourcc).reduce((value, char) => value * 256 + char.charCodeAt(0), 0);
  /** Child boxes of the given type, as [contentStart, end], skipping `header` bytes of each parent. */
  const children = (parents: Array<[number, number]>, wanted: string, header = 0) => parents.flatMap(([start, end]) => {
    const found: Array<[number, number]> = [];
    for (let offset = start + header, type = code(wanted); offset + 8 <= end;) {
      const length = view.getUint32(offset);
      if (length < 8 || offset + length > end) break;
      if (view.getUint32(offset + 4) === type) found.push([offset + 8, offset + length]);
      offset += length;
    }
    return found;
  });
  // ftyp comes first: major brand, minor version, then compatible brands.
  const ftypEnd = Math.min(view.getUint32(0), bytes.length);
  const brands = [code('avif'), code('avis')];
  let avif = false;
  for (let offset = 8; offset + 4 <= ftypEnd && !avif; offset += 4) avif = offset !== 12 && brands.includes(view.getUint32(offset));
  if (!avif) return undefined;
  // meta is a full box: its version and flags come before its children.
  const extents = children(children(children(children([[0, bytes.length]], 'meta'), 'iprp', 4), 'ipco'), 'ispe')
    .filter(([start, end]) => end - start >= 12)
    .map(([start]) => ({ width: view.getUint32(start + 4), height: view.getUint32(start + 8) }));
  return extents.reduce<{ width: number; height: number } | undefined>(
    (largest, extent) => (!largest || extent.width * extent.height > largest.width * largest.height ? extent : largest), undefined);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function imageMimeTypeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.avif')) return 'image/avif';
  return 'image/png';
}

function rasterImageMimeType(value: string | undefined, fileName: string): string {
  const normalized = value?.toLowerCase().trim();
  return normalized && VALID_RASTER_IMAGE_MIME_TYPES.has(normalized)
    ? normalized
    : imageMimeTypeFromName(fileName);
}

function formatAspectRatio(width: number, height: number): string {
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function renderImageMetadata(file: EvidenceFileSource, metadata?: ImageEvidenceMetadata): string {
  return [
    metadata?.width && metadata.height ? `**Dimensions:** ${metadata.width} x ${metadata.height}px` : undefined,
    metadata?.aspectRatio ? `**Aspect ratio:** ${metadata.aspectRatio}` : undefined,
    metadata?.pixelCount ? `**Pixels:** ${metadata.pixelCount.toLocaleString()}` : undefined,
    `**Preview payload:** ${metadata?.data ? `stored (${formatBytes(file.size)})` : 'not stored'}`,
    metadata?.dataMimeType ? `**Image MIME:** ${metadata.dataMimeType}` : undefined,
  ].filter(Boolean).join('\n') || 'No image metadata could be read.';
}

function extractDocxEvidence(bytes: Uint8Array): DocxEvidence {
  try {
    const { entries: files, truncated } = readZip(bytes, name => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name));
    const documentXmlData = files.get('word/document.xml');
    const parts = [
      documentXmlData,
      ...Array.from(files.entries())
        .filter(([name]) => /^word\/(header|footer)\d+\.xml$/.test(name))
        .map(([, data]) => data),
    ].filter((data): data is Uint8Array => !!data);

    const sections = parts.map((part) => extractWordXmlText(decodeUtf8(part))).filter(Boolean);
    const text = normalizeExtractedText(sections.join('\n\n'));
    const warning = buildDocxArtifactWarning(files, documentXmlData);
    return { text, warning, truncated };
  } catch (error) {
    if (error instanceof EvidenceImportLimitError) throw error;
    // Password-protected (OLE), truncated or damaged files keep their metadata.
    return { text: '', unreadable: true };
  }
}

function buildDocxArtifactWarning(files: Map<string, Uint8Array>, documentXmlData?: Uint8Array): string | undefined {
  const documentXml = documentXmlData ? decodeUtf8(documentXmlData) : '';
  const tableCount = countMatches(documentXml, /<w:tbl\b/g);
  const drawingCount = countMatches(documentXml, /<w:drawing\b|<w:pict\b/g);
  const chartCount = Array.from(files.keys()).filter((name) => /^word\/charts\/chart\d+\.xml$/i.test(name)).length;
  const mediaCount = Array.from(files.keys()).filter((name) => /^word\/media\//i.test(name)).length;

  const artifactParts = [
    tableCount > 0 ? formatCount(tableCount, 'embedded table') : undefined,
    chartCount > 0 ? formatCount(chartCount, 'embedded chart') : undefined,
    mediaCount > 0 ? formatCount(mediaCount, 'embedded media object') : undefined,
    drawingCount > 0 && chartCount === 0 && mediaCount === 0 ? formatCount(drawingCount, 'drawing object') : undefined,
  ].filter((part): part is string => Boolean(part));

  if (artifactParts.length === 0) return undefined;
  return `DOCX extraction captures paragraph text. ${joinHumanList(artifactParts)} detected; rendered tables, charts, and images are not decoded into structured preview text.`;
}

function countMatches(text: string, re: RegExp): number {
  return Array.from(text.matchAll(re)).length;
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function joinHumanList(parts: string[]): string {
  if (parts.length <= 2) return parts.join(' and ');
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function extractXlsxWorkbook(bytes: Uint8Array): { text: string; warning?: string; truncated?: boolean; unreadable?: boolean } {
  try {
    const archive = readZip(bytes, name => /^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(name));
    const files = archive.entries;
    let truncated = archive.truncated;
    const shared = parseSharedStrings(files.get('xl/sharedStrings.xml'));
    const sheetNameByPath = parseWorkbookSheets(files.get('xl/workbook.xml'), files.get('xl/_rels/workbook.xml.rels'));
    const chartCount = Array.from(files.keys()).filter((name) => /^xl\/charts\/chart\d+\.xml$/i.test(name)).length;
    const mediaCount = Array.from(files.keys()).filter((name) => /^xl\/media\//i.test(name)).length;
    const sheetEntries = Array.from(files.entries())
      .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    const worksheetBudget = { cells: EVIDENCE_LIMITS.spreadsheetCells as number, characters: EVIDENCE_LIMITS.entryBytes as number };

    const sheets = sheetEntries.map(([name, data], index) => {
      const { rows, truncated: cut } = parseWorksheet(decodeUtf8(data), shared, worksheetBudget);
      if (cut) truncated = true;
      if (rows.length === 0) return '';
      const body = rows.map((row) => row.join('\t')).join('\n');
      return `## ${sheetTitle(sheetNameByPath.get(name) || sheetLabel(name, index), index)}\n\n${body}`;
    }).filter(Boolean);

    const warningParts = [
      `XLSX extraction captures workbook cell text across ${sheetEntries.length} sheet${sheetEntries.length === 1 ? '' : 's'}.`,
      chartCount > 0 ? `${chartCount} embedded chart${chartCount === 1 ? '' : 's'} detected; chart series and rendered graph visuals are not decoded.` : undefined,
      mediaCount > 0 ? `${mediaCount} embedded media object${mediaCount === 1 ? '' : 's'} detected; embedded images are not decoded from workbooks.` : undefined,
    ].filter(Boolean);

    return { text: normalizeExtractedText(sheets.join('\n\n')), warning: warningParts.join(' '), truncated };
  } catch (error) {
    if (error instanceof EvidenceImportLimitError) throw error;
    // Password-protected (OLE), truncated or damaged files keep their metadata.
    return { text: '', unreadable: true };
  }
}

function extractWordXmlText(xml: string): string {
  const normalized = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<w:cr\s*\/>/g, '\n');
  const paragraphs = normalized.split(/<\/w:p>/g)
    .map((paragraph) => extractTaggedText(paragraph, 'w:t').join(''))
    .map((text) => text.trim())
    .filter(Boolean);
  return paragraphs.join('\n');
}

function parseSharedStrings(data?: Uint8Array): string[] {
  if (!data) return [];
  const xml = decodeUtf8(data);
  return matchAll(xml, /<si\b[^>]*>([\s\S]*?)<\/si>/g)
    .map((si) => extractTaggedText(si, 't').join(''))
    .map((text) => text.trim());
}

function parseWorkbookSheets(workbookData?: Uint8Array, relsData?: Uint8Array): Map<string, string> {
  const sheets = new Map<string, string>();
  if (!workbookData) return sheets;

  const relationships = new Map<string, string>();
  if (relsData) {
    const relsXml = decodeUtf8(relsData);
    for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attrs = match[1] || '';
      const id = extractXmlAttribute(attrs, 'Id');
      const target = extractXmlAttribute(attrs, 'Target');
      if (id && target) relationships.set(id, normalizeWorkbookTarget(target));
    }
  }

  const workbookXml = decodeUtf8(workbookData);
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = match[1] || '';
    const name = decodeXmlEntities(extractXmlAttribute(attrs, 'name')).trim();
    const relationshipId = extractXmlAttribute(attrs, 'r:id');
    const target = relationshipId ? relationships.get(relationshipId) : undefined;
    if (name && target) sheets.set(target, name);
  }

  return sheets;
}

/** Complete rows are returned until a cell or character budget runs out; the
 * rest of the workbook is reported as truncated rather than failing the file. */
function parseWorksheet(xml: string, sharedStrings: string[], budget: { cells: number; characters: number }): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let cells = 0;

  // Styled or merged empty cells and rows are self-closing (<c r="A2" s="3"/>);
  // they must not swallow the next element's markup.
  for (const rowXml of matchAll(xml, /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] || '';
      const cellXml = cellMatch[2] || '';
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || '';
      const column = ref ? columnIndexFromRef(ref) : row.length;
      // No spreadsheet producer writes a column past XFD: treat it as hostile.
      if (!Number.isSafeInteger(column) || column < 0 || column >= EVIDENCE_LIMITS.spreadsheetColumns) {
        throw new EvidenceImportLimitError('spreadsheetColumns');
      }
      if (++cells > EVIDENCE_LIMITS.spreadsheetCells) return { rows, truncated: true };
      const value = parseCellValue(attrs, cellXml, sharedStrings);
      if (value.length > budget.characters) return { rows, truncated: true };
      budget.characters -= value.length;
      row[column] = value;
    }
    if (row.some((cell) => cell?.trim())) {
      // Sparse column references and repeated shared strings can amplify output
      // even when XML byte counts and the number of populated cells are small.
      if (row.length > budget.cells || row.length + 1 > budget.characters) return { rows, truncated: true };
      budget.cells -= row.length;
      budget.characters -= row.length + 1;
      rows.push(trimTrailingEmpty(row).map((cell) => cell || ''));
    }
  }

  return { rows, truncated: false };
}

function parseCellValue(attrs: string, cellXml: string, sharedStrings: string[]): string {
  const type = attrs.match(/\bt="([^"]+)"/)?.[1];

  if (type === 'inlineStr') {
    return extractTaggedText(cellXml, 't').join('');
  }

  const value = extractFirstTag(cellXml, 'v');
  if (type === 's') {
    const index = Number(value);
    return Number.isFinite(index) ? sharedStrings[index] || '' : '';
  }

  return value;
}

function extractPdfText(bytes: Uint8Array): { text: string; rejected: boolean; truncated: boolean } {
  const raw = bytesToLatin1(bytes);
  const texts: string[] = [];
  let sawPdfTextObject = false;
  let cursor = 0;
  let streams = 0;
  let truncated = false;
  const budget = { remaining: EVIDENCE_LIMITS.expandedBytes as number };
  // Distinct text, counted as dedupeTextLines will keep it. Past the note cap
  // it is cut anyway (and the cut reported), so reading far beyond the cap only
  // spends the per-document deadline on long reports.
  const seenText = new Set<string>();
  let distinctChars = 0;

  while (cursor < raw.length) {
    const streamIndex = raw.indexOf('stream', cursor);
    if (streamIndex === -1) break;

    let dataStart = streamIndex + 'stream'.length;
    if (raw[dataStart] === '\r' && raw[dataStart + 1] === '\n') dataStart += 2;
    else if (raw[dataStart] === '\n' || raw[dataStart] === '\r') dataStart += 1;

    const endIndex = raw.indexOf('endstream', dataStart);
    if (endIndex === -1) break;

    let dataEnd = endIndex;
    while (dataEnd > dataStart && (raw[dataEnd - 1] === '\n' || raw[dataEnd - 1] === '\r')) {
      dataEnd -= 1;
    }

    const dictionary = pdfStreamDictionary(raw, streamIndex, cursor);
    cursor = endIndex + 'endstream'.length;
    // Images, font programs and metadata cannot hold text operators: skip them
    // without decoding, so screenshots do not use up the budgets below.
    if (!mayHoldPdfText(dictionary)) continue;
    if (streams >= EVIDENCE_LIMITS.entries || budget.remaining <= 0) {
      truncated = true;
      break;
    }
    if (distinctChars > PDF_TEXT_READ_CHARS) break;
    streams += 1;

    const decoded = decodePdfStream(bytes.subarray(dataStart, dataEnd), dictionary, budget);
    if (decoded.truncated) truncated = true;
    if (decoded.text) {
      if (containsPdfTextObject(decoded.text)) sawPdfTextObject = true;
      const textObjects = extractPdfTextObjects(decoded.text);
      if (textObjects.length > 0) {
        texts.push(...textObjects);
      }
      for (const object of textObjects) {
        const key = textLineKey(object);
        if (!key || seenText.has(key)) continue;
        seenText.add(key);
        distinctChars += object.length + 1;
      }
    }
  }

  if (texts.length === 0) {
    if (containsPdfTextObject(raw)) sawPdfTextObject = true;
    const rawTextObjects = extractPdfTextObjects(raw);
    if (rawTextObjects.length > 0) {
      texts.push(...rawTextObjects);
    }
  }

  const normalized = normalizeExtractedText(dedupeTextLines(texts).join('\n'));
  return looksLikeReadableEvidenceText(normalized)
    ? { text: normalized, rejected: false, truncated }
    : { text: '', rejected: sawPdfTextObject || normalized.length > 0, truncated };
}

/** The dictionary of the object that owns the stream keyword at streamIndex:
 * the balanced <<...>> ending just before it. A plain lastIndexOf('<<') would
 * return a nested dictionary such as /DecodeParms. The scan is bounded. */
function pdfStreamDictionary(raw: string, streamIndex: number, floor: number): string {
  let end = streamIndex;
  while (end > floor && /\s/.test(raw[end - 1])) end -= 1;
  if (raw.slice(end - 2, end) !== '>>') return '';
  const start = Math.max(floor, end - 4096);
  let depth = 0;
  for (let i = end - 2; i >= start; i -= 1) {
    if (raw[i] === '>' && raw[i + 1] === '>') { depth += 1; i -= 1; }
    else if (raw[i] === '<' && raw[i + 1] === '<') { depth -= 1; if (depth === 0) return raw.slice(i, end); i -= 1; }
  }
  return '';
}

function mayHoldPdfText(dictionary: string): boolean {
  return !/\/Subtype\s*\/(?:Image|XML|Type1C|CIDFontType0C|OpenType)\b|\/Type\s*\/(?:Metadata|XRef)\b|\/Length[123]\b|\/(?:DCTDecode|DCT|JPXDecode|JBIG2Decode|CCITTFaxDecode|CCF)\b/.test(dictionary);
}

/** Decode at most what is left of the per-part and document budgets. A stream
 * that is longer is cut, and the caller reports the document as partial. */
function decodePdfStream(data: Uint8Array, dictionary: string, budget: ExpansionBudget): { text: string; truncated: boolean } {
  const limit = Math.min(EVIDENCE_LIMITS.entryBytes, budget.remaining);
  if (!/\/FlateDecode\b|\/Fl\b/.test(dictionary)) {
    const kept = data.subarray(0, limit);
    budget.remaining -= kept.byteLength;
    return { text: bytesToLatin1(kept), truncated: kept.byteLength < data.byteLength };
  }

  // PDF Flate streams carry a zlib header; try it first so a failed raw attempt
  // never spends time on output that is thrown away.
  for (const raw of [false, true]) {
    try {
      const inflated = inflateBounded(data, raw, limit);
      budget.remaining -= inflated.data.byteLength;
      return { text: bytesToLatin1(inflated.data), truncated: inflated.truncated };
    } catch {
      // Try the other wrapper; a stream neither can read holds no usable text.
    }
  }
  return { text: '', truncated: false };
}

function extractPdfStrings(text: string): string[] {
  const strings: string[] = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    if (char === '(') {
      const parsed = readPdfLiteralString(text, i);
      if (parsed) {
        const cleaned = cleanPdfString(parsed.value);
        if (looksLikeReadableText(cleaned)) strings.push(cleaned);
        i = parsed.next;
        continue;
      }
    }

    if (char === '<' && text[i + 1] !== '<') {
      const end = text.indexOf('>', i + 1);
      if (end !== -1) {
        const hex = text.slice(i + 1, end).replace(/\s+/g, '');
        if (hex.length >= 4 && /^[0-9a-fA-F]+$/.test(hex)) {
          const cleaned = cleanPdfString(decodePdfHexString(hex));
          if (looksLikeReadableText(cleaned)) strings.push(cleaned);
        }
        i = end + 1;
        continue;
      }
    }

    i += 1;
  }

  return strings;
}

function extractPdfTextObjects(text: string): string[] {
  const objects: string[] = [];
  let searchStart = 0;

  while (searchStart < text.length) {
    const begin = findPdfOperator(text, 'BT', searchStart);
    if (begin < 0) break;

    const contentStart = begin + 2;
    const end = findPdfOperator(text, 'ET', contentStart);
    if (end < 0) break;

    const block = text.slice(contentStart, end);
    const blockStrings = extractPdfStrings(block);
    if (blockStrings.length > 0) {
      objects.push(blockStrings.join('\n'));
    }
    searchStart = end + 2;
  }

  return objects;
}

function containsPdfTextObject(text: string): boolean {
  const begin = findPdfOperator(text, 'BT', 0);
  return begin >= 0 && findPdfOperator(text, 'ET', begin + 2) >= 0;
}

function findPdfOperator(text: string, operator: string, start: number): number {
  let index = text.indexOf(operator, start);
  while (index !== -1) {
    const before = index === 0 ? ' ' : text[index - 1];
    const after = text[index + operator.length] || ' ';
    if (isPdfTokenBoundary(before) && isPdfTokenBoundary(after)) return index;
    index = text.indexOf(operator, index + operator.length);
  }
  return -1;
}

function isPdfTokenBoundary(value: string): boolean {
  return /\s|[()[\]<>{}/%]/.test(value);
}

function readPdfLiteralString(text: string, start: number): { value: string; next: number } | null {
  let depth = 0;
  let value = '';

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (i === start) {
      depth = 1;
      continue;
    }

    if (char === '\\') {
      const next = text[i + 1];
      if (next === undefined) return null;
      value += decodePdfEscape(next, text.slice(i + 1, i + 4));
      if (/^[0-7]{3}$/.test(text.slice(i + 1, i + 4))) i += 3;
      else i += 1;
      continue;
    }

    if (char === '(') {
      depth += 1;
      value += char;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      if (depth === 0) return { value, next: i + 1 };
      value += char;
      continue;
    }

    value += char;
  }

  return null;
}

function decodePdfEscape(next: string, octalCandidate: string): string {
  if (/^[0-7]{3}$/.test(octalCandidate)) {
    return String.fromCharCode(Number.parseInt(octalCandidate, 8));
  }

  switch (next) {
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case 'b': return '\b';
    case 'f': return '\f';
    case '(':
    case ')':
    case '\\':
      return next;
    default:
      return next;
  }
}

function decodePdfHexString(hex: string): string {
  const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    bytes[i / 2] = Number.parseInt(padded.slice(i, i + 2), 16);
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.subarray(2));
  }

  return bytesToLatin1(bytes);
}

function extractLegacyOfficeText(bytes: Uint8Array): string {
  const raw = bytesToLatin1(bytes);
  const cleaned = raw
    .replace(/[^\t\n\r -~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned.match(/[A-Za-z0-9][A-Za-z0-9._:/@-]{2,}/g) || [];
  if (tokens.length < 20) return '';
  return normalizeExtractedText(cleaned);
}

function extractRtfText(rtf: string): string {
  let text = '';
  let index = 0;
  let skipGroupDepth = 0;
  const stack: Array<{ ignorable: boolean }> = [];

  while (index < rtf.length) {
    const char = rtf[index];

    if (char === '{') {
      stack.push({ ignorable: false });
      index += 1;
      continue;
    }

    if (char === '}') {
      stack.pop();
      if (skipGroupDepth > stack.length) skipGroupDepth = 0;
      index += 1;
      continue;
    }

    if (char === '\\') {
      const next = rtf[index + 1];

      if (next === "'") {
        const hex = rtf.slice(index + 2, index + 4);
        if (!isSkippingRtfGroup(stack, skipGroupDepth) && /^[0-9a-fA-F]{2}$/.test(hex)) {
          text += String.fromCharCode(Number.parseInt(hex, 16));
        }
        index += 4;
        continue;
      }

      if (next === '*' && stack.length > 0) {
        stack[stack.length - 1].ignorable = true;
        index += 2;
        continue;
      }

      if (next === '\\' || next === '{' || next === '}') {
        if (!isSkippingRtfGroup(stack, skipGroupDepth)) text += next;
        index += 2;
        continue;
      }

      const match = rtf.slice(index + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (match) {
        const word = match[1];
        const arg = match[2];

        if (IGNORABLE_RTF_DESTINATIONS.has(word)) {
          skipGroupDepth = stack.length;
        } else if (!isSkippingRtfGroup(stack, skipGroupDepth)) {
          if (word === 'par' || word === 'line') text += '\n';
          else if (word === 'tab') text += '\t';
          else if (word === 'emdash' || word === 'endash') text += '-';
          else if (word === 'bullet') text += '- ';
          else if (word === 'u' && arg) text += decodeRtfUnicode(Number(arg));
        }

        index += 1 + match[0].length;
        continue;
      }

      index += 2;
      continue;
    }

    if (!isSkippingRtfGroup(stack, skipGroupDepth)) text += char;
    index += 1;
  }

  return normalizeExtractedText(decodeXmlEntities(text));
}

const IGNORABLE_RTF_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'datastore',
  'themedata',
  'generator',
]);

function isSkippingRtfGroup(stack: Array<{ ignorable: boolean }>, skipGroupDepth: number): boolean {
  return skipGroupDepth > 0 || stack.some((group) => group.ignorable);
}

function decodeRtfUnicode(value: number): string {
  const code = value < 0 ? value + 65_536 : value;
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

interface ExpansionBudget { remaining: number }

const STOP_INFLATE = Symbol('stop inflate');

/** Never use one-shot inflate for untrusted evidence: the note-length cap runs
 * later. Output past `limit` is never produced: onData aborts the inflater and
 * reports a cut, and the caller decides whether a cut part is acceptable. */
function inflateBounded(data: Uint8Array, raw: boolean, limit: number): { data: Uint8Array; truncated: boolean } {
  const inflator = new pako.Inflate({ raw, chunkSize: 64 * 1024 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  inflator.onData = chunk => {
    const room = limit - total;
    if (chunk.byteLength > room) {
      if (room > 0) { chunks.push(chunk.subarray(0, room)); total += room; }
      truncated = true;
      throw STOP_INFLATE;
    }
    total += chunk.byteLength;
    chunks.push(chunk);
  };
  try {
    inflator.push(data, true);
  } catch (error) {
    if (error !== STOP_INFLATE) throw error;
  }
  if (!truncated && (inflator.err || !inflator.ended)) throw new Error('Invalid compressed evidence stream');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return { data: output, truncated };
}

interface ZipPart { name: string; method: number; compressedSize: number; expandedSize: number; localOffset: number }

/** Structural problems throw a plain Error (the caller imports metadata only).
 * EvidenceImportLimitError is kept for bomb shapes: too many entries,
 * overlapping data, and parts whose output does not match their declared size. */
function readZip(bytes: Uint8Array, include: (name: string) => boolean): { entries: Map<string, Uint8Array>; truncated: boolean } {
  const entries = new Map<string, Uint8Array>();
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new Error('ZIP end of central directory not found');

  const entryCount = u16(bytes, eocd + 10);
  const centralDirOffset = u32(bytes, eocd + 16);
  const centralDirEnd = centralDirOffset + u32(bytes, eocd + 12);
  if (entryCount > EVIDENCE_LIMITS.entries) throw new EvidenceImportLimitError('archiveEntries');
  // Bytes after the end record (appended by some download and signing tools) are ignored.
  if (u16(bytes, eocd + 4) || u16(bytes, eocd + 6) || u16(bytes, eocd + 8) !== entryCount
    || centralDirEnd > eocd || eocd + 22 + u16(bytes, eocd + 20) > bytes.byteLength) {
    throw new Error('Unsupported or invalid ZIP directory');
  }
  let offset = centralDirOffset;
  let compressedTotal = 0;
  const selected: ZipPart[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirEnd || u32(bytes, offset) !== 0x02014b50) throw new Error('Invalid ZIP directory entry');

    const method = u16(bytes, offset + 10);
    const compressedSize = u32(bytes, offset + 20);
    const expandedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > centralDirEnd || nameLength > 1024) throw new Error('Invalid ZIP entry name');
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');
    if (!name || name.includes('\0') || name.startsWith('/') || name.split('/').includes('..') || entries.has(name)) {
      throw new Error('Invalid or duplicate ZIP entry name');
    }
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP64 archives are not supported');
    }
    compressedTotal += compressedSize;
    if (compressedTotal > EVIDENCE_LIMITS.inputBytes) throw new EvidenceImportLimitError('archiveCompressedBytes');
    // Keep names for the existing chart/media warnings, without decoding data
    // that the document text extractor will never use.
    entries.set(name, new Uint8Array());
    if (include(name)) {
      if (u16(bytes, offset + 8) & 1) throw new Error('Encrypted document parts are not supported');
      selected.push({ name, method, compressedSize, expandedSize, localOffset });
    }
    offset = next;
  }
  if (offset !== centralDirEnd) throw new Error('Invalid ZIP directory size');

  // Small parts (workbook, shared strings, headers) first, so large sheets
  // cannot use up the document budget before the parts every sheet needs.
  selected.sort((a, b) => a.expandedSize - b.expandedSize);
  const budget = { remaining: EVIDENCE_LIMITS.expandedBytes as number };
  let truncated = false;
  for (const part of selected) {
    const entry = readZipLocalEntry(bytes, part, centralDirOffset, budget);
    if (entry.truncated) truncated = true;
    entries.set(part.name, entry.data);
  }
  return { entries, truncated };
}

function readZipLocalEntry(bytes: Uint8Array, part: ZipPart, dataEnd: number, budget: ExpansionBudget): { data: Uint8Array; truncated: boolean } {
  const { name, method, compressedSize, expandedSize, localOffset } = part;
  if (localOffset + 30 > dataEnd || u32(bytes, localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local header');
  const nameLength = u16(bytes, localOffset + 26);
  const extraLength = u16(bytes, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  if (dataStart + compressedSize > dataEnd || u16(bytes, localOffset + 8) !== method
    || (u16(bytes, localOffset + 6) & 1)
    || decodeUtf8(bytes.subarray(localOffset + 30, localOffset + 30 + nameLength)).replace(/\\/g, '/') !== name) {
    throw new Error('Invalid ZIP local header');
  }
  if (method !== 0 && method !== 8) throw new Error('Unsupported ZIP compression method');
  const limit = Math.min(EVIDENCE_LIMITS.entryBytes, budget.remaining);
  if (limit <= 0) return { data: new Uint8Array(), truncated: true };
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
  const decoded = method === 0
    ? { data: compressed.subarray(0, limit), truncated: compressed.byteLength > limit }
    : inflateBounded(compressed, true, limit);
  budget.remaining -= decoded.data.byteLength;

  // A part declared larger than the budget is cut on purpose. Any other
  // difference from the declared size is a lying header: reject the file.
  if (decoded.truncated && expandedSize > limit) return decoded;
  if (decoded.truncated || decoded.data.byteLength !== expandedSize) {
    throw new EvidenceImportLimitError('archiveSizeMismatch');
  }
  return decoded;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (u32(bytes, i) === 0x06054b50) return i;
  }
  return -1;
}

function extractTaggedText(xml: string, tag: string): string[] {
  const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${safeTag}\\b[^>]*>([\\s\\S]*?)<\\/${safeTag}>`, 'g');
  return matchAll(xml, re).map((value) => decodeXmlEntities(stripXmlTags(value)));
}

function extractFirstTag(xml: string, tag: string): string {
  return extractTaggedText(xml, tag)[0] || '';
}

function stripXmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_match, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const raw = isHex ? entity.slice(2) : entity.slice(1);
      return String.fromCodePoint(Number.parseInt(raw, isHex ? 16 : 10));
    }
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
    };
    return named[entity] || '';
  });
}

function extractXmlAttribute(attrs: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return attrs.match(new RegExp(`\\b${escaped}="([^"]*)"`))?.[1] || '';
}

function normalizeWorkbookTarget(target: string): string {
  const withoutLeadingSlash = target.replace(/^\/+/, '');
  if (withoutLeadingSlash.startsWith('xl/')) return withoutLeadingSlash.replace(/\\/g, '/');
  return `xl/${withoutLeadingSlash}`.replace(/\\/g, '/');
}

function matchAll(text: string, re: RegExp): string[] {
  return Array.from(text.matchAll(re), (match) => match[1] || '');
}

function columnIndexFromRef(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] || '').toUpperCase();
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

function sheetLabel(path: string, index: number): string {
  const name = path.split('/').pop()?.replace(/\.xml$/i, '') || `sheet${index + 1}`;
  return `Sheet ${name.replace(/^sheet/i, '') || index + 1}`;
}

function sheetTitle(title: string, index: number): string {
  return title.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '') || `Sheet ${index + 1}`;
}

function trimTrailingEmpty(row: string[]): string[] {
  let end = row.length;
  while (end > 0 && !row[end - 1]) end -= 1;
  return row.slice(0, end);
}

function chunkText(text: string, maxChars: number): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let current = '';
  for (const paragraph of normalized.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);
    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    for (let i = 0; i < paragraph.length; i += maxChars) {
      chunks.push(paragraph.slice(i, i + maxChars));
    }
    current = '';
  }

  if (current) chunks.push(current);
  return chunks;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Start only at the beginning of a run: retrying inside a long run is quadratic.
    .replace(/(?<![ \t])[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]{3,}/g, '  ')
    .trim();
}

function cleanPdfString(value: string): string {
  return Array.from(value)
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code === 0) return '';
      if ((code >= 1 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) return ' ';
      return char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeReadableText(value: string): boolean {
  if (value.length < 2) return false;
  const chars = Array.from(value);
  const readable = chars.filter(isReadableTextChar).length;
  const letters = value.match(/[\p{L}\p{N}]/gu)?.length || 0;
  return readable / chars.length > 0.82 && letters / chars.length > 0.2;
}

function looksLikeReadableEvidenceText(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  const chars = Array.from(normalized);
  const readable = chars.filter(isReadableTextChar).length;
  if (readable / chars.length < 0.9) return false;

  const nonWhitespace = chars.filter((char) => /\S/.test(char));
  if (longestRepeatedRun(nonWhitespace) >= 24) return false;
  if (dominantCharacterRatio(nonWhitespace) > 0.32 && nonWhitespace.length > 120) return false;
  if (chars.length > 80 && /[\u00fe\u00ff]/.test(normalized)) return false;

  const words = normalized.toLowerCase().match(/[a-z][a-z'-]{1,}/g) || [];
  const iocLike = normalized.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|https?:\/\/|[a-z0-9.-]+\.[a-z]{2,}\b|\b[a-f0-9]{32,64}\b/gi)?.length || 0;

  const nonAscii = chars.filter((char) => char.charCodeAt(0) > 127).length;
  if (chars.length > 120 && nonAscii / chars.length > 0.2 && words.length < 35 && iocLike < 3) return false;

  if (chars.length > 120 && words.length < 8 && iocLike < 3) return false;

  const stopwordHits = words.filter((word) => COMMON_TEXT_WORDS.has(word)).length;
  const longWords = words.filter((word) => word.length >= 4).length;
  if (chars.length > 300 && stopwordHits < 3 && longWords < 20 && iocLike < 3) return false;

  const averageWordLength = words.length > 0
    ? words.reduce((sum, word) => sum + word.length, 0) / words.length
    : 0;
  if (words.length >= 20 && averageWordLength > 14) return false;

  return true;
}

function longestRepeatedRun(chars: string[]): number {
  let longest = 0;
  let current = 0;
  let previous = '';

  for (const char of chars) {
    if (char === previous) {
      current += 1;
    } else {
      previous = char;
      current = 1;
    }
    longest = Math.max(longest, current);
  }

  return longest;
}

function dominantCharacterRatio(chars: string[]): number {
  if (chars.length === 0) return 0;
  const counts = new Map<string, number>();
  let highest = 0;

  for (const char of chars) {
    const next = (counts.get(char) || 0) + 1;
    counts.set(char, next);
    highest = Math.max(highest, next);
  }

  return highest / chars.length;
}

function isReadableTextChar(value: string): boolean {
  return /[\p{L}\p{N}\s.,;:!?()[\]{}'"@/#%&*+=_|<>$€£¥\\/\-–—]/u.test(value);
}

const COMMON_TEXT_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'with',
]);

function capExtractedText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_NOTE_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_NOTE_TEXT_CHARS), truncated: true };
}

function mergeWarnings(...warnings: Array<string | undefined>): string | undefined {
  const merged = warnings.filter((warning): warning is string => Boolean(warning));
  return merged.length > 0 ? merged.join(' ') : undefined;
}

function buildEvidenceTags(ext: string | undefined, status: EvidenceExtractionStatus): string[] {
  return unique([
    EVIDENCE_TAG,
    'source:file',
    ext ? `file:${ext}` : undefined,
    `extraction:${status}`,
  ]);
}

function dedupeTextLines(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = textLineKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function textLineKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function getExtension(name: string): string | undefined {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1];
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  return text;
}

function bytesToLatin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return text;
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
