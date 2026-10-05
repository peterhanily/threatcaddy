import { marked } from 'marked';
import type { EvidenceItem, Folder, Note, NoteTemplate, StandaloneIOC, Task, TimelineEvent } from '../types';
import { DEFAULT_CLS_LEVELS } from '../types';

export const PRODUCT_COMPOSER_LIMITS = {
  baselineCharacters: 500_000,
  sectionCharacters: 200_000,
  documentCharacters: 500_000,
  sourceCharacters: 1_000_000,
  sourceItems: 2_000,
  sections: 80,
  titleCharacters: 500,
} as const;

export class ProductComposerValidationError extends Error {
  readonly code: 'limit' | 'selection' | 'structure';
  constructor(code: ProductComposerValidationError['code'], message: string) {
    super(message);
    this.name = 'ProductComposerValidationError';
    this.code = code;
  }
}

export interface ProductComposerSnapshot {
  folder: Folder;
  notes: readonly Note[];
  tasks: readonly Task[];
  timelineEvents: readonly TimelineEvent[];
  iocs: readonly StandaloneIOC[];
  evidence: readonly EvidenceItem[];
}
export interface ProductComposerSection {
  id: string;
  title: string;
  /** Zero preserves introductory text without introducing another heading. */
  level: number;
  content: string;
}
export interface ProductComposerDraft {
  title: string;
  sections: ProductComposerSection[];
  clsLevel?: string;
  hasTemplatePlaceholders: boolean;
  generatedAt: string;
}
export type ProductComposerSourceKind = 'notes' | 'tasks' | 'timeline' | 'iocs' | 'evidence';

function limit(value: string, maximum: number, label: string): void {
  if (value.length > maximum) throw new ProductComposerValidationError('limit', `${label} exceeds the ${maximum.toLocaleString('en-US')}-character limit. Reduce it before continuing; no content has been truncated.`);
}
function validateHeading(value: string, label: string): void {
  limit(value, PRODUCT_COMPOSER_LIMITS.titleCharacters, label);
  if (!value.trim() || /[\r\n]/.test(value)) throw new ProductComposerValidationError('structure', `${label} must be a nonempty single line.`);
}
function stripBlankLines(value: string): string {
  return value.replace(/^(?:[\t ]*\n)+/, '').replace(/(?:\n[\t ]*)+$/, '');
}
function activeInFolder<T extends { folderId?: string; trashed: boolean; archived: boolean }>(rows: readonly T[], folderId: string): T[] {
  return rows.filter(row => row.folderId === folderId && !row.trashed && !row.archived);
}
function scopedSnapshot(snapshot: ProductComposerSnapshot): ProductComposerSnapshot {
  const collections = [snapshot.notes, snapshot.tasks, snapshot.timelineEvents, snapshot.iocs, snapshot.evidence];
  if (collections.reduce((total, rows) => total + rows.length, 0) > PRODUCT_COMPOSER_LIMITS.sourceItems) {
    throw new ProductComposerValidationError('limit', `The composer supports at most ${PRODUCT_COMPOSER_LIMITS.sourceItems} source items. Narrow the supplied investigation snapshot.`);
  }
  if (!snapshot.folder.id) throw new ProductComposerValidationError('structure', 'Choose an investigation before composing a product.');
  return {
    folder: snapshot.folder,
    notes: activeInFolder(snapshot.notes, snapshot.folder.id),
    tasks: activeInFolder(snapshot.tasks, snapshot.folder.id),
    timelineEvents: activeInFolder(snapshot.timelineEvents, snapshot.folder.id),
    iocs: activeInFolder(snapshot.iocs, snapshot.folder.id),
    evidence: activeInFolder(snapshot.evidence, snapshot.folder.id),
  };
}

/** Never downgrade an unranked label to a familiar but potentially weaker one. */
export function deriveProductComposerClassification(
  snapshot: ProductComposerSnapshot,
  baseline?: NoteTemplate,
  effectiveLevels: readonly string[] = DEFAULT_CLS_LEVELS,
): string | undefined {
  const source = scopedSnapshot(snapshot);
  const entities = [...source.notes, ...source.tasks, ...source.timelineEvents, ...source.iocs, ...source.evidence];
  const labels = new Set<string>();
  const includeLevel = (level: string | undefined) => {
    if (!level) return;
    limit(level, PRODUCT_COMPOSER_LIMITS.titleCharacters, 'Classification');
    labels.add(level);
  };
  includeLevel(source.folder.clsLevel);
  includeLevel(baseline?.clsLevel);
  for (const entity of entities) includeLevel(entity.clsLevel);
  let sourceCount = entities.length;
  for (const entity of [...source.notes, ...source.tasks, ...source.timelineEvents]) {
    for (const ioc of entity.iocAnalysis?.iocs ?? []) {
      if (++sourceCount > PRODUCT_COMPOSER_LIMITS.sourceItems) throw new ProductComposerValidationError('limit', 'The classification snapshot exceeds the 2,000-source limit including embedded indicators. Narrow the source snapshot.');
      includeLevel(ioc.clsLevel);
    }
  }
  const unique = [...labels];
  if (unique.some(level => !effectiveLevels.includes(level))) {
    const combined = unique.sort().join(' & ');
    limit(combined, PRODUCT_COMPOSER_LIMITS.titleCharacters, 'Combined classification');
    return combined || undefined;
  }
  return unique.reduce<string | undefined>((highest, level) => highest === undefined || effectiveLevels.indexOf(level) > effectiveLevels.indexOf(highest) ? level : highest, undefined);
}

/** Extract an editable outline only. Jinja directives are never evaluated. */
export function createProductComposerDraft({ snapshot, baseline, effectiveLevels, generatedAt }: {
  snapshot: ProductComposerSnapshot;
  baseline?: NoteTemplate;
  effectiveLevels: readonly string[];
  generatedAt: number | string | Date;
}): ProductComposerDraft {
  scopedSnapshot(snapshot);
  limit(baseline?.content ?? '', PRODUCT_COMPOSER_LIMITS.baselineCharacters, 'Baseline');
  const source = (baseline?.content ?? '').replace(/\r\n?/g, '\n');
  const date = new Date(generatedAt);
  if (!Number.isFinite(date.getTime())) throw new ProductComposerValidationError('structure', 'The draft generation time is invalid.');
  let title = `${snapshot.folder.name} Product`;
  const sections: ProductComposerSection[] = [];
  let current: ProductComposerSection | undefined;
  let headingCount = 0;
  const addSection = (heading: string, level: number) => {
    const section = { id: `section-${sections.length + 1}`, title: heading, level, content: '' };
    sections.push(section);
    current = section;
    return section;
  };
  for (const token of marked.lexer(source)) {
    if (token.type === 'heading') {
      headingCount++;
      if (headingCount === 1 && token.depth === 1 && !/{{|{%/.test(token.text)) {
        title = token.text;
        current = undefined;
      } else {
        addSection(token.text, token.depth);
      }
    } else if (current) {
      current.content += token.raw;
    } else if (token.raw.trim()) {
      addSection('Introduction', 0).content = token.raw;
    }
  }
  if (headingCount === 0) {
    sections.splice(0, sections.length, { id: 'section-1', title: 'Draft', level: 2, content: source });
  } else if (sections.length === 0) {
    addSection('Draft', 2);
  }
  for (const section of sections) section.content = stripBlankLines(section.content);
  const clsLevel = deriveProductComposerClassification(snapshot, baseline, effectiveLevels);
  // Apply the same budgets to the initial draft and every later save/preview.
  composeProductMarkdown(title, sections, clsLevel);
  return { title, sections, clsLevel, hasTemplatePlaceholders: /{{|{%/.test(source), generatedAt: date.toISOString() };
}

/** Encode source data as literal cell text, not injected HTML/images or tables. */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\\/g, '&#92;').replace(/\|/g, '&#124;').replace(/`/g, '&#96;')
    .replace(/\[/g, '&#91;').replace(/\]/g, '&#93;').replace(/\*/g, '&#42;').replace(/_/g, '&#95;');
}
function cell(value: string | number | undefined): string {
  return escapeText(value === undefined ? '' : String(value)).replace(/\r\n?|\n/g, '<br>');
}
function dateText(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'Not recorded';
}

/** Stage only explicitly chosen, still-visible source IDs; never query storage. */
export function stageProductSection(snapshot: ProductComposerSnapshot, kind: ProductComposerSourceKind, ids: string[]): string {
  const source = scopedSnapshot(snapshot);
  if (!['notes', 'tasks', 'timeline', 'iocs', 'evidence'].includes(kind)) throw new ProductComposerValidationError('selection', 'Choose a supported source type.');
  if (ids.length === 0) throw new ProductComposerValidationError('selection', 'Select at least one source item to stage.');
  if (ids.length > PRODUCT_COMPOSER_LIMITS.sourceItems) throw new ProductComposerValidationError('limit', 'Too many source selections.');
  const available = kind === 'timeline' ? source.timelineEvents : source[kind];
  if (!available) throw new ProductComposerValidationError('selection', 'Choose a supported source type.');
  const wanted = new Set(ids);
  const selected = available.filter(item => wanted.has(item.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (selected.length !== wanted.size) throw new ProductComposerValidationError('selection', 'A selected source is no longer available in this investigation. Refresh the source selection.');
  let headers: string[];
  let rows: Array<Array<string | number | undefined>>;
  switch (kind) {
    case 'notes':
      headers = ['ID', 'Title', 'Content', 'Source', 'Classification'];
      rows = (selected as Note[]).map(note => [note.id, note.title, note.content, note.sourceUrl, note.clsLevel]);
      break;
    case 'tasks':
      headers = ['ID', 'Title', 'Status', 'Priority', 'Description', 'Classification'];
      rows = (selected as Task[]).map(task => [task.id, task.title, task.status, task.priority, task.description, task.clsLevel]);
      break;
    case 'timeline':
      headers = ['ID', 'Date', 'Event', 'Type', 'Confidence', 'Source', 'Description', 'Classification'];
      rows = (selected as TimelineEvent[]).sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(event => [event.id, dateText(event.timestamp), event.title, event.eventType, event.confidence, event.source, event.description, event.clsLevel]);
      break;
    case 'iocs':
      headers = ['ID', 'Type', 'Value', 'Confidence', 'Analyst notes', 'Classification'];
      rows = (selected as StandaloneIOC[]).map(ioc => [ioc.id, ioc.type, ioc.value, ioc.confidence, ioc.analystNotes, ioc.clsLevel]);
      break;
    case 'evidence':
      headers = ['ID', 'Title', 'File', 'Type', 'Extraction status', 'Content', 'Classification'];
      rows = (selected as EvidenceItem[]).map(item => [item.id, item.title, item.fileName, item.fileType, item.extractionStatus, item.content, item.clsLevel]);
      break;
  }
  const size = rows.reduce((total, row) => total + row.reduce<number>((count, value) => count + String(value ?? '').length, 0), 0);
  if (size > PRODUCT_COMPOSER_LIMITS.sourceCharacters) throw new ProductComposerValidationError('limit', 'Selected source text exceeds the 1,000,000-character staging limit. Select fewer items.');
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  let outputLength = lines.join('\n').length;
  for (const row of rows) {
    const line = `| ${row.map(cell).join(' | ')} |`;
    outputLength += line.length + 1;
    if (outputLength > PRODUCT_COMPOSER_LIMITS.sectionCharacters) throw new ProductComposerValidationError('limit', 'Staged data exceeds the 200,000-character section limit. Select fewer items; no content has been truncated.');
    lines.push(line);
  }
  return lines.join('\n');
}

/** Validate edited sections and serialize the exact analyst-approved content. */
export function composeProductMarkdown(title: string, sections: readonly ProductComposerSection[], clsLevel?: string): string {
  validateHeading(title, 'Product title');
  if (sections.length === 0) throw new ProductComposerValidationError('structure', 'Add at least one report section.');
  if (sections.length > PRODUCT_COMPOSER_LIMITS.sections) throw new ProductComposerValidationError('limit', `A draft can contain at most ${PRODUCT_COMPOSER_LIMITS.sections} sections.`);
  if (new Set(sections.map(section => section.id)).size !== sections.length) throw new ProductComposerValidationError('structure', 'Report section identifiers must be unique.');
  const parts = [`# ${escapeText(title)}`];
  if (clsLevel) {
    validateHeading(clsLevel, 'Classification');
    parts.push(`**Classification:** ${escapeText(clsLevel)}`);
  }
  let total = parts.join('\n\n').length;
  for (const section of sections) {
    if (!Number.isInteger(section.level) || section.level < 0 || section.level > 6) throw new ProductComposerValidationError('structure', 'Section heading levels must be between zero and six.');
    validateHeading(section.title, 'Section title');
    limit(section.content, PRODUCT_COMPOSER_LIMITS.sectionCharacters, 'Section');
    const text = section.level === 0 ? section.content : `${'#'.repeat(section.level)} ${escapeText(section.title)}${section.content ? `\n\n${section.content}` : ''}`;
    total += text.length + 2;
    if (total + 1 > PRODUCT_COMPOSER_LIMITS.documentCharacters) throw new ProductComposerValidationError('limit', 'The draft exceeds the 500,000-character document limit. Reduce it before saving; no content has been truncated.');
    parts.push(text);
  }
  return `${parts.join('\n\n')}\n`;
}

export function assertProductComposerText(content: string): void {
  limit(content, PRODUCT_COMPOSER_LIMITS.documentCharacters, 'Product content');
  if (!content.trim()) throw new ProductComposerValidationError('structure', 'Product content cannot be empty.');
}

/** Validate against the current source snapshot immediately before normal note creation. */
export function prepareProductComposerNote(
  input: { title: string; content: string; clsLevel?: string; baselineId?: string },
  snapshot: ProductComposerSnapshot,
  baseline: NoteTemplate | undefined,
  effectiveLevels: readonly string[],
): Pick<Note, 'title' | 'content' | 'folderId' | 'tags' | 'clsLevel'> {
  validateHeading(input.title, 'Product title');
  assertProductComposerText(input.content);
  if (input.baselineId !== baseline?.id) throw new ProductComposerValidationError('selection', 'The selected baseline is no longer available. Reopen the composer.');
  const floor = deriveProductComposerClassification(snapshot, baseline, effectiveLevels);
  // The serialized draft already carries the classification selected when it
  // was composed. Do not silently add only Note metadata after a source gains
  // classification: that would leave Markdown/downloads incorrectly unmarked.
  const clsLevel = input.clsLevel;
  if (clsLevel) validateHeading(clsLevel, 'Classification');
  if (floor && clsLevel !== floor && (!effectiveLevels.includes(floor)
    || !clsLevel || !effectiveLevels.includes(clsLevel) || effectiveLevels.indexOf(clsLevel) < effectiveLevels.indexOf(floor))) {
    throw new ProductComposerValidationError('selection', 'Source classification has changed or the draft classification is too low. Reopen the composer before saving.');
  }
  return {
    title: input.title,
    content: input.content,
    folderId: snapshot.folder.id,
    clsLevel,
    tags: ['product', 'draft-product', ...(baseline ? [`baseline:${baseline.id}`] : [])],
  };
}
