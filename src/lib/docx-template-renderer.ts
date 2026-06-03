import { inflateRaw } from 'pako';
import type { Note, NoteTemplate, ProductBaselineAsset } from '../types';

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const DEFAULT_DOCX_FONT = 'Aptos';
const HEADER_FONT_SIZE = '21'; // 10.5 pt in OOXML half-points.
const BODY_FONT_SIZE = '19'; // 9.5 pt in OOXML half-points.
const FOOTNOTE_TEXT_SIZE = '13'; // 6.5 pt in OOXML half-points.

interface ZipEntry {
  path: string;
  data: Uint8Array;
}

interface MarkdownBlock {
  type: 'heading' | 'paragraph' | 'table' | 'bullet';
  level?: number;
  text?: string;
  rows?: string[][];
}

interface BodyElement {
  type: 'p' | 'tbl' | 'sectPr' | 'other';
  xml: string;
  text: string;
  style?: string;
}

interface ProductContentModel {
  title: string;
  classification: string;
  date: string;
  executiveSummary: string[];
  recentActivity: string[];
  assessment: string[];
  recommendations: string[];
  sources: string[];
  timelineRows?: string[][];
  iocRows?: string[][];
}

export interface DocxTemplateProfile {
  paragraphCount: number;
  tableCount: number;
  tableStyles: string[];
  headerReferenceCount: number;
  footerReferenceCount: number;
  anchors: {
    classification: boolean;
    date: boolean;
    executiveSummary: boolean;
    recentActivity: boolean;
    timeline: boolean;
    digitalIdentifiers: boolean;
    recommendations: boolean;
  };
}

export function hasDocxTemplateAsset(template: NoteTemplate | undefined): boolean {
  return Boolean(getDocxTemplateAsset(template));
}

export function buildTemplateBackedDocxBlob(product: Note, baseline: NoteTemplate | undefined): Blob | null {
  const asset = getDocxTemplateAsset(baseline);
  if (!asset?.data) return null;
  const templateBytes = base64ToBytes(asset.data);
  const docxBytes = buildTemplateBackedDocxBytes(templateBytes, product.content, baseline?.productBaseline?.productType);
  const buffer = new ArrayBuffer(docxBytes.byteLength);
  new Uint8Array(buffer).set(docxBytes);
  return new Blob([buffer], { type: DOCX_MIME_TYPE });
}

export function buildTemplateBackedDocxBytes(
  templateBytes: Uint8Array,
  markdown: string,
  productType?: string,
): Uint8Array {
  const entries = unzip(templateBytes);
  const documentEntry = entries.find((entry) => entry.path === 'word/document.xml');
  if (!documentEntry) throw new Error('Template DOCX is missing word/document.xml.');

  const originalDocumentXml = decodeUtf8(documentEntry.data);
  const hasFootnotesPart = entries.some((entry) => entry.path === 'word/footnotes.xml');
  const intelNoteRender = productType === 'intel-note'
    ? replaceIntelNoteDocumentBody(originalDocumentXml, markdown, hasFootnotesPart)
    : undefined;
  const nextDocumentXml = intelNoteRender?.documentXml || replaceDocumentBody(originalDocumentXml, markdown);
  const nextEntries = entries.map((entry) => entry.path === 'word/document.xml'
    ? { ...entry, data: encodeUtf8(nextDocumentXml) }
    : entry.path === 'word/footnotes.xml' && intelNoteRender?.footnotesXml
      ? { ...entry, data: encodeUtf8(intelNoteRender.footnotesXml) }
    : entry);
  return zipStored(nextEntries);
}

export function extractDocxTemplateProfile(templateBytes: Uint8Array): DocxTemplateProfile {
  const entries = unzip(templateBytes);
  const documentEntry = entries.find((entry) => entry.path === 'word/document.xml');
  if (!documentEntry) throw new Error('Template DOCX is missing word/document.xml.');
  return extractDocxTemplateProfileFromXml(decodeUtf8(documentEntry.data));
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function getDocxTemplateAsset(template: NoteTemplate | undefined): ProductBaselineAsset | undefined {
  return template?.productBaseline?.assets?.find((asset) =>
    asset.role === 'docx-template' &&
    (asset.mimeType === DOCX_MIME_TYPE || asset.name.toLowerCase().endsWith('.docx')) &&
    Boolean(asset.data)
  );
}

function replaceDocumentBody(documentXml: string, markdown: string): string {
  const bodyStart = documentXml.indexOf('<w:body>');
  const bodyEnd = documentXml.indexOf('</w:body>');
  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
    throw new Error('Template DOCX has an unsupported document body structure.');
  }
  const bodyInnerStart = bodyStart + '<w:body>'.length;
  const existingBody = documentXml.slice(bodyInnerStart, bodyEnd);
  const sectPrMatch = existingBody.match(/<w:sectPr[\s\S]*<\/w:sectPr>\s*$/);
  const sectPr = sectPrMatch?.[0] || '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const tablePr = extractTableProperties(existingBody);
  const replacementBody = `${renderMarkdownBlocks(markdown, tablePr)}${sectPr}`;
  return `${documentXml.slice(0, bodyInnerStart)}${replacementBody}${documentXml.slice(bodyEnd)}`;
}

function replaceIntelNoteDocumentBody(
  documentXml: string,
  markdown: string,
  useFootnotes: boolean,
): { documentXml: string; footnotesXml?: string } {
  const bodyStart = documentXml.indexOf('<w:body>');
  const bodyEnd = documentXml.indexOf('</w:body>');
  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
    throw new Error('Template DOCX has an unsupported document body structure.');
  }

  const bodyInnerStart = bodyStart + '<w:body>'.length;
  const existingBody = documentXml.slice(bodyInnerStart, bodyEnd);
  const elements = parseBodyElements(existingBody);
  const model = parseProductContent(markdown);
  const sectPr = elements.find((element) => element.type === 'sectPr')?.xml ||
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

  const classificationTemplate = findParagraph(elements, (element) => /classification:/i.test(element.text)) || firstParagraph(elements);
  const dateTemplate = findParagraph(elements, (element) => /^date:/i.test(element.text)) || classificationTemplate;
  const blankTemplate = findParagraph(elements, (element) => !element.text.trim()) || classificationTemplate;
  const executiveHeading = findParagraph(elements, (element) => isHeadingText(element.text, 'Executive Summary'));
  const recentHeading = findParagraph(elements, (element) => isHeadingText(element.text, 'Recent Activity'));
  const timelineHeading = findParagraph(elements, (element) => /timeline/i.test(element.text));
  const threatActorHeading = findParagraph(elements, (element) => /Threat Actor Attribution|Key Details/i.test(element.text));
  const digitalHeading = findParagraph(elements, (element) => /Digital Identifiers|Relevant Threat Intelligence|Supporting Evidence/i.test(element.text));
  const recommendationHeading = findParagraph(elements, (element) => /Recommendations|Recommended Actions/i.test(element.text));
  const sourceHeadingTemplate = timelineHeading || recentHeading || executiveHeading;
  const bulletTemplate = findParagraph(elements, (element) => /^List/i.test(element.style || ''));

  const timelineTable = findTableAfter(elements, timelineHeading) || firstTable(elements);
  const iocTable = findTableAfter(elements, digitalHeading) || findTableWithHeader(elements, /IOC|Type|Value|Description/i) || firstTable(elements);
  const timelineCaption = findParagraph(elements, (element) => /Table\s+\d+:\s*Timeline/i.test(element.text));
  const iocCaption = findParagraph(elements, (element) => /Table\s+\d+:.*(Digital|Identifier|Evidence|IOC)/i.test(element.text));
  const tablePr = extractTableProperties(existingBody);
  const sourceFootnoteIds = useFootnotes ? model.sources.map((_source, index) => index + 1) : [];

  const next: string[] = [];
  if (classificationTemplate) next.push(replaceParagraphText(classificationTemplate.xml, model.classification ? `Classification: ${model.classification}` : 'Classification: TLP:AMBER'));
  if (dateTemplate) next.push(replaceParagraphText(dateTemplate.xml, model.date ? `Date: ${model.date}` : `Date: ${new Date().toISOString().slice(0, 10)}`));
  if (blankTemplate) next.push(blankTemplate.xml);

  if (executiveHeading) next.push(replaceParagraphText(executiveHeading.xml, 'Executive Summary'));
  model.executiveSummary.forEach((paragraph, index) => {
    next.push(renderParagraphFromTemplate(
      classificationTemplate,
      paragraph,
      false,
      index === 0 ? sourceFootnoteIds : [],
    ));
  });

  if (model.recentActivity.length > 0 && recentHeading) {
    next.push(replaceParagraphText(recentHeading.xml, 'Recent Activity'));
    for (const paragraph of model.recentActivity) next.push(renderParagraphFromTemplate(classificationTemplate, paragraph));
  }

  if (model.timelineRows && model.timelineRows.length > 1 && timelineHeading) {
    next.push(replaceParagraphText(timelineHeading.xml, 'Timeline of Significant Events'));
    if (timelineCaption) next.push(replaceParagraphText(timelineCaption.xml, 'Table 1: Timeline of Significant Events'));
    next.push(renderTable(
      model.timelineRows,
      extractTableProperties(timelineTable?.xml || '') || tablePr,
      extractTableGridWidths(timelineTable?.xml || ''),
    ));
  }

  if (model.assessment.length > 0 && threatActorHeading) {
    next.push(replaceParagraphText(threatActorHeading.xml, threatActorHeading.text || 'Threat Actor Attribution'));
    for (const paragraph of model.assessment) next.push(renderParagraphFromTemplate(classificationTemplate, paragraph));
  }

  if (model.iocRows && model.iocRows.length > 1 && digitalHeading) {
    next.push(replaceParagraphText(digitalHeading.xml, digitalHeading.text || 'Digital Identifiers'));
    if (iocCaption) next.push(replaceParagraphText(iocCaption.xml, iocCaption.text || 'Table 2: Actionable Digital Identifiers'));
    next.push(renderTable(
      toIntelNoteIocRows(model.iocRows),
      extractTableProperties(iocTable?.xml || '') || tablePr,
      extractTableGridWidths(iocTable?.xml || ''),
    ));
  }

  if (model.recommendations.length > 0 && recommendationHeading) {
    next.push(replaceParagraphText(recommendationHeading.xml, recommendationHeading.text || 'Recommendations'));
    for (const item of model.recommendations) next.push(renderParagraphFromTemplate(bulletTemplate || classificationTemplate, item, true));
  }

  if (!useFootnotes && model.sources.length > 0 && sourceHeadingTemplate) {
    next.push(replaceParagraphText(sourceHeadingTemplate.xml, 'Sources'));
    for (const source of model.sources) next.push(renderParagraphFromTemplate(bulletTemplate || classificationTemplate, source, true));
  }

  const replacementBody = `${next.join('')}${sectPr}`;
  return {
    documentXml: `${documentXml.slice(0, bodyInnerStart)}${replacementBody}${documentXml.slice(bodyEnd)}`,
    footnotesXml: useFootnotes && model.sources.length > 0 ? renderSourceFootnotesXml(model.sources) : undefined,
  };
}

function extractDocxTemplateProfileFromXml(documentXml: string): DocxTemplateProfile {
  const bodyStart = documentXml.indexOf('<w:body>');
  const bodyEnd = documentXml.indexOf('</w:body>');
  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
    throw new Error('Template DOCX has an unsupported document body structure.');
  }
  const body = documentXml.slice(bodyStart + '<w:body>'.length, bodyEnd);
  const elements = parseBodyElements(body);
  const text = elements.map((element) => element.text).join('\n');
  return {
    paragraphCount: elements.filter((element) => element.type === 'p').length,
    tableCount: elements.filter((element) => element.type === 'tbl').length,
    tableStyles: Array.from(new Set(elements
      .filter((element) => element.type === 'tbl')
      .map((element) => element.xml.match(/<w:tblStyle[^>]*w:val="([^"]+)"/)?.[1])
      .filter((value): value is string => Boolean(value)))),
    headerReferenceCount: Array.from(documentXml.matchAll(/<w:headerReference\b/g)).length,
    footerReferenceCount: Array.from(documentXml.matchAll(/<w:footerReference\b/g)).length,
    anchors: {
      classification: /classification:/i.test(text),
      date: /^date:/im.test(text),
      executiveSummary: /Executive Summary/i.test(text),
      recentActivity: /Recent Activity/i.test(text),
      timeline: /Timeline of Significant Events|Timeline/i.test(text),
      digitalIdentifiers: /Digital Identifiers|Relevant Threat Intelligence|Supporting Evidence|IOC/i.test(text),
      recommendations: /Recommendations|Recommended Actions/i.test(text),
    },
  };
}

function extractTableProperties(bodyXml: string): string {
  const tablePr = bodyXml.match(/<w:tblPr[\s\S]*?<\/w:tblPr>/)?.[0];
  if (tablePr) return tablePr;
  return [
    '<w:tblPr>',
    '<w:tblStyle w:val="TableGrid"/>',
    '<w:tblW w:w="0" w:type="auto"/>',
    '<w:tblBorders>',
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '</w:tblBorders>',
    '</w:tblPr>',
  ].join('');
}

function extractTableGridWidths(tableXml: string): number[] | undefined {
  const matches = Array.from(tableXml.matchAll(/<w:gridCol[^>]*w:w="(\d+)"/g))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  return matches.length > 0 ? matches : undefined;
}

function parseBodyElements(bodyXml: string): BodyElement[] {
  const matches = bodyXml.match(/<w:p[\s\S]*?<\/w:p>|<w:tbl[\s\S]*?<\/w:tbl>|<w:sectPr[\s\S]*?<\/w:sectPr>|<w:[A-Za-z0-9]+[^>]*\/>/g) || [];
  return matches.map((xml): BodyElement => {
    if (xml.startsWith('<w:p')) return { type: 'p', xml, text: extractText(xml), style: extractParagraphStyle(xml) };
    if (xml.startsWith('<w:tbl')) return { type: 'tbl', xml, text: extractText(xml) };
    if (xml.startsWith('<w:sectPr')) return { type: 'sectPr', xml, text: '' };
    return { type: 'other', xml, text: extractText(xml) };
  });
}

function extractText(xml: string): string {
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
    .map((match) => unescapeXml(match[1]))
    .join('')
    .trim();
}

function extractParagraphStyle(xml: string): string | undefined {
  return xml.match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1];
}

function firstParagraph(elements: BodyElement[]): BodyElement | undefined {
  return elements.find((element) => element.type === 'p');
}

function firstTable(elements: BodyElement[]): BodyElement | undefined {
  return elements.find((element) => element.type === 'tbl');
}

function findParagraph(elements: BodyElement[], predicate: (element: BodyElement) => boolean): BodyElement | undefined {
  return elements.find((element) => element.type === 'p' && predicate(element));
}

function findTableAfter(elements: BodyElement[], anchor: BodyElement | undefined): BodyElement | undefined {
  if (!anchor) return undefined;
  const start = elements.indexOf(anchor);
  if (start === -1) return undefined;
  return elements.slice(start + 1).find((element) => element.type === 'tbl');
}

function findTableWithHeader(elements: BodyElement[], pattern: RegExp): BodyElement | undefined {
  return elements.find((element) => element.type === 'tbl' && pattern.test(element.text));
}

function isHeadingText(value: string, expected: string): boolean {
  return value.trim().toLowerCase() === expected.toLowerCase();
}

function replaceParagraphText(paragraphXml: string, text: string, trailingRuns = ''): string {
  const pPr = paragraphXml.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] || '';
  const style = extractParagraphStyle(paragraphXml);
  const heading = isGeneratedHeadingStyle(style);
  return `<w:p>${pPr}<w:r>${runProperties({
    size: heading ? HEADER_FONT_SIZE : BODY_FONT_SIZE,
    bold: heading,
  })}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>${trailingRuns}</w:p>`;
}

function renderParagraphFromTemplate(
  template: BodyElement | undefined,
  text: string,
  forceBullet = false,
  footnoteIds: number[] = [],
): string {
  if (!template) return renderParagraph(text, undefined, forceBullet);
  const bullet = forceBullet || /^List/i.test(template.style || '');
  return replaceParagraphText(template.xml, bullet ? text : text, renderFootnoteReferenceRuns(footnoteIds));
}

function parseProductContent(markdown: string): ProductContentModel {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const model: ProductContentModel = {
    title: '',
    classification: '',
    date: '',
    executiveSummary: [],
    recentActivity: [],
    assessment: [],
    recommendations: [],
    sources: [],
  };
  let section = '';
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const text = stripMarkdownInline(heading[2]);
      if (heading[1].length === 1 && !model.title) model.title = text;
      section = normalizeSectionName(text);
      index += 1;
      continue;
    }

    const keyValue = line.match(/^\*\*([^:*]+):\*\*\s*(.+)$/);
    if (keyValue) {
      const key = keyValue[1].trim().toLowerCase();
      const value = stripMarkdownInline(keyValue[2]);
      if (key === 'classification') model.classification = value;
      if (key === 'date') model.date = value;
      index += 1;
      continue;
    }

    if (isTableLine(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const rows: string[][] = [splitTableRow(line)];
      index += 2;
      while (index < lines.length && isTableLine(lines[index].trim())) {
        rows.push(splitTableRow(lines[index].trim()));
        index += 1;
      }
      if (section.includes('timeline')) model.timelineRows = rows;
      else if (section.includes('identifier') || section.includes('ioc') || section.includes('indicator')) model.iocRows = rows;
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    const value = stripMarkdownInline(bullet ? bullet[1] : line);
    if (section.includes('executive')) model.executiveSummary.push(value);
    else if (section.includes('recent')) model.recentActivity.push(value);
    else if (section.includes('assessment') || section.includes('attribution') || section.includes('actor')) model.assessment.push(value);
    else if (section.includes('recommend')) model.recommendations.push(value);
    else if (section.includes('source')) model.sources.push(value);
    index += 1;
  }

  if (model.executiveSummary.length === 0 && model.title) {
    model.executiveSummary.push(model.title);
  }
  return model;
}

function normalizeSectionName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function toIntelNoteIocRows(rows: string[][]): string[][] {
  const [header, ...body] = rows;
  const normalizedHeader = header.map((cell) => cell.toLowerCase());
  const typeIndex = findHeaderIndex(normalizedHeader, /type/);
  const valueIndex = findHeaderIndex(normalizedHeader, /value|indicator|ioc/);
  const descriptionIndex = findHeaderIndex(normalizedHeader, /description|context/);
  const lastSeenIndex = findHeaderIndex(normalizedHeader, /last seen|date/);
  const confidenceIndex = findHeaderIndex(normalizedHeader, /confidence|conf/);
  return [
    ['Type', 'Last Seen', 'Description', 'Confidence'],
    ...body.map((row) => {
      const value = cellAt(row, valueIndex) || cellAt(row, 1) || cellAt(row, 0);
      const description = cellAt(row, descriptionIndex) || value;
      return [
        uppercaseCell(cellAt(row, typeIndex) || 'indicator'),
        cellAt(row, lastSeenIndex) || 'not live validated',
        value && description && description !== value ? `${value} - ${description}` : description || value,
        cellAt(row, confidenceIndex) || 'medium',
      ];
    }),
  ];
}

function findHeaderIndex(headers: string[], pattern: RegExp): number {
  return headers.findIndex((header) => pattern.test(header));
}

function cellAt(row: string[], index: number): string {
  return index >= 0 ? row[index] || '' : '';
}

function uppercaseCell(value: string): string {
  return value.trim().toUpperCase();
}

function renderMarkdownBlocks(markdown: string, tablePr: string): string {
  const blocks = parseMarkdown(markdown);
  return blocks.map((block) => {
    if (block.type === 'heading') return renderParagraph(block.text || '', headingStyle(block.level || 1));
    if (block.type === 'table') return renderTable(block.rows || [], tablePr);
    if (block.type === 'bullet') return renderParagraph(block.text || '', undefined, true);
    return renderParagraph(block.text || '');
  }).join('');
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', text });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: stripMarkdownInline(heading[2]) });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({ type: 'bullet', text: stripMarkdownInline(bullet[1]) });
      continue;
    }
    if (isTableLine(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      const rows: string[][] = [splitTableRow(line)];
      index += 2;
      while (index < lines.length && isTableLine(lines[index].trim())) {
        rows.push(splitTableRow(lines[index].trim()));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: 'table', rows });
      continue;
    }
    paragraph.push(stripMarkdownInline(line));
  }

  flushParagraph();
  return blocks;
}

function renderParagraph(text: string, style?: string, bullet = false): string {
  const styleXml = style ? `<w:pStyle w:val="${style}"/>` : '';
  const heading = isGeneratedHeadingStyle(style);
  const runPr = runProperties({
    size: heading ? HEADER_FONT_SIZE : BODY_FONT_SIZE,
    bold: heading,
  });
  const bulletRun = bullet ? `<w:r>${runPr}<w:t xml:space="preserve">- </w:t></w:r>` : '';
  return [
    '<w:p>',
    `<w:pPr>${styleXml}</w:pPr>`,
    bulletRun,
    '<w:r>',
    runPr,
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`,
    '</w:r>',
    '</w:p>',
  ].join('');
}

function renderTable(rows: string[][], tablePr: string, preferredWidths?: number[]): string {
  if (rows.length === 0) return '';
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = normalizeTableWidths(rows, columnCount, preferredWidths);
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  const renderedRows = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_, index) => row[index] || '')
      .map((cell, index) => renderCell(cell, rowIndex === 0, widths[index]))
      .join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl>${tablePr}<w:tblGrid>${grid}</w:tblGrid>${renderedRows}</w:tbl>`;
}

function normalizeTableWidths(rows: string[][], columnCount: number, preferredWidths?: number[]): number[] {
  const header = rows[0]?.map((cell) => cell.toLowerCase()) || [];
  if (
    columnCount === 4 &&
    header.some((cell) => /type/.test(cell)) &&
    header.some((cell) => /last seen|date/.test(cell)) &&
    header.some((cell) => /description/.test(cell)) &&
    header.some((cell) => /confidence/.test(cell))
  ) {
    return [1000, 1600, 4760, 2000];
  }
  if (preferredWidths && preferredWidths.length === columnCount) return preferredWidths;
  const gridWidth = Math.max(1200, Math.floor(9360 / Math.max(columnCount, 1)));
  return Array.from({ length: columnCount }, () => gridWidth);
}

function renderCell(text: string, header: boolean, width: number): string {
  const runPr = runProperties({
    size: header ? HEADER_FONT_SIZE : BODY_FONT_SIZE,
    bold: header,
  });
  const verticalAlign = header ? '' : '<w:vAlign w:val="top"/>';
  return [
    '<w:tc>',
    `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcMar><w:top w:w="${header ? 80 : 70}" w:type="dxa"/><w:start w:w="120" w:type="dxa"/><w:bottom w:w="${header ? 80 : 70}" w:type="dxa"/><w:end w:w="120" w:type="dxa"/></w:tcMar>${verticalAlign}</w:tcPr>`,
    '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r>',
    runPr,
    `<w:t xml:space="preserve">${escapeXml(stripMarkdownInline(text))}</w:t>`,
    '</w:r></w:p>',
    '</w:tc>',
  ].join('');
}

function runProperties(options: { size: string; bold?: boolean; subscript?: boolean }): string {
  return [
    '<w:rPr>',
    `<w:rFonts w:ascii="${DEFAULT_DOCX_FONT}" w:hAnsi="${DEFAULT_DOCX_FONT}" w:eastAsia="${DEFAULT_DOCX_FONT}" w:cs="${DEFAULT_DOCX_FONT}"/>`,
    options.bold ? '<w:b/>' : '',
    `<w:sz w:val="${options.size}"/>`,
    `<w:szCs w:val="${options.size}"/>`,
    options.subscript ? '<w:vertAlign w:val="subscript"/>' : '',
    '</w:rPr>',
  ].join('');
}

function renderFootnoteReferenceRuns(ids: number[]): string {
  return ids.map((id, index) => [
    index > 0 ? [
      '<w:r>',
      runProperties({ size: BODY_FONT_SIZE, subscript: true }),
      '<w:t xml:space="preserve">,</w:t>',
      '</w:r>',
    ].join('') : '',
    '<w:r>',
    runProperties({ size: BODY_FONT_SIZE, subscript: true }),
    `<w:footnoteReference w:id="${id}"/>`,
    '</w:r>',
  ].join('')).join('');
}

function renderSourceFootnotesXml(sources: string[]): string {
  const sourceNotes = sources.map((source, index) => [
    `<w:footnote w:id="${index + 1}">`,
    '<w:p>',
    '<w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>',
    '<w:r>',
    runProperties({ size: BODY_FONT_SIZE, subscript: true }),
    '<w:footnoteRef/>',
    '</w:r>',
    '<w:r>',
    runProperties({ size: FOOTNOTE_TEXT_SIZE }),
    `<w:t xml:space="preserve"> ${escapeXml(normalizeSourceFootnoteText(source))}</w:t>`,
    '</w:r>',
    '</w:p>',
    '</w:footnote>',
  ].join('')).join('');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>',
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>',
    sourceNotes,
    '</w:footnotes>',
  ].join('');
}

function normalizeSourceFootnoteText(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

function isGeneratedHeadingStyle(style?: string): boolean {
  return Boolean(style && /heading|title/i.test(style));
}

function headingStyle(level: number): string {
  if (level <= 1) return 'Title';
  if (level === 2) return 'Heading1';
  return 'Heading2';
}

function isTableLine(line: string): boolean {
  return line.startsWith('|') && line.endsWith('|') && line.includes('|');
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

// Decompression-bomb guard. A product-baseline DOCX asset is already bounded to
// MAX_PRODUCT_BASELINE_ASSET_DATA (~20MB) *compressed*; cap the *inflated* output so a
// crafted template cannot expand to an out-of-memory payload when rendering.
const MAX_DOCX_ENTRY_BYTES = 64 * 1024 * 1024; // 64MB per zip entry
const MAX_DOCX_TOTAL_BYTES = 192 * 1024 * 1024; // 192MB across all entries

function unzip(bytes: Uint8Array): ZipEntry[] {
  const view = dataView(bytes);
  const eocdOffset = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let centralOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let totalUncompressed = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(centralOffset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Template DOCX central directory is malformed.');
    }
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const uncompressedSize = view.getUint32(centralOffset + 24, true);
    if (uncompressedSize > MAX_DOCX_ENTRY_BYTES) {
      throw new Error('Template DOCX entry exceeds the maximum allowed size.');
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_DOCX_TOTAL_BYTES) {
      throw new Error('Template DOCX exceeds the maximum allowed uncompressed size.');
    }
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const path = decodeUtf8(bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength));
    const data = readLocalEntry(bytes, localOffset, compressedSize, method);
    entries.push({ path, data });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readLocalEntry(bytes: Uint8Array, offset: number, compressedSize: number, method: number): Uint8Array {
  const view = dataView(bytes);
  if (view.getUint32(offset, true) !== LOCAL_FILE_SIGNATURE) {
    throw new Error('Template DOCX local file entry is malformed.');
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(dataStart, dataStart + compressedSize);
  if (method === 0) return compressed;
  if (method === 8) {
    // Bound the inflated output as a second line of defence against a header that
    // under-declares its uncompressed size (the declared size is pre-checked in unzip).
    const inflated = inflateRaw(compressed);
    if (inflated.length > MAX_DOCX_ENTRY_BYTES) {
      throw new Error('Template DOCX entry exceeds the maximum allowed size.');
    }
    return inflated;
  }
  throw new Error(`Unsupported DOCX compression method: ${method}`);
}

function zipStored(files: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encodeUtf8(file.path);
    const data = file.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_FILE_SIGNATURE, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, EOCD_SIGNATURE, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('Template DOCX is missing an end-of-central-directory record.');
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
