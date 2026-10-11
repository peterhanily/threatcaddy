import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from '../components/Chat/ChatInput';
import { COMPOSER_LIMITS, discardAllComposerDrafts, getComposerDraft, setComposerText, commitComposerText } from '../lib/chat-composer-drafts';
import { clearPending, hasPendingChanges, markPending } from '../lib/pending-changes';
import { withEntityDraftBarrier } from '../lib/entity-drafts';

const props = { onStop: vi.fn(), isStreaming: false, extensionAvailable: true, model: 'claude-sonnet-4-6', onModelChange: vi.fn(), draftScope: 'thread-a' };
const textbox = () => screen.getByRole('textbox', { name: 'Message to CaddyAI' });
const send = () => fireEvent.click(screen.getByTitle('Send message (Enter)'));
function deferred() {
  let resolve: () => void = () => {}; let reject: (reason: Error) => void = () => {};
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => discardAllComposerDrafts());
afterEach(() => { discardAllComposerDrafts(); vi.restoreAllMocks(); });

describe('chat draft commit ownership', () => {
  it('retains text until actual commit, rejects duplicate submission, and clears on acknowledgement', async () => {
    const work = deferred(); let acknowledge = () => {};
    const onSend = vi.fn((_text: string, commit: () => void) => { acknowledge = commit; return work.promise; });
    render(<ChatInput {...props} onSend={onSend} />);
    fireEvent.change(textbox(), { target: { value: 'Retain until saved' } }); send(); send();
    expect(onSend).toHaveBeenCalledOnce(); expect(textbox()).toHaveValue('Retain until saved');
    expect(hasPendingChanges()).toBe(true);
    act(() => acknowledge()); expect(textbox()).toHaveValue('');
    await act(async () => { work.resolve(); await work.promise; });
    expect(hasPendingChanges()).toBe(false);
  });

  it('retains a failed draft and allows a deliberate retry', async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error('Synthetic save failure')).mockImplementationOnce((_text, commit) => commit());
    render(<ChatInput {...props} onSend={onSend} />);
    fireEvent.change(textbox(), { target: { value: 'Not committed' } }); send();
    await screen.findByRole('alert'); expect(textbox()).toHaveValue('Not committed');
    expect(hasPendingChanges()).toBe(true); send();
    await waitFor(() => expect(textbox()).toHaveValue(''));
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('keeps submission ownership across remount, including explicit draft discard', async () => {
    const work = deferred(); let acknowledge = () => {};
    const onSend = vi.fn((_text: string, commit: () => void) => { acknowledge = commit; return work.promise; });
    const first = render(<ChatInput {...props} onSend={onSend} />);
    fireEvent.change(textbox(), { target: { value: 'One saved message' } }); send();
    first.unmount();
    render(<ChatInput {...props} onSend={onSend} />);
    expect(textbox()).toHaveValue('One saved message'); send();
    expect(onSend).toHaveBeenCalledOnce();
    fireEvent.change(textbox(), { target: { value: '' } });
    expect(hasPendingChanges()).toBe(true);
    act(() => discardAllComposerDrafts());
    expect(hasPendingChanges()).toBe(true);
    fireEvent.change(textbox(), { target: { value: 'Later draft' } }); send();
    expect(onSend).toHaveBeenCalledOnce();
    act(() => acknowledge());
    expect(textbox()).toHaveValue('Later draft');
    await act(async () => { work.resolve(); await work.promise; });
    expect(hasPendingChanges()).toBe(true);
    act(() => discardAllComposerDrafts());
    expect(hasPendingChanges()).toBe(false);
  });

  it.each([false, true])('never clears edits typed while saving (same final text: %s)', async same => {
    const work = deferred(); let acknowledge = () => {};
    render(<ChatInput {...props} onSend={(_text, commit) => { acknowledge = commit; return work.promise; }} />);
    fireEvent.change(textbox(), { target: { value: 'Original' } }); send();
    fireEvent.change(textbox(), { target: { value: 'New draft' } });
    if (same) fireEvent.change(textbox(), { target: { value: 'Original' } });
    act(() => acknowledge());
    expect(textbox()).toHaveValue(same ? 'Original' : 'New draft');
    await act(async () => { work.resolve(); await work.promise; });
  });

  it('keeps old acknowledgements isolated from another thread and preserves drafts through remount', async () => {
    const work = deferred(); let acknowledge = () => {};
    const onSend = (_text: string, commit: () => void) => { acknowledge = commit; return work.promise; };
    const view = render(<ChatInput {...props} onSend={onSend} />);
    fireEvent.change(textbox(), { target: { value: 'Same text' } }); send();
    view.rerender(<ChatInput {...props} draftScope="thread-b" onSend={onSend} />);
    expect(textbox()).toHaveValue(''); fireEvent.change(textbox(), { target: { value: 'Same text' } });
    act(() => acknowledge()); expect(textbox()).toHaveValue('Same text');
    expect(getComposerDraft('thread-a').text).toBe('');
    await act(async () => { work.resolve(); await work.promise; });
    view.unmount(); expect(hasPendingChanges()).toBe(true);
    render(<ChatInput {...props} draftScope="thread-b" onSend={onSend} />);
    expect(textbox()).toHaveValue('Same text');
  });

  it('keeps the draft when validation returns without acknowledging and disables send while images load', async () => {
    const onSend = vi.fn(); const view = render(<ChatInput {...props} readingImages onSend={onSend} />);
    fireEvent.change(textbox(), { target: { value: 'Ready later' } });
    fireEvent.keyDown(textbox(), { key: 'Enter' }); expect(onSend).not.toHaveBeenCalled();
    view.rerender(<ChatInput {...props} onSend={onSend} />); send();
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(textbox()).toHaveValue('Ready later');
  });

  it('bounds individual and combined text without silently truncating previous content', () => {
    expect(setComposerText('thread-a', 'Earlier')).toBeNull();
    expect(setComposerText('thread-a', 'x'.repeat(COMPOSER_LIMITS.textChars + 1))).toBe('length');
    expect(getComposerDraft('thread-a').text).toBe('Earlier');
    discardAllComposerDrafts();
    for (let i = 0; i < 5; i++) expect(setComposerText(`thread-${i}`, 'x'.repeat(COMPOSER_LIMITS.textChars))).toBeNull();
    expect(setComposerText('thread-extra', 'x')).toBe('total');
    expect(getComposerDraft('thread-extra').text).toBe('');
  });

  it('does not let a discarded draft acknowledgement clear a later draft', () => {
    setComposerText('thread-a', 'First'); const original = getComposerDraft('thread-a').revision;
    discardAllComposerDrafts(); setComposerText('thread-a', 'First');
    commitComposerText('thread-a', original);
    expect(getComposerDraft('thread-a').text).toBe('First');
  });

  it('blocks replacement/snapshot callbacks for unsent chat or pending file work', async () => {
    const callback = vi.fn(async () => 'saved');
    setComposerText('thread-a', 'Unsent');
    await expect(withEntityDraftBarrier(callback)).rejects.toThrow('Unsent chat drafts');
    expect(callback).not.toHaveBeenCalled(); discardAllComposerDrafts();
    const fileToken = Symbol('pending file fixture'); markPending(fileToken);
    try { await expect(withEntityDraftBarrier(callback)).rejects.toThrow('pending file imports'); }
    finally { clearPending(fileToken); }
    expect(callback).not.toHaveBeenCalled();
    await expect(withEntityDraftBarrier(callback)).resolves.toBe('saved');
  });
});
