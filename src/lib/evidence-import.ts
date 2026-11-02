import * as pako from 'pako';
import type { EvidenceExtractionStatus, EvidenceKind, EvidenceItem, Note } from '../types';

export const EVIDENCE_TAG = 'evidence';
export const MAX_EVIDENCE_IMPORT_FILES = 20;
export const EVIDENCE_ACCEPT = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.tsv',
  '.txt',
  '.rtf',
  '.rtfs',
  '.md',
  '.markdown',
  '.json',
  '.log',
  '.xml',
  '.yaml',
  '.yml',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
].join(',');

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

interface EvidenceDraftOptions {
  folderName?: string;
  importedAt?: number;
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
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function evidenceFileKeyFromFile(file: File): string {
  return evidenceFileIdentityKey({
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified || undefined,
  });
}

export function evidenceFileKeyFromItem(item: Pick<EvidenceItem, 'folderId' | 'fileName' | 'size' | 'lastModified'>): string {
  return `${item.folderId || ''}|${evidenceFileIdentityKey(item)}`;
}

export function evidenceDuplicateGroupKey(item: EvidenceItem): string {
  return [
    evidenceFileKeyFromItem(item),
    item.chunkIndex || 1,
    item.chunkCount || 1,
    hashString(item.content || ''),
  ].join('|');
}

export function findDuplicateEvidenceItemIds(items: EvidenceItem[], folderId?: string): string[] {
  const activeItems = items
    .filter((item) => !item.trashed && !item.archived)
    .filter((item) => !folderId || item.folderId === folderId);

  const groups = new Map<string, EvidenceItem[]>();
  for (const item of activeItems) {
    const key = evidenceDuplicateGroupKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  const duplicateIds: string[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(compareEvidenceKeepPriority);
    duplicateIds.push(...sorted.slice(1).map((item) => item.id));
  }
  return duplicateIds;
}

export async function buildEvidenceItemDrafts(
  file: File,
  options: EvidenceDraftOptions = {},
): Promise<EvidenceItemDraft[]> {
  const importedAt = options.importedAt ?? Date.now();
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
  file: File,
  options: EvidenceDraftOptions = {},
): Promise<EvidenceNoteDraft[]> {
  const importedAt = options.importedAt ?? Date.now();
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

async function extractEvidenceText(file: File): Promise<ExtractedEvidence> {
  const kind = detectEvidenceKind(file);

  if (kind === 'text' || kind === 'spreadsheet') {
    const text = await file.text();
    return { text: normalizeExtractedText(text), kind, status: 'extracted' };
  }

  if (kind === 'rtf') {
    const text = extractRtfText(await file.text());
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

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (kind === 'pdf') {
    const pdf = extractPdfText(bytes);
    return pdf.text
      ? { text: pdf.text, kind, status: 'partial', warning: 'PDF extraction is best-effort for selectable text objects. Scanned pages, encoded fonts, charts, and images may still require OCR or vision analysis.' }
      : {
        text: '',
        kind,
        status: 'metadata-only',
        warning: pdf.rejected
          ? 'PDF text streams were detected but rejected because they looked encoded or garbled. Use OCR, export selectable text, or analyze page images with a vision-capable CaddyAI provider.'
          : 'No readable PDF text could be extracted. If this PDF is scanned or uses encoded fonts, import an OCR/text copy or analyze page images with a vision-capable CaddyAI provider.',
      };
  }

  if (kind === 'docx') {
    const docx = extractDocxEvidence(bytes);
    return docx.text
      ? { text: docx.text, kind, status: 'extracted', warning: docx.warning }
      : { text: '', kind, status: 'metadata-only', warning: 'No document text could be extracted from this DOCX.' };
  }

  if (kind === 'xlsx') {
    const workbook = extractXlsxWorkbook(bytes);
    return workbook.text
      ? { text: workbook.text, kind, status: 'extracted', warning: workbook.warning }
      : { text: '', kind, status: 'metadata-only', warning: 'No cell text could be extracted from this XLSX.' };
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
  file: File;
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

function evidenceFileIdentityKey(item: Pick<EvidenceItem, 'fileName' | 'size' | 'lastModified'>): string {
  return [
    item.fileName.trim().toLowerCase(),
    item.size,
    item.lastModified || 0,
  ].join('|');
}

function compareEvidenceKeepPriority(a: EvidenceItem, b: EvidenceItem): number {
  const richnessA = evidenceRichnessScore(a);
  const richnessB = evidenceRichnessScore(b);
  if (richnessA !== richnessB) return richnessB - richnessA;
  if (a.importedAt !== b.importedAt) return a.importedAt - b.importedAt;
  return a.createdAt - b.createdAt;
}

function evidenceRichnessScore(item: EvidenceItem): number {
  return [
    (item.linkedIOCIds?.length || 0) * 100,
    item.imageAnalysis?.trim() ? 40 : 0,
    item.imageOcrText?.trim() ? 35 : 0,
    item.imageData ? 30 : 0,
    item.extractionWarning?.trim() ? 5 : 0,
    item.clsLevel?.trim() ? 3 : 0,
    item.tags.length,
  ].reduce((total, score) => total + score, 0);
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function detectEvidenceKind(file: File): EvidenceKind {
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

async function extractImageMetadata(file: File): Promise<ImageEvidenceMetadata> {
  const dimensions = await readImageDimensions(file);
  const mimeType = rasterImageMimeType(file.type, file.name);
  const pixelCount = dimensions.width && dimensions.height ? dimensions.width * dimensions.height : undefined;
  const aspectRatio = dimensions.width && dimensions.height ? formatAspectRatio(dimensions.width, dimensions.height) : undefined;
  const warnings: string[] = [];
  let data: string | undefined;

  if (file.size <= MAX_IMAGE_ANALYSIS_BYTES) {
    try {
      data = await readFileAsBase64(file);
    } catch {
      warnings.push('Image preview payload could not be stored for later vision analysis.');
    }
  } else {
    warnings.push(`Image is larger than ${formatBytes(MAX_IMAGE_ANALYSIS_BYTES)}, so only metadata was stored for import/export safety.`);
  }

  if (!dimensions.width || !dimensions.height) {
    warnings.push('Image dimensions could not be read by the browser.');
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

async function readImageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      // Fall back to the HTMLImageElement path below.
    }
  }

  if (typeof Image === 'undefined' || typeof URL === 'undefined') return {};

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({});
    };
    image.src = url;
  });
}

async function readFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return bytesToBase64(bytes);
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

function renderImageMetadata(file: File, metadata?: ImageEvidenceMetadata): string {
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
    const files = readZip(bytes);
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
    return { text, warning };
  } catch {
    return { text: '' };
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

function extractXlsxWorkbook(bytes: Uint8Array): { text: string; warning: string } {
  try {
    const files = readZip(bytes);
    const shared = parseSharedStrings(files.get('xl/sharedStrings.xml'));
    const sheetNameByPath = parseWorkbookSheets(files.get('xl/workbook.xml'), files.get('xl/_rels/workbook.xml.rels'));
    const chartCount = Array.from(files.keys()).filter((name) => /^xl\/charts\/chart\d+\.xml$/i.test(name)).length;
    const mediaCount = Array.from(files.keys()).filter((name) => /^xl\/media\//i.test(name)).length;
    const sheetEntries = Array.from(files.entries())
      .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    const sheets = sheetEntries.map(([name, data], index) => {
      const rows = parseWorksheet(decodeUtf8(data), shared);
      if (rows.length === 0) return '';
      const body = rows.map((row) => row.join('\t')).join('\n');
      return `## ${sheetTitle(sheetNameByPath.get(name) || sheetLabel(name, index), index)}\n\n${body}`;
    }).filter(Boolean);

    const warningParts = [
      `XLSX extraction captures workbook cell text across ${sheetEntries.length} sheet${sheetEntries.length === 1 ? '' : 's'}.`,
      chartCount > 0 ? `${chartCount} embedded chart${chartCount === 1 ? '' : 's'} detected; chart series and rendered graph visuals are not decoded.` : undefined,
      mediaCount > 0 ? `${mediaCount} embedded media object${mediaCount === 1 ? '' : 's'} detected; embedded images are not decoded from workbooks.` : undefined,
    ].filter(Boolean);

    return { text: normalizeExtractedText(sheets.join('\n\n')), warning: warningParts.join(' ') };
  } catch {
    return { text: '', warning: 'XLSX extraction failed.' };
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

function parseWorksheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];

  for (const rowXml of matchAll(xml, /<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] || '';
      const cellXml = cellMatch[2] || '';
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || '';
      const column = ref ? columnIndexFromRef(ref) : row.length;
      row[column] = parseCellValue(attrs, cellXml, sharedStrings);
    }
    if (row.some((cell) => cell?.trim())) {
      rows.push(trimTrailingEmpty(row).map((cell) => cell || ''));
    }
  }

  return rows;
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

function extractPdfText(bytes: Uint8Array): { text: string; rejected: boolean } {
  const raw = bytesToLatin1(bytes);
  const texts: string[] = [];
  let sawPdfTextObject = false;
  let cursor = 0;

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

    const dictionaryStart = raw.lastIndexOf('<<', streamIndex);
    const dictionary = dictionaryStart >= 0 ? raw.slice(dictionaryStart, streamIndex) : '';
    const streamBytes = bytes.subarray(dataStart, dataEnd);
    const decoded = decodePdfStream(streamBytes, dictionary);
    if (decoded) {
      if (containsPdfTextObject(decoded)) sawPdfTextObject = true;
      const textObjects = extractPdfTextObjects(decoded);
      if (textObjects.length > 0) {
        texts.push(...textObjects);
      }
    }

    cursor = endIndex + 'endstream'.length;
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
    ? { text: normalized, rejected: false }
    : { text: '', rejected: sawPdfTextObject || normalized.length > 0 };
}

function decodePdfStream(data: Uint8Array, dictionary: string): string {
  const isFlate = /\/FlateDecode\b|\/Fl\b/.test(dictionary);
  if (!isFlate) return bytesToLatin1(data);

  try {
    return bytesToLatin1(pako.inflateRaw(data) as Uint8Array);
  } catch {
    try {
      return bytesToLatin1(pako.inflate(data) as Uint8Array);
    } catch {
      return '';
    }
  }
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

function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new Error('ZIP end of central directory not found');

  const entryCount = u16(bytes, eocd + 10);
  const centralDirOffset = u32(bytes, eocd + 16);
  let offset = centralDirOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (u32(bytes, offset) !== 0x02014b50) break;

    const method = u16(bytes, offset + 10);
    const compressedSize = u32(bytes, offset + 20);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');

    const entry = readZipLocalEntry(bytes, localOffset, name, method, compressedSize);
    if (entry) entries.set(entry.name, entry.data);

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipLocalEntry(
  bytes: Uint8Array,
  localOffset: number,
  name: string,
  method: number,
  compressedSize: number,
): ZipEntry | null {
  if (u32(bytes, localOffset) !== 0x04034b50) return null;
  const nameLength = u16(bytes, localOffset + 26);
  const extraLength = u16(bytes, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return { name, data: compressed };
  if (method === 8) return { name, data: pako.inflateRaw(compressed) as Uint8Array };
  return null;
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
    .replace(/[ \t]+\n/g, '\n')
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
    const key = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
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
