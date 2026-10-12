import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMentionSearch } from '../hooks/useMentionSearch';
import { searchMentions, type MentionSuggestion } from '../lib/chat-mentions';
import { ChatInput } from '../components/Chat/ChatInput';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';

vi.mock('../lib/chat-mentions', async importOriginal => ({ ...await importOriginal<typeof import('../lib/chat-mentions')>(), searchMentions: vi.fn() }));
const search = vi.mocked(searchMentions);
const results = (label: string): MentionSuggestion[] => [{ type: 'note', id: label, label }];
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const props = { type: 'note' as const, query: 'first', folderId: 'fictional-a', scope: 'composer-one' };
const advance = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); };

beforeEach(() => { vi.useFakeTimers(); search.mockReset(); discardAllComposerDrafts(); });
afterEach(() => { cleanup(); vi.useRealTimers(); discardAllComposerDrafts(); });

describe('scoped mention search completion', () => {
  it('debounces only the latest typed query', async () => {
    search.mockResolvedValue(results('latest'));
    const view = renderHook(useMentionSearch, { initialProps: props });
    view.rerender({ ...props, query: 'new query' });
    await advance();
    expect(search).toHaveBeenCalledExactlyOnceWith('note', 'new query', 'fictional-a');
    expect(view.result.current).toEqual(results('latest'));
  });

  it.each(['query', 'folderId', 'scope'] as const)('discards an old %s result arriving after its replacement', async field => {
    const old = deferred<MentionSuggestion[]>(); const current = deferred<MentionSuggestion[]>();
    search.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = renderHook(useMentionSearch, { initialProps: props }); await advance();
    view.rerender({ ...props, [field]: 'new-owner' });
    expect(view.result.current).toEqual([]);
    await advance();
    await act(async () => { current.resolve(results('current')); });
    await act(async () => { old.resolve(results('stale')); });
    expect(view.result.current).toEqual(results('current'));
  });

  it('hides an already-displayed result synchronously when folder ownership changes', async () => {
    search.mockResolvedValue(results('prior folder'));
    const view = renderHook(useMentionSearch, { initialProps: props }); await advance();
    expect(view.result.current).toHaveLength(1);
    view.rerender({ ...props, folderId: 'other-folder' });
    expect(view.result.current).toEqual([]);
  });

  it('cancels a scheduled lookup and ignores in-flight completions after closing or unmounting', async () => {
    const pending = deferred<MentionSuggestion[]>(); search.mockReturnValue(pending.promise);
    const initialProps: Parameters<typeof useMentionSearch>[0] = props;
    const view = renderHook((input: Parameters<typeof useMentionSearch>[0]) => useMentionSearch(input), { initialProps });
    view.rerender({ ...props, type: undefined }); await advance(); expect(search).not.toHaveBeenCalled();
    view.rerender(props); await advance();
    view.rerender({ ...props, type: undefined });
    await act(async () => { pending.resolve(results('closed')); });
    expect(view.result.current).toEqual([]);
    const late = deferred<MentionSuggestion[]>(); search.mockReturnValue(late.promise);
    view.rerender(props); await advance(); view.unmount();
    await act(async () => { late.resolve(results('unmounted')); });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('contains current and stale read failures without exposing prior results', async () => {
    const pending = deferred<MentionSuggestion[]>(); search.mockReturnValueOnce(pending.promise).mockRejectedValue(new Error('Synthetic read failure'));
    const view = renderHook(useMentionSearch, { initialProps: props }); await advance();
    view.rerender({ ...props, query: 'new' }); await advance();
    await act(async () => { pending.reject(new Error('Stale synthetic failure')); });
    expect(view.result.current).toEqual([]);
  });

  it('real composer leaves stale suggestions hidden after category change, Escape and composer switch', async () => {
    const pending = deferred<MentionSuggestion[]>(); search.mockReturnValue(pending.promise);
    const options = { onSend: vi.fn(), onStop: vi.fn(), isStreaming: false, extensionAvailable: true, model: 'synthetic-model', onModelChange: vi.fn(), draftScope: 'first-composer', folderId: 'one' };
    const view = render(<ChatInput {...options} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '@note:fictional' } }); await advance();
    fireEvent.change(input, { target: { value: '@' } });
    await act(async () => { pending.resolve(results('must stay hidden')); });
    expect(screen.queryByText('must stay hidden')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '@note:fictional' } }); await advance();
    expect(screen.getByText('must stay hidden')).toBeVisible();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('must stay hidden')).not.toBeInTheDocument();
    view.rerender(<ChatInput {...options} draftScope="second-composer" folderId="two" />);
    expect(screen.queryByText('must stay hidden')).not.toBeInTheDocument();
  });
});
