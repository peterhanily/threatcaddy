import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { generateSampleInvestigation } from '../lib/sample-investigation';
import { generateRealisticInvestigation } from '../lib/sample-investigation-realistic';
import { isSampleEntityForKind } from '../lib/sample-investigation-store';
import { validatePortableTables } from '../lib/backup-records';
import { renderMarkdown } from '../lib/markdown';
import { MarkdownPreview } from '../components/Notes/MarkdownPreview';
import { FirstRunGuide } from '../components/Investigations/FirstRunGuide';

function portable(sample: ReturnType<typeof generateSampleInvestigation>) {
  return { folders: [sample.folder], notes: sample.notes, tasks: sample.tasks, timelineEvents: sample.timelineEvents,
    timelines: [sample.timeline], standaloneIOCs: sample.standaloneIOCs, whiteboards: [sample.whiteboard],
    tags: sample.tags, chatThreads: sample.chatThreads, evidenceItems: sample.evidenceItems, noteTemplates: sample.noteTemplates };
}

describe('sample investigations', () => {
  it('keeps both cases portable and tells each demo\'s seeded records apart from user additions', () => {
    const realistic = portable(generateRealisticInvestigation());
    const parody = portable(generateSampleInvestigation());
    expect(() => validatePortableTables(realistic)).not.toThrow();
    expect(() => validatePortableTables(parody)).not.toThrow();
    const firstIds = Object.values(realistic).flat().map(entity => entity.id);
    const secondIds = Object.values(parody).flat().map(entity => entity.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
    for (const id of firstIds) {
      expect(isSampleEntityForKind(id, 'realistic')).toBe(true);
      expect(isSampleEntityForKind(id, 'parody')).toBe(false);
    }
    for (const id of secondIds) {
      expect(isSampleEntityForKind(id, 'realistic')).toBe(false);
      expect(isSampleEntityForKind(id, 'parody')).toBe(true);
    }
    expect(isSampleEntityForKind('user-note', 'realistic')).toBe(false);
    expect(isSampleEntityForKind('user-note', 'parody')).toBe(false);
  });

  it('resolves every realistic note reference and all repaired parody summary links', () => {
    const realistic = generateRealisticInvestigation();
    const parody = generateSampleInvestigation();
    for (const note of realistic.notes) {
      const html = renderMarkdown(note.content, realistic.notes);
      expect(html).not.toContain('tclink-broken');
      expect(html).not.toContain('href="#"');
      for (const target of note.linkedNoteIds ?? []) expect(html).toContain(`data-note-id="${target}"`);
    }
    const summary = parody.notes[0];
    if (!summary) throw new Error('Missing parody summary');
    const html = renderMarkdown(summary.content, parody.notes);
    expect(html).not.toContain('href="#"');
    expect(html).not.toContain('tclink-broken');
    expect(html.match(/data-note-id=/g)).toHaveLength(8);
  });

  it('navigates from evidence to the qualified report through the real preview click handler', () => {
    const sample = generateRealisticInvestigation();
    const assessment = sample.notes.find(note => note.title.startsWith('Assessment'));
    const report = sample.notes.find(note => note.title.startsWith('Draft Incident Report'));
    if (!assessment || !report) throw new Error('Missing linked workflow notes');
    const navigate = vi.fn();
    render(<MarkdownPreview content={assessment.content} allNotes={sample.notes} onNavigateToNote={navigate} />);
    fireEvent.click(screen.getByText(report.title));
    expect(navigate).toHaveBeenCalledWith(report.id);
    expect(report.content).toContain('amount of exposed data and initial access method remain unknown');
  });

  it('ships only reserved network indicators, actual source references and no invented enrichment or agent conversations', () => {
    const sample = generateRealisticInvestigation();
    expect(sample.standaloneIOCs.map(ioc => ioc.value)).toEqual(['198.51.100.24', 'archive@review-mail.example', '192.0.2.10']);
    expect(sample.chatThreads).toEqual([]);
    expect(sample.standaloneIOCs.every(ioc => !ioc.enrichment && !ioc.attribution)).toBe(true);
    const ids = new Set(Object.values(portable(sample)).flat().map(entity => entity.id));
    for (const entity of [...sample.notes, ...sample.tasks, ...sample.timelineEvents, ...sample.standaloneIOCs, ...sample.evidenceItems]) {
      for (const [key, value] of Object.entries(entity)) {
        if (key.startsWith('linked') && Array.isArray(value)) for (const target of value) expect(ids.has(target)).toBe(true);
      }
    }
    expect(sample.evidenceItems.every(item => item.content.length === item.size)).toBe(true);
    expect(sample.evidenceItems.map(item => item.chunkIndex)).toEqual([1, 1]);
    expect(sample.timelineEvents.map(event => event.timestamp)).toEqual(sample.timelineEvents.map(event => event.timestamp).sort((a, b) => a - b));
  });
});

describe('first investigation guidance', () => {
  it('routes each entry choice and explains manual report export separately from a backup', () => {
    const onCreate = vi.fn(); const onImport = vi.fn(); const onLoadDemo = vi.fn();
    render(<FirstRunGuide onCreate={onCreate} onImport={onImport} onLoadDemo={onLoadDemo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Investigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import source files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try the realistic demo' }));
    expect(onCreate).toHaveBeenCalledOnce(); expect(onImport).toHaveBeenCalledOnce(); expect(onLoadDemo).toHaveBeenCalledOnce();
    expect(screen.getByText(/Download the note as Markdown; use Save Backup separately/)).toBeVisible();
  });
});
