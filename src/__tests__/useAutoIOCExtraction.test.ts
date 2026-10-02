import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutoIOCExtraction } from '../hooks/useAutoIOCExtraction';
import { extractIOCs } from '../lib/ioc-extractor';
import type { IOCAnalysis } from '../types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('debounced IOC extraction', () => {
  it('extracts an indicator entered character by character and uses the last edit after a paste', async () => {
    const update = vi.fn();
    const view = renderHook(({ content }) => useAutoIOCExtraction({ entityId: 'note', content, existingAnalysis: undefined, onUpdate: update, debounceMs: 20 }), { initialProps: { content: '' } });
    let content = '';
    for (const char of '192.0.2.1') { content += char; view.rerender({ content }); }
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(update).toHaveBeenLastCalledWith('note', expect.objectContaining({ iocTypes: ['ipv4'] }));
    view.rerender({ content: 'A longer pasted paragraph containing 192.0.2.2' });
    view.rerender({ content: 'A longer pasted paragraph containing 192.0.2.3' });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(update.mock.calls.at(-1)?.[1].iocAnalysis.iocs.map((ioc: { value: string }) => ioc.value)).toContain('192.0.2.3');
  });

  it('updates same-length replacements, removals and preserves analyst dismissal', async () => {
    const update = vi.fn();
    const analysis: IOCAnalysis = { extractedAt: 1, iocs: extractIOCs('192.0.2.1').map(ioc => ({ ...ioc, dismissed: true, analystNotes: 'Reviewed' })) };
    const view = renderHook(({ content }) => useAutoIOCExtraction({ entityId: 'note', content, existingAnalysis: analysis, onUpdate: update, debounceMs: 20 }), { initialProps: { content: '192.0.2.1' } });
    view.rerender({ content: '192.0.2.1 ' });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(update.mock.calls.at(-1)?.[1].iocAnalysis.iocs[0]).toMatchObject({ dismissed: true, analystNotes: 'Reviewed' });
    view.rerender({ content: '192.0.2.2 ' });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(update.mock.calls.at(-1)?.[1].iocAnalysis.iocs[0].value).toBe('192.0.2.2');
    view.rerender({ content: '' });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(update.mock.calls.at(-1)?.[1].iocAnalysis.iocs).toEqual([]);
  });

  it('does not apply pending extraction to a newly selected entity and catches save failures', async () => {
    const update = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
    const view = renderHook(({ id, content }) => useAutoIOCExtraction({ entityId: id, content, existingAnalysis: undefined, onUpdate: update, debounceMs: 20 }), { initialProps: { id: 'first', content: '' } });
    view.rerender({ id: 'first', content: '192.0.2.1' });
    view.rerender({ id: 'second', content: '' });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(update).not.toHaveBeenCalled();
    view.rerender({ id: 'second', content: '192.0.2.2' });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(view.result.current.error).toBe('Storage unavailable');
  });
});
