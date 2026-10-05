import { describe, expect, it } from 'vitest';
import { marked, type Tokens } from 'marked';
import {
  composeProductMarkdown, createProductComposerDraft, deriveProductComposerClassification,
  prepareProductComposerNote, PRODUCT_COMPOSER_LIMITS, ProductComposerValidationError,
  stageProductSection, type ProductComposerSnapshot, type ProductComposerSourceKind,
} from '../lib/product-composer';
import { DEFAULT_CLS_LEVELS, type EvidenceItem, type Note, type NoteTemplate, type StandaloneIOC, type Task, type TimelineEvent } from '../types';

const common = { folderId: 'case', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
const note = (id: string, extra: Partial<Note> = {}): Note => ({ ...common, id, title: id, content: `Full content for ${id}`, pinned: false, ...extra });
const task = (id: string, extra: Partial<Task> = {}): Task => ({ ...common, id, title: id, completed: false, priority: 'none', status: 'todo', order: 0, ...extra });
const event = (id: string, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({ ...common, id, title: id, timestamp: 0, timelineId: 'timeline', eventType: 'other', source: 'Fictional source', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], starred: false, ...extra });
const ioc = (id: string, extra: Partial<StandaloneIOC> = {}): StandaloneIOC => ({ ...common, id, type: 'domain', value: 'fictional.example', confidence: 'low', ...extra });
const evidence = (id: string, extra: Partial<EvidenceItem> = {}): EvidenceItem => ({ ...common, id, title: id, content: 'Full evidence content', fileName: 'fixture.txt', fileType: 'text', size: 0, extractionStatus: 'extracted', importedAt: 0, chunkIndex: 0, chunkCount: 1, ...extra });
const snapshot = (extra: Partial<ProductComposerSnapshot> = {}): ProductComposerSnapshot => ({
  folder: { id: 'case', name: 'Fictional investigation', order: 0, createdAt: 0 },
  notes: [], tasks: [], timelineEvents: [], iocs: [], evidence: [], ...extra,
});
const baseline = (content: string, clsLevel?: string): NoteTemplate => ({
  id: 'baseline', name: 'Fictional baseline', category: 'Product Baseline', source: 'user', createdAt: 0, updatedAt: 0, content, clsLevel,
});
const draft = (content: string) => createProductComposerDraft({ snapshot: snapshot(), baseline: baseline(content), effectiveLevels: DEFAULT_CLS_LEVELS, generatedAt: 0 });

describe('product composer outline', () => {
  it('preserves preamble, heading order, duplicate titles and stable distinct IDs', () => {
    const content = '# Report\n\nIntroductory text.\n\n## Findings\n\nFirst body.\n\n## Findings\n\nSecond body.';
    const result = draft(content);
    expect(result.title).toBe('Report');
    expect(result.sections.map(section => [section.title, section.level, section.content])).toEqual([
      ['Introduction', 0, 'Introductory text.'], ['Findings', 2, 'First body.'], ['Findings', 2, 'Second body.'],
    ]);
    expect(new Set(result.sections.map(section => section.id)).size).toBe(3);
    expect(draft(content)).toEqual(result);
    expect(composeProductMarkdown(result.title, result.sections)).toBe(`${content}\n`);
  });

  it('ignores headings inside fences, indented code, blockquotes and lists without dropping their text', () => {
    const result = draft('## Real\n\n```md\n# Fenced\n```\n\n    # Indented\n\n> ## Quoted\n\n- ### Listed\n');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].content).toContain('# Fenced');
    expect(result.sections[0].content).toContain('    # Indented');
    expect(result.sections[0].content).toContain('> ## Quoted');
    expect(result.sections[0].content).toContain('- ### Listed');
  });

  it('supports setext headings and preserves text before a report title', () => {
    const result = draft('Preamble.\n\nReport\n======\n\nDetails\n-------\n\nBody.');
    expect(result.title).toBe('Report');
    expect(result.sections.map(section => section.content)).toEqual(['Preamble.', 'Body.']);
    expect(result.sections[1].title).toBe('Details');
  });

  it('preserves Markdown reference definitions and baseline code formatting', () => {
    const content = '# Report\n\n## Sources\n\nSee [fixture][source].\n\n[source]: https://fixture.example "Fictional title"\n';
    const result = draft(content);
    expect(composeProductMarkdown(result.title, result.sections)).toBe(content);
  });

  it('offers a manual Draft section without truncating non-heading content or code indentation', () => {
    const content = '    code block\n\nA full paragraph.';
    expect(draft(content).sections).toEqual([{ id: 'section-1', title: 'Draft', level: 2, content }]);
    expect(draft('').sections[0].title).toBe('Draft');
  });

  it('preserves Jinja placeholders/directives verbatim without executing source loops', () => {
    const content = '# {{ title }}\n\n## Sources\n\n{% for note in notes %}{{ note.content }}{% endfor %}';
    const result = createProductComposerDraft({ snapshot: snapshot({ notes: [note('must-not-auto-stage')] }), baseline: baseline(content), effectiveLevels: DEFAULT_CLS_LEVELS, generatedAt: 0 });
    expect(result.hasTemplatePlaceholders).toBe(true);
    expect(result.title).toBe('Fictional investigation Product');
    expect(result.sections[0].title).toBe('{{ title }}');
    expect(result.sections[1].content).toBe('{% for note in notes %}{{ note.content }}{% endfor %}');
    expect(JSON.stringify(result)).not.toContain('Full content for must-not-auto-stage');
  });

  it('rejects oversized raw baselines before normalization and oversized initial sections', () => {
    expect(() => draft('\r\n'.repeat(250_001))).toThrow('Baseline exceeds');
    expect(() => draft('x'.repeat(PRODUCT_COMPOSER_LIMITS.sectionCharacters + 1))).toThrow('Section exceeds');
  });
});

describe('explicit source staging', () => {
  const all = snapshot({ notes: [note('note')], tasks: [task('task')], timelineEvents: [event('event')], iocs: [ioc('ioc')], evidence: [evidence('evidence')] });
  it.each<{ kind: ProductComposerSourceKind; id: string }>([
    { kind: 'notes', id: 'note' }, { kind: 'tasks', id: 'task' }, { kind: 'timeline', id: 'event' }, { kind: 'iocs', id: 'ioc' }, { kind: 'evidence', id: 'evidence' },
  ])('stages only explicit $kind selections', ({ kind, id }) => {
    const output = stageProductSection(all, kind, [id]);
    expect(output).toContain(`| ${id} |`);
    expect(() => stageProductSection(all, kind, [])).toThrow('Select at least one');
    expect(() => stageProductSection(all, kind, ['missing'])).toThrow('no longer available');
  });

  it('rejects other-folder, archived, trashed and stale IDs without substituting other sources', () => {
    const data = snapshot({ notes: [note('other', { folderId: 'different' }), note('archive', { archived: true }), note('trash', { trashed: true }), note('active')] });
    for (const id of ['other', 'archive', 'trash', 'missing']) expect(() => stageProductSection(data, 'notes', [id])).toThrow(ProductComposerValidationError);
    expect(stageProductSection(data, 'notes', ['active'])).not.toContain('Full content for archive');
  });

  it('escapes pipes, newlines, backslashes, HTML and image syntax into literal table cells', () => {
    const output = stageProductSection(snapshot({ notes: [note('literal', { title: 'A|B\nC\\D', content: '<img src="https://fixture.example/image">\n![image](https://fixture.example/image)' })] }), 'notes', ['literal']);
    expect(output).toContain('A&#124;B<br>C&#92;D');
    expect(output).toContain('&lt;img');
    expect(output).not.toContain('<img');
    const table = marked.lexer(output).find(token => token.type === 'table') as Tokens.Table;
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toHaveLength(5);
    expect(marked.parse(output)).not.toContain('<img');
  });

  it('sorts deterministically and never mutates the caller snapshot', () => {
    const data = snapshot({ notes: [note('z'), note('a')], timelineEvents: [event('new', { timestamp: 2 }), event('old', { timestamp: 1 })] });
    const before = structuredClone(data);
    expect(stageProductSection(data, 'notes', ['z', 'a'])).toBe(stageProductSection(data, 'notes', ['a', 'z', 'a']));
    const chronology = stageProductSection(data, 'timeline', ['new', 'old']);
    expect(chronology.indexOf('| old |')).toBeLessThan(chronology.indexOf('| new |'));
    expect(data).toEqual(before);
  });

  it('rejects source/staged-output budgets rather than silently shortening source text', () => {
    expect(() => stageProductSection(snapshot({ notes: [note('large', { content: 'x'.repeat(PRODUCT_COMPOSER_LIMITS.sourceCharacters + 1) })] }), 'notes', ['large'])).toThrow('staging limit');
    expect(() => stageProductSection(snapshot({ notes: [note('escaped', { content: '|'.repeat(40_000) })] }), 'notes', ['escaped'])).toThrow('section limit');
    expect(() => stageProductSection(snapshot({ notes: Array.from({ length: 2001 }, (_, i) => note(String(i))) }), 'notes', ['0'])).toThrow('source items');
  });
});

describe('classification and save boundary', () => {
  it.each([
    { notes: [note('n', { clsLevel: 'TLP:RED' })] }, { tasks: [task('t', { clsLevel: 'TLP:RED' })] },
    { timelineEvents: [event('e', { clsLevel: 'TLP:RED' })] }, { iocs: [ioc('i', { clsLevel: 'TLP:RED' })] },
    { evidence: [evidence('e', { clsLevel: 'TLP:RED' })] },
  ])('inherits every supported source classification', sources => {
    expect(deriveProductComposerClassification(snapshot(sources))).toBe('TLP:RED');
  });

  it('combines folder, baseline and embedded IOC markings using the configured hierarchy', () => {
    const data = snapshot({ folder: { ...snapshot().folder, clsLevel: 'PUBLIC' }, notes: [note('n', {
      iocAnalysis: { extractedAt: 0, iocs: [{ id: 'embedded', value: 'fictional.example', type: 'domain', confidence: 'low', firstSeen: 0, dismissed: false, clsLevel: 'SECRET' }] },
    })] });
    expect(deriveProductComposerClassification(data, baseline('', 'INTERNAL'), ['PUBLIC', 'INTERNAL', 'SECRET'])).toBe('SECRET');
  });

  it('retains unknown restrictions conservatively and excludes unavailable sources', () => {
    const data = snapshot({ notes: [note('unknown', { clsLevel: 'UNRESOLVED' }), note('known', { clsLevel: 'TLP:GREEN' }), note('other', { folderId: 'other', clsLevel: 'OTHER' })] });
    expect(deriveProductComposerClassification(data)).toBe('TLP:GREEN & UNRESOLVED');
  });

  it('rejects oversized embedded-indicator inventories and combined labels without losing restrictions', () => {
    const embedded = { id: 'embedded', value: 'fictional.example', type: 'domain' as const, confidence: 'low' as const, firstSeen: 0, dismissed: false, clsLevel: 'TLP:RED' };
    expect(() => deriveProductComposerClassification(snapshot({ notes: [note('large', { iocAnalysis: { extractedAt: 0, iocs: Array.from({ length: 2000 }, () => embedded) } })] }))).toThrow('embedded indicators');
    expect(() => deriveProductComposerClassification(snapshot({ notes: [note('a', { clsLevel: 'A'.repeat(300) }), note('b', { clsLevel: 'B'.repeat(300) })] }))).toThrow('Combined classification');
  });

  it('builds a fresh note patch with product metadata and a non-downgraded classification', () => {
    const data = snapshot({ notes: [note('n', { clsLevel: 'INTERNAL' })] });
    const template = baseline('## Summary');
    const result = prepareProductComposerNote({ title: 'Analyst draft', content: 'Full approved content', baselineId: template.id, clsLevel: 'SECRET' }, data, template, ['PUBLIC', 'INTERNAL', 'SECRET']);
    expect(result).toEqual({ title: 'Analyst draft', content: 'Full approved content', folderId: 'case', clsLevel: 'SECRET', tags: ['product', 'draft-product', 'baseline:baseline'] });
    expect(result).not.toHaveProperty('id');
    expect(() => prepareProductComposerNote({ title: 'Draft', content: 'Body', clsLevel: 'PUBLIC' }, data, undefined, ['PUBLIC', 'INTERNAL', 'SECRET'])).toThrow('classification');
  });

  it('requires exact retention of unranked classification and validates baseline ownership', () => {
    const data = snapshot({ notes: [note('n', { clsLevel: 'UNRESOLVED' })] });
    expect(prepareProductComposerNote({ title: 'Draft', content: 'Body', clsLevel: 'UNRESOLVED' }, data, undefined, DEFAULT_CLS_LEVELS).clsLevel).toBe('UNRESOLVED');
    expect(() => prepareProductComposerNote({ title: 'Draft', content: 'Body' }, data, undefined, DEFAULT_CLS_LEVELS)).toThrow('classification');
    expect(() => prepareProductComposerNote({ title: 'Draft', content: 'Body', clsLevel: 'TLP:RED' }, data, undefined, DEFAULT_CLS_LEVELS)).toThrow('classification');
    expect(() => prepareProductComposerNote({ title: 'Draft', content: 'Body', baselineId: 'removed' }, data, undefined, DEFAULT_CLS_LEVELS)).toThrow('baseline');
  });

  it('rejects a newly classified source rather than silently saving unmarked Markdown', () => {
    const data = snapshot();
    const original = createProductComposerDraft({ snapshot: data, effectiveLevels: DEFAULT_CLS_LEVELS, generatedAt: 0 });
    const input = { title: original.title, content: composeProductMarkdown(original.title, original.sections), clsLevel: original.clsLevel };
    expect(prepareProductComposerNote(input, data, undefined, DEFAULT_CLS_LEVELS).clsLevel).toBeUndefined();
    const current = snapshot({ folder: { ...data.folder, clsLevel: 'TLP:GREEN' } });
    expect(() => prepareProductComposerNote(input, current, undefined, DEFAULT_CLS_LEVELS)).toThrow('classification');
    expect(input.content).not.toContain('Classification:');
  });

  it('rejects blank/oversized content, multiline titles and a lost investigation', () => {
    const save = (input: { title: string; content: string }) => prepareProductComposerNote(input, snapshot(), undefined, DEFAULT_CLS_LEVELS);
    expect(() => save({ title: 'Title', content: ' ' })).toThrow('empty');
    expect(() => save({ title: 'Title', content: 'x'.repeat(500_001) })).toThrow('limit');
    expect(() => save({ title: 'One\nTwo', content: 'Body' })).toThrow('single line');
    expect(() => prepareProductComposerNote({ title: 'Title', content: 'Body' }, snapshot({ folder: { ...snapshot().folder, id: '' } }), undefined, DEFAULT_CLS_LEVELS)).toThrow('investigation');
  });

  it('validates section structure and total output size and includes classification in Markdown', () => {
    const section = { id: 'one', title: 'Summary', level: 2, content: 'Analyst wording.' };
    expect(composeProductMarkdown('Draft', [section], 'TLP:AMBER')).toContain('**Classification:** TLP:AMBER');
    expect(() => composeProductMarkdown('Draft', [section, section])).toThrow('unique');
    expect(() => composeProductMarkdown('Draft', [{ ...section, level: 7 }])).toThrow('levels');
    expect(() => composeProductMarkdown('Draft', Array.from({ length: 81 }, (_, i) => ({ ...section, id: String(i) })))).toThrow('sections');
    expect(() => composeProductMarkdown('Draft', Array.from({ length: 3 }, (_, i) => ({ ...section, id: String(i), content: 'x'.repeat(200_000) })))).toThrow('document limit');
  });
});
