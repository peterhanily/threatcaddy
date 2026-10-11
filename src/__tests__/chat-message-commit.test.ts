import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { useChats } from '../hooks/useChats';
import type { ChatMessage, ChatThread } from '../types';

const message: ChatMessage = { id: 'saved-message', role: 'user', content: 'Synthetic retained draft', createdAt: 1 };
const thread: ChatThread = { id: 'thread', title: 'New Chat', messages: [], model: 'synthetic-model', provider: 'anthropic',
  tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
beforeEach(async () => { await db.chatThreads.clear(); await db.chatThreads.add(thread); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('chat message commit acknowledgement', () => {
  it('rejects a missing thread rather than acknowledging an unsaved message', async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => expect(result.current.loadedSuccessfully).toBe(true));
    await db.chatThreads.delete(thread.id);
    await act(async () => { await expect(result.current.addMessage(thread.id, message)).rejects.toThrow('no longer exists'); });
    expect(await db.chatThreads.count()).toBe(0);
  });

  it('acknowledges a committed message even when the subsequent cache read fails', async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => expect(result.current.loadedSuccessfully).toBe(true));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const read = vi.spyOn(db.chatThreads, 'get').mockRejectedValueOnce(new Error('Synthetic cache read failure'));
    await act(async () => { await expect(result.current.addMessage(thread.id, message)).resolves.toBeUndefined(); });
    expect(warn).toHaveBeenCalledWith('useChats: message saved, but refreshing its cache failed', expect.any(Error));
    read.mockRestore();
    expect((await db.chatThreads.get(thread.id))?.messages).toEqual([message]);
    expect(result.current.threads[0].messages).toEqual([message]);
  });

  it('uses the persisted pruned message list for React state after commit', async () => {
    const messages = Array.from({ length: 2000 }, (_, index) => ({ ...message, id: `prior-${index}` }));
    await db.chatThreads.update(thread.id, { messages });
    const { result } = renderHook(() => useChats());
    await waitFor(() => expect(result.current.loadedSuccessfully).toBe(true));
    await act(async () => { await result.current.addMessage(thread.id, message); });
    const saved = await db.chatThreads.get(thread.id);
    expect(saved?.messages).toHaveLength(2000);
    expect(saved?.messages.slice(0, 3).map(row => row.id)).toEqual(['prior-0', 'prior-1', 'prior-3']);
    expect(result.current.threads[0].messages).toEqual(saved?.messages);
    expect(result.current.threads[0].messages.at(-1)).toEqual(message);
  });
});
