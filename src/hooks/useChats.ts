import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { db } from '../db';
import type { ChatThread, ChatMessage } from '../types';
import { nanoid } from 'nanoid';
import { purgeOldTrash } from '../lib/trash-purge';

/** Ensure the DB connection is open (handles v14→v15 upgrade on first call). */
async function ensureDB() {
  if (!db.isOpen()) {
    await db.open();
  }
}

/** Manages CaddyAI chat threads -- create, rename, add messages, trash/restore. Returns threads array and mutation helpers. */
export function useChats() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(true);
  // Cache of thread messages keyed by thread id (used for search)
  const messagesCacheRef = useRef<Map<string, ChatMessage[]>>(new Map());

  const loadThreads = useCallback(async () => {
    try {
      await ensureDB();
      const all = await db.chatThreads.toArray();
      const remaining = await purgeOldTrash(all, db.chatThreads);
      const cache = messagesCacheRef.current;
      for (const thread of remaining) {
        cache.set(thread.id, thread.messages);
      }
      // Clean up stale cache entries
      const activeIds = new Set(remaining.map(t => t.id));
      for (const id of cache.keys()) {
        if (!activeIds.has(id)) cache.delete(id);
      }
      setThreads(remaining.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (err) {
      console.warn('useChats: failed to load threads', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadThreads();
  }, [loadThreads]);

  const createThread = useCallback(async (partial?: Partial<ChatThread>): Promise<ChatThread> => {
    await ensureDB();
    const now = Date.now();
    const thread: ChatThread = {
      id: nanoid(),
      title: 'New Chat',
      messages: [],
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      tags: [],
      trashed: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    await db.chatThreads.add(thread);
    messagesCacheRef.current.set(thread.id, thread.messages);
    setThreads((prev) => [thread, ...prev]);
    return thread;
  }, []);

  const updateThread = useCallback(async (id: string, updates: Partial<ChatThread>) => {
    await ensureDB();
    const patched = { ...updates, updatedAt: Date.now() };
    await db.chatThreads.update(id, patched);
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patched } : t))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    );
  }, []);

  const addMessage = useCallback(async (threadId: string, message: ChatMessage) => {
    await ensureDB();
    const now = Date.now();

    // Read current thread to determine auto-title
    const currentThread = await db.chatThreads.get(threadId);
    if (!currentThread) return;

    const newMessages = [...currentThread.messages, message];
    const updates: Partial<ChatThread> = { messages: newMessages, updatedAt: now };
    // Auto-title from first user message
    if (currentThread.title === 'New Chat' && message.role === 'user') {
      updates.title = message.content.substring(0, 60).replace(/\n/g, ' ') || 'New Chat';
    }

    // Write to DB using modify() to avoid full clone-and-replace
    await db.chatThreads.where('id').equals(threadId).modify((t: ChatThread) => {
      t.messages.push(message);
      t.updatedAt = now;
      if (updates.title) t.title = updates.title!;
    });

    // Update messages cache
    messagesCacheRef.current.set(threadId, newMessages);

    // Optimistic update React state
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, ...updates } : t))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    );
  }, []);

  const deleteThread = useCallback(async (id: string) => {
    await ensureDB();
    await db.chatThreads.delete(id);
    messagesCacheRef.current.delete(id);
    setThreads((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const trashThread = useCallback(async (id: string) => {
    await updateThread(id, { trashed: true, trashedAt: Date.now() });
  }, [updateThread]);

  const restoreThread = useCallback(async (id: string) => {
    await updateThread(id, { trashed: false, trashedAt: undefined });
  }, [updateThread]);

  const toggleArchiveThread = useCallback(async (id: string) => {
    const thread = threads.find((t) => t.id === id);
    if (thread) await updateThread(id, { archived: !thread.archived });
  }, [threads, updateThread]);

  const emptyTrashThreads = useCallback(async () => {
    const trashedIds = threads.filter((t) => t.trashed).map((t) => t.id);
    if (trashedIds.length === 0) return;
    await ensureDB();
    await db.chatThreads.bulkDelete(trashedIds);
    setThreads((prev) => prev.filter((t) => !t.trashed));
  }, [threads]);

  const getFilteredThreads = useCallback(
    (opts: { folderId?: string; showTrashed?: boolean; showArchived?: boolean }) => {
      let filtered = threads;
      if (opts.showTrashed) {
        filtered = filtered.filter((t) => t.trashed);
      } else if (opts.showArchived) {
        filtered = filtered.filter((t) => t.archived && !t.trashed);
      } else {
        filtered = filtered.filter((t) => !t.trashed && !t.archived);
      }
      if (opts.folderId) {
        filtered = filtered.filter((t) => t.folderId === opts.folderId);
      }
      return filtered;
    },
    [threads]
  );

  const threadCounts = useMemo(() => ({
    total: threads.filter((t) => !t.trashed && !t.archived).length,
    trashed: threads.filter((t) => t.trashed).length,
    archived: threads.filter((t) => t.archived && !t.trashed).length,
  }), [threads]);

  return {
    threads,
    loading,
    createThread,
    updateThread,
    addMessage,
    deleteThread,
    trashThread,
    restoreThread,
    toggleArchiveThread,
    emptyTrashThreads,
    getFilteredThreads,
    threadCounts,
    reload: loadThreads,
  };
}
