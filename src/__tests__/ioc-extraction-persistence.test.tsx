import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { db } from '../db';
import { useAutoIOCExtraction } from '../hooks/useAutoIOCExtraction';
import { extractIOCs } from '../lib/ioc-extractor';
import { disableSync } from '../lib/sync-state';
import type { IOCAnalysis, IOCType, Note } from '../types';

const source = (value: string) => `Reference 192.0.2.1. ${'Routine observation. '.repeat(20)}${value}${' End of observation.'.repeat(20)}`;
const makeNote = (content: string, iocAnalysis?: IOCAnalysis): Note => ({
  id: 'ioc-cache-note', title: 'Synthetic source', content, iocAnalysis, createdAt: 1, updatedAt: 1,
  tags: [], pinned: false, archived: false, trashed: false,
});

beforeEach(async () => { disableSync(); await db.notes.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('debounced extraction persists exact source results', () => {
  it('persists the final equal-length middle edit while retaining unrelated analyst annotations and dismissals', async () => {
    const initial = source('192.0.2.2');
    const analysis: IOCAnalysis = {
      extractedAt: 1,
      analysisSummary: 'Analyst summary retained',
      iocs: extractIOCs(initial).map(item => item.value === '192.0.2.1'
        ? { ...item, dismissed: true, confidence: 'high', analystNotes: 'Existing review', attribution: 'Synthetic source' }
        : item),
    };
    await db.notes.add(makeNote(initial, analysis));
    const update = vi.fn(async (id: string, changes: { iocAnalysis: IOCAnalysis; iocTypes: IOCType[] }) => {
      const count = await db.notes.update(id, changes);
      if (count !== 1) throw new Error('Synthetic note is missing');
    });
    const view = renderHook(({ content }) => useAutoIOCExtraction({
      entityId: 'ioc-cache-note', content, existingAnalysis: analysis, onUpdate: update, debounceMs: 25,
    }), { initialProps: { content: initial } });
    const intermediate = source('192.0.2.3'); const latest = source('192.0.2.4');
    expect(latest.length).toBe(initial.length);
    expect(latest.slice(0, 200)).toBe(initial.slice(0, 200));
    expect(latest.slice(-200)).toBe(initial.slice(-200));
    view.rerender({ content: intermediate });
    await db.notes.update('ioc-cache-note', { content: latest });
    view.rerender({ content: latest });
    await waitFor(async () => {
      const saved = await db.notes.get('ioc-cache-note');
      expect(saved?.iocAnalysis?.iocs.map(item => item.value)).toEqual(['192.0.2.1', '192.0.2.4']);
    });
    expect(update).toHaveBeenCalledTimes(1);
    const saved = await db.notes.get('ioc-cache-note');
    expect(saved?.content).toBe(latest);
    expect(saved?.iocAnalysis?.analysisSummary).toBe('Analyst summary retained');
    expect(saved?.iocAnalysis?.iocs.find(item => item.value === '192.0.2.1')).toMatchObject({
      id: analysis.iocs[0]?.id, dismissed: true, confidence: 'high', analystNotes: 'Existing review', attribution: 'Synthetic source',
    });
    expect(saved?.iocTypes).toEqual(['ipv4']);
    const uncoupled = extractIOCs(latest);
    expect(uncoupled.every(item => !item.dismissed && item.confidence === 'medium' && !item.analystNotes)).toBe(true);
    expect(view.result.current.error).toBeNull();
  });

  it('persists an empty type selection without reusing a prior all-types result', async () => {
    const content = source('192.0.2.5');
    const analysis: IOCAnalysis = { extractedAt: 1, iocs: extractIOCs(content, {}) };
    await db.notes.add(makeNote(content, analysis));
    const update = vi.fn(async (id: string, changes: { iocAnalysis: IOCAnalysis }) => {
      await db.notes.update(id, changes);
    });
    const view = renderHook(({ content: next }) => useAutoIOCExtraction({
      entityId: 'ioc-cache-note', content: next, existingAnalysis: analysis, onUpdate: update,
      enabledTypes: [], debounceMs: 1,
    }), { initialProps: { content: `${content} ` } });
    view.rerender({ content });
    await waitFor(async () => expect((await db.notes.get('ioc-cache-note'))?.iocAnalysis?.iocs).toEqual([]));
    expect(update).toHaveBeenCalledTimes(1);
    expect(extractIOCs(content, {})).toHaveLength(2);
  });
});
