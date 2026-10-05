import { nanoid } from 'nanoid';
import { db } from '../db';
import type {
  EvidenceItem,
  Folder,
  Note,
  NoteTemplate,
  ProductBaselineAsset,
  ProductBaselineMetadata,
  ProductBaselineSourceDocument,
  ProductBaselineTestFixture,
  StandaloneIOC,
  Task,
  TimelineEvent,
} from '../types';

export const PRODUCT_NOTE_TAG = 'product';
export const PRODUCT_DRAFT_TAG = 'draft-product';
export const PRODUCT_BASELINE_TAG = 'product-baseline';
export const PRODUCT_BASELINE_CATEGORY = 'Product Baseline';
export const PRODUCT_BASELINE_PACKAGE_SCHEMA = 'threatcaddy.productBaseline.v1';
export const MAX_PRODUCT_BASELINE_ASSET_DATA = 20_000_000;

export const BUILTIN_PRODUCT_BASELINES: NoteTemplate[] = [];

export interface ProductBaselinePackage {
  schemaVersion: typeof PRODUCT_BASELINE_PACKAGE_SCHEMA;
  kind: 'product-baseline';
  baseline: {
    id?: string;
    name: string;
    description?: string;
    icon?: string;
    content: string;
    category?: string;
    tags?: string[];
    clsLevel?: string;
    productBaseline?: Partial<ProductBaselineMetadata>;
  };
}

export interface ProductRenderContext {
  [key: string]: unknown;
}

export function isProductBaselineTemplate(template: NoteTemplate): boolean {
  if (template.productBaseline) return true;
  return template.category === PRODUCT_BASELINE_CATEGORY ||
    Boolean(template.tags?.includes(PRODUCT_BASELINE_TAG));
}

export function isProductNote(note: Note): boolean {
  return note.tags.includes(PRODUCT_NOTE_TAG);
}

export async function listProductBaselines(query?: string): Promise<NoteTemplate[]> {
  const custom = (await db.noteTemplates.toArray()).filter(isProductBaselineTemplate);
  const all = [...BUILTIN_PRODUCT_BASELINES, ...custom];
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return all;
  return all.filter((baseline) => [
    baseline.name,
    baseline.description || '',
    baseline.category,
    baseline.tags?.join(' ') || '',
  ].join('\n').toLowerCase().includes(normalized));
}

export async function getProductBaseline(input: { id?: string; name?: string }): Promise<NoteTemplate | undefined> {
  const baselines = await listProductBaselines();
  const id = input.id?.trim();
  const name = input.name?.trim().toLowerCase();
  if (id) return baselines.find((baseline) => baseline.id === id);
  if (!name) return undefined;
  return baselines.find((baseline) => baseline.name.toLowerCase() === name) ||
    baselines.find((baseline) => baseline.name.toLowerCase().includes(name));
}

export function parseProductBaselinePackage(json: string, importedFrom?: string): NoteTemplate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Product baseline package must be valid JSON.');
  }
  return productBaselinePackageToTemplate(parsed, importedFrom);
}

export function productBaselinePackageToTemplate(input: unknown, importedFrom?: string): NoteTemplate {
  if (!input || typeof input !== 'object') {
    throw new Error('Product baseline package must be a JSON object.');
  }
  const pkg = input as Partial<ProductBaselinePackage>;
  if (pkg.schemaVersion !== PRODUCT_BASELINE_PACKAGE_SCHEMA || pkg.kind !== 'product-baseline') {
    throw new Error(`Unsupported product baseline package. Expected ${PRODUCT_BASELINE_PACKAGE_SCHEMA}.`);
  }
  const raw = pkg.baseline;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Product baseline package is missing baseline metadata.');
  }
  const name = cleanString(raw.name);
  if (typeof raw.content === 'string' && raw.content.length > 500_000) {
    throw new Error('Product baseline content exceeds the 500,000-character limit; it has not been truncated.');
  }
  const content = cleanString(raw.content, 500_000);
  if (!name || !content) {
    throw new Error('Product baseline package requires baseline.name and baseline.content.');
  }

  const now = Date.now();
  const productBaseline = normalizeProductBaselineMetadata(raw.productBaseline, importedFrom, now);
  const tags = uniqueStrings([
    PRODUCT_BASELINE_TAG,
    'jinja',
    productBaseline.productType,
    ...(Array.isArray(raw.tags) ? raw.tags : []),
  ]);

  return {
    id: cleanString(raw.id) || nanoid(),
    name,
    description: cleanString(raw.description),
    icon: cleanString(raw.icon) || defaultProductBaselineIcon(productBaseline.productType),
    content,
    category: cleanString(raw.category) || PRODUCT_BASELINE_CATEGORY,
    tags,
    clsLevel: cleanString(raw.clsLevel),
    source: 'user',
    productBaseline,
    createdAt: now,
    updatedAt: now,
  };
}

export function serializeProductBaselinePackage(template: NoteTemplate): string {
  const pkg: ProductBaselinePackage = {
    schemaVersion: PRODUCT_BASELINE_PACKAGE_SCHEMA,
    kind: 'product-baseline',
    baseline: {
      id: template.id,
      name: template.name,
      description: template.description,
      icon: template.icon,
      content: template.content,
      category: template.category,
      tags: template.tags,
      clsLevel: template.clsLevel,
      productBaseline: template.productBaseline,
    },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export async function importProductBaselinePackage(json: string, importedFrom?: string): Promise<NoteTemplate> {
  const template = parseProductBaselinePackage(json, importedFrom);
  const existing = await db.noteTemplates.get(template.id);
  if (existing) {
    await db.noteTemplates.update(template.id, { ...template, updatedAt: Date.now() });
  } else {
    await db.noteTemplates.add(template);
  }
  return template;
}

export async function buildProductRenderContext(
  folder: Folder,
  baseline: NoteTemplate,
  overrides: ProductRenderContext = {},
): Promise<ProductRenderContext> {
  const [notes, tasks, timelineEvents, iocs, evidence] = await Promise.all([
    db.notes.where('folderId').equals(folder.id).and((note) => !note.trashed && !note.archived).toArray(),
    db.tasks.where('folderId').equals(folder.id).and((task) => !task.trashed && !task.archived).toArray(),
    db.timelineEvents.where('folderId').equals(folder.id).and((event) => !event.trashed && !event.archived).toArray(),
    db.standaloneIOCs.where('folderId').equals(folder.id).and((ioc) => !ioc.trashed && !ioc.archived).toArray(),
    db.evidenceItems.where('folderId').equals(folder.id).and((item) => !item.trashed && !item.archived).toArray(),
  ]);

  const generated = new Date();
  const base: ProductRenderContext = {
    title: `${folder.name} Product`,
    baselineName: baseline.name,
    productBaseline: baseline.productBaseline,
    classification: folder.clsLevel || 'TLP:AMBER',
    generatedAt: generated.toISOString(),
    generatedDate: generated.toISOString().slice(0, 10),
    folder,
    investigation: folder,
    priorityIntelligenceRequirements: '',
    executiveSummary: 'Draft executive summary pending analyst review.',
    keyJudgments: [],
    actorOverview: '',
    recentActivity: summarizeRecentActivity(notes, evidence),
    impactAssessment: '',
    assessment: '',
    findings: [],
    recommendations: '',
    nextSteps: '',
    sources: summarizeSources(notes, evidence),
    notes: notes.map(summarizeNote),
    tasks: tasks.map(summarizeTask),
    timelineEvents: timelineEvents
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(summarizeTimelineEvent),
    iocs: iocs.map(summarizeIOC),
    evidence: evidence.map(summarizeEvidence),
  };

  return mergeContext(base, normalizeProductRenderContextInput(overrides));
}

export function normalizeProductRenderContextInput(input: ProductRenderContext = {}): ProductRenderContext {
  const normalized: ProductRenderContext = { ...input };
  const title = stringValue(input.title);
  const country = stringValue(input.country);
  const rawDate = stringValue(input.generatedDate) || stringValue(input.date);
  if (rawDate) normalized.generatedDate = rawDate;
  if (!normalized.classification && input.classification) normalized.classification = stringValue(input.classification);

  if (Array.isArray(input.iocs)) {
    normalized.iocs = input.iocs.map((raw) => {
      const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const value = stringValue(item.value);
      const description = stringValue(item.description) || stringValue(item.context);
      return {
        ...item,
        value,
        type: stringValue(item.type) || 'indicator',
        context: description,
        description,
        confidence: normalizeConfidence(stringValue(item.confidence)),
        lastSeen: stringValue(item.lastSeen) || stringValue(item.last_seen) || stringValue(item.date) || 'not live validated',
      };
    });
  }

  if (Array.isArray(input.sources)) {
    normalized.sources = input.sources.map((raw, index) => {
      const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const marker = stringValue(item.marker) || String(index + 1);
      const sourceTitle = stringValue(item.title) || stringValue(item.name) || stringValue(item.url) || `Source ${marker}`;
      return {
        ...item,
        id: stringValue(item.id) || marker,
        marker,
        title: sourceTitle,
        name: stringValue(item.name) || sourceTitle,
        date: stringValue(item.date),
        url: stringValue(item.url),
        note: stringValue(item.note) || stringValue(item.notes),
      };
    });
  }

  const iocCount = Array.isArray(normalized.iocs) ? normalized.iocs.length : Number(input.official_seed_count || input.enriched_seed_count || 0);
  const sourceCount = Array.isArray(normalized.sources) ? normalized.sources.length : 0;
  if (!normalized.executiveSummary && title) {
    const countryPhrase = country ? ` affecting ${country}` : '';
    normalized.executiveSummary = `${title}${countryPhrase}. This draft is populated from the imported test fixture and should be reviewed against the Word baseline before release.`;
  }
  if (!normalized.recentActivity && title) {
    normalized.recentActivity = `The fixture captured ${iocCount || 'multiple'} indicator${iocCount === 1 ? '' : 's'} and ${sourceCount || 'supporting'} source${sourceCount === 1 ? '' : 's'} for analyst review.`;
  }
  if (!normalized.assessment && input.reporting_window) {
    normalized.assessment = `Reporting window: ${stringValue(input.reporting_window)}.`;
  }

  return normalized;
}

function normalizeProductBaselineMetadata(
  raw: Partial<ProductBaselineMetadata> | undefined,
  importedFrom: string | undefined,
  importedAt: number,
): ProductBaselineMetadata {
  const productType = raw?.productType;
  const kind = raw?.kind;
  const renderer = raw?.renderer;
  const visualFidelity = raw?.visualFidelity;
  return {
    schemaVersion: 1,
    kind: kind === 'docx-template' ? 'docx-template' : 'markdown',
    productType: productType === 'analysis-report' ||
      productType === 'intel-note' ||
      productType === 'executive-brief' ||
      productType === 'custom'
      ? productType
      : 'custom',
    importedAt,
    importedFrom: importedFrom ? cleanString(importedFrom) : raw?.importedFrom ? cleanString(raw.importedFrom) : undefined,
    renderer: renderer === 'docx-template' ? 'docx-template' : 'markdown',
    visualFidelity: visualFidelity === 'word-template' || visualFidelity === 'structural' ? visualFidelity : 'placeholder',
    sourceDocuments: normalizeSourceDocuments(raw?.sourceDocuments),
    testFixtures: normalizeTestFixtures(raw?.testFixtures),
    assets: normalizeAssets(raw?.assets),
    layoutNotes: uniqueStrings(raw?.layoutNotes),
    sourceNoteRules: uniqueStrings(raw?.sourceNoteRules),
    requiredFields: uniqueStrings(raw?.requiredFields),
  };
}

function normalizeSourceDocuments(input: ProductBaselineSourceDocument[] | undefined): ProductBaselineSourceDocument[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const normalized = input.flatMap((doc): ProductBaselineSourceDocument[] => {
    const name = cleanString(doc.name);
    if (!name) return [];
    return [{
      name,
      type: doc.type === 'docx' || doc.type === 'pdf' || doc.type === 'markdown' || doc.type === 'json' ? doc.type : doc.type ? 'other' as const : undefined,
      path: cleanString(doc.path),
      sha256: cleanString(doc.sha256),
      role: cleanString(doc.role),
      notes: cleanString(doc.notes, 2000),
    }];
  });
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTestFixtures(input: ProductBaselineTestFixture[] | undefined): ProductBaselineTestFixture[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const normalized = input.flatMap((fixture): ProductBaselineTestFixture[] => {
    const name = cleanString(fixture.name);
    if (!name) return [];
    return [{
      name,
      type: fixture.type === 'docx' || fixture.type === 'pdf' || fixture.type === 'markdown' || fixture.type === 'json' ? fixture.type : fixture.type ? 'other' as const : undefined,
      path: cleanString(fixture.path),
      sha256: cleanString(fixture.sha256),
      role: cleanString(fixture.role),
      notes: cleanString(fixture.notes, 2000),
    }];
  });
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAssets(input: ProductBaselineAsset[] | undefined): ProductBaselineAsset[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const normalized = input.flatMap((asset): ProductBaselineAsset[] => {
    const name = cleanString(asset.name);
    if (!name) return [];
    return [{
      name,
      role: asset.role === 'docx-template' || asset.role === 'preview' || asset.role === 'image' || asset.role === 'context' ? asset.role : asset.role ? 'other' as const : undefined,
      mimeType: cleanString(asset.mimeType),
      data: cleanString(asset.data, MAX_PRODUCT_BASELINE_ASSET_DATA),
      path: cleanString(asset.path),
      notes: cleanString(asset.notes, 2000),
    }];
  });
  return normalized.length > 0 ? normalized : undefined;
}

function defaultProductBaselineIcon(productType: ProductBaselineMetadata['productType']): string {
  if (productType === 'analysis-report') return 'RPT';
  if (productType === 'intel-note') return 'NOTE';
  return 'TPL';
}

function cleanString(value: unknown, maxLength = 20_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => cleanString(value)).filter((value): value is string => Boolean(value))));
}

export function renderJinjaTemplate(template: string, context: ProductRenderContext): string {
  let rendered = template;
  for (let i = 0; i < 20; i += 1) {
    const next = renderConditionals(renderLoops(rendered, context), context);
    if (next === rendered) break;
    rendered = next;
  }
  rendered = renderVariables(rendered, context);
  return rendered
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderLoops(template: string, context: ProductRenderContext): string {
  return template.replace(
    /{%\s*for\s+([A-Za-z_][\w]*)\s+in\s+([A-Za-z_][\w.]*)\s*%}([\s\S]*?){%\s*endfor\s*%}/g,
    (_match, itemName: string, collectionPath: string, body: string) => {
      const collection = resolvePath(context, collectionPath);
      if (!Array.isArray(collection) || collection.length === 0) return '';
      return collection.map((item) => renderJinjaTemplate(body, { ...context, [itemName]: item })).join('\n');
    },
  );
}

function renderConditionals(template: string, context: ProductRenderContext): string {
  return template.replace(
    /{%\s*if\s+([A-Za-z_][\w.]*)\s*%}([\s\S]*?)(?:{%\s*else\s*%}([\s\S]*?))?{%\s*endif\s*%}/g,
    (_match, conditionPath: string, truthyBody: string, falseyBody = '') => {
      const value = resolvePath(context, conditionPath);
      return isTruthyTemplateValue(value) ? truthyBody : falseyBody;
    },
  );
}

function renderVariables(template: string, context: ProductRenderContext): string {
  return template.replace(/{{\s*([A-Za-z_][\w.]*|\.)\s*}}/g, (_match, path: string) => stringifyTemplateValue(resolvePath(context, path)));
}

function resolvePath(context: ProductRenderContext, path: string): unknown {
  if (path === '.') return context;
  return path.split('.').reduce<unknown>((current, part) => {
    if (current == null) return undefined;
    if (typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, context);
}

function stringifyTemplateValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(stringifyTemplateValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isTruthyTemplateValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

function mergeContext(base: ProductRenderContext, overrides: ProductRenderContext): ProductRenderContext {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === 'object' &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = { ...(merged[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function stringValue(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeConfidence(value: string): string {
  if (!value) return 'Medium';
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

function summarizeRecentActivity(notes: Note[], evidence: EvidenceItem[]): string {
  const latestNote = notes
    .filter((note) => !isProductNote(note))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latestNote) return firstParagraph(latestNote.content) || `Recent activity is captured in ${latestNote.title}.`;
  const latestEvidence = evidence.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latestEvidence) return `Recent activity is supported by uploaded evidence item "${latestEvidence.title}".`;
  return 'Recent activity pending analyst review.';
}

function summarizeSources(notes: Note[], evidence: EvidenceItem[]): Array<{ id: string; title: string; type: string }> {
  return [
    ...notes.filter((note) => !isProductNote(note)).slice(0, 8).map((note) => ({ id: note.id, title: note.title, type: 'note' })),
    ...evidence.slice(0, 8).map((item) => ({ id: item.id, title: item.title, type: 'evidence' })),
  ];
}

function summarizeNote(note: Note): Record<string, unknown> {
  return { id: note.id, title: note.title, summary: firstParagraph(note.content), tags: note.tags };
}

function summarizeTask(task: Task): Record<string, unknown> {
  return { id: task.id, title: task.title, status: task.status, priority: task.priority, description: task.description || '' };
}

function summarizeTimelineEvent(event: TimelineEvent): Record<string, unknown> {
  return {
    id: event.id,
    title: event.title,
    date: new Date(event.timestamp).toISOString().slice(0, 10),
    eventType: event.eventType,
    confidence: event.confidence || '',
    description: event.description || '',
  };
}

function summarizeIOC(ioc: StandaloneIOC): Record<string, unknown> {
  return {
    id: ioc.id,
    type: ioc.type,
    value: ioc.value,
    confidence: ioc.confidence || '',
    context: ioc.analystNotes || ioc.iocSubtype || '',
  };
}

function summarizeEvidence(item: EvidenceItem): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    fileName: item.fileName,
    fileType: item.fileType,
    extractionStatus: item.extractionStatus,
    summary: firstParagraph(item.content),
  };
}

function firstParagraph(value: string): string {
  return value
    .replace(/^#.*$/gm, '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .find(Boolean)
    ?.slice(0, 1000) || '';
}
