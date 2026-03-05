/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChats } from '../hooks/useChats';
import { db } from '../db';

describe('useChats', () => {
  beforeEach(async () => {
    await db.chatThreads.clear();
  });

  it('starts with empty threads', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});
    expect(result.current.threads).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('creates a thread with defaults', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let thread: Awaited<ReturnType<typeof result.current.createThread>>;
    await act(async () => {
      thread = await result.current.createThread();
    });

    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].title).toBe('New Chat');
    expect(result.current.threads[0].model).toBe('claude-sonnet-4-6');
    expect(result.current.threads[0].provider).toBe('anthropic');
    expect(result.current.threads[0].messages).toEqual([]);
    expect(result.current.threads[0].tags).toEqual([]);
    expect(result.current.threads[0].trashed).toBe(false);
    expect(result.current.threads[0].archived).toBe(false);
    expect(thread!.id).toBeTruthy();
  });

  it('creates a thread with overrides', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    await act(async () => {
      await result.current.createThread({
        title: 'Custom Thread',
        model: 'gpt-4o',
        provider: 'openai',
        tags: ['test'],
      });
    });

    expect(result.current.threads[0].title).toBe('Custom Thread');
    expect(result.current.threads[0].model).toBe('gpt-4o');
    expect(result.current.threads[0].provider).toBe('openai');
    expect(result.current.threads[0].tags).toEqual(['test']);
  });

  it('persists threads to IndexedDB', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    await act(async () => {
      await result.current.createThread({ title: 'Persisted' });
    });

    const stored = await db.chatThreads.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('Persisted');
  });

  it('updates a thread and re-sorts by updatedAt', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let t1Id: string;
    await act(async () => {
      const t1 = await result.current.createThread({ title: 'First' });
      t1Id = t1.id;
    });
    await act(async () => {
      await result.current.createThread({ title: 'Second' });
    });

    // Second should be first (most recent)
    expect(result.current.threads[0].title).toBe('Second');

    // Update first thread — it should move to the top
    // Small delay ensures updatedAt is strictly greater than Second's timestamp
    await new Promise(r => setTimeout(r, 5));
    await act(async () => {
      await result.current.updateThread(t1Id!, { title: 'First Updated' });
    });

    expect(result.current.threads[0].title).toBe('First Updated');
  });

  it('adds a message to a thread', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let threadId: string;
    await act(async () => {
      const t = await result.current.createThread();
      threadId = t.id;
    });

    await act(async () => {
      await result.current.addMessage(threadId!, {
        id: 'msg-1',
        role: 'user',
        content: 'Hello world',
        createdAt: Date.now(),
      });
    });

    expect(result.current.threads[0].messages).toHaveLength(1);
    expect(result.current.threads[0].messages[0].content).toBe('Hello world');
  });

  it('auto-titles from first user message', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let threadId: string;
    await act(async () => {
      const t = await result.current.createThread();
      threadId = t.id;
    });

    expect(result.current.threads[0].title).toBe('New Chat');

    await act(async () => {
      await result.current.addMessage(threadId!, {
        id: 'msg-1',
        role: 'user',
        content: 'Help me analyze this malware sample',
        createdAt: Date.now(),
      });
    });

    expect(result.current.threads[0].title).toBe('Help me analyze this malware sample');
  });

  it('does not re-title if title was already changed', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let threadId: string;
    await act(async () => {
      const t = await result.current.createThread({ title: 'Custom Title' });
      threadId = t.id;
    });

    await act(async () => {
      await result.current.addMessage(threadId!, {
        id: 'msg-1',
        role: 'user',
        content: 'First message',
        createdAt: Date.now(),
      });
    });

    expect(result.current.threads[0].title).toBe('Custom Title');
  });

  it('deletes a thread permanently', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let threadId: string;
    await act(async () => {
      const t = await result.current.createThread();
      threadId = t.id;
    });
    expect(result.current.threads).toHaveLength(1);

    await act(async () => {
      await result.current.deleteThread(threadId!);
    });

    expect(result.current.threads).toHaveLength(0);
    const stored = await db.chatThreads.toArray();
    expect(stored).toHaveLength(0);
  });

  it('trashes and restores a thread', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let threadId: string;
    await act(async () => {
      const t = await result.current.createThread();
      threadId = t.id;
    });

    await act(async () => {
      await result.current.trashThread(threadId!);
    });

    expect(result.current.threads[0].trashed).toBe(true);
    expect(result.current.threads[0].trashedAt).toBeGreaterThan(0);

    await act(async () => {
      await result.current.restoreThread(threadId!);
    });

    expect(result.current.threads[0].trashed).toBe(false);
  });

  it('toggles archive on a thread', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let threadId: string;
    await act(async () => {
      const t = await result.current.createThread();
      threadId = t.id;
    });

    await act(async () => {
      await result.current.toggleArchiveThread(threadId!);
    });

    expect(result.current.threads[0].archived).toBe(true);

    await act(async () => {
      await result.current.toggleArchiveThread(threadId!);
    });

    expect(result.current.threads[0].archived).toBe(false);
  });

  it('empties trash threads', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let t2Id: string;
    await act(async () => {
      await result.current.createThread({ title: 'Keep' });
      const t2 = await result.current.createThread({ title: 'Trash Me' });
      t2Id = t2.id;
    });

    await act(async () => {
      await result.current.trashThread(t2Id!);
    });

    await act(async () => {
      await result.current.emptyTrashThreads();
    });

    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].title).toBe('Keep');
  });

  it('filters threads by active status', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let tId: string;
    await act(async () => {
      await result.current.createThread({ title: 'Active' });
      const t = await result.current.createThread({ title: 'Trashed' });
      tId = t.id;
    });

    await act(async () => {
      await result.current.trashThread(tId!);
    });

    const active = result.current.getFilteredThreads({});
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe('Active');
  });

  it('filters threads by trashed status', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let tId: string;
    await act(async () => {
      await result.current.createThread({ title: 'Active' });
      const t = await result.current.createThread({ title: 'Trashed' });
      tId = t.id;
    });

    await act(async () => {
      await result.current.trashThread(tId!);
    });

    const trashed = result.current.getFilteredThreads({ showTrashed: true });
    expect(trashed).toHaveLength(1);
    expect(trashed[0].title).toBe('Trashed');
  });

  it('filters threads by archived status', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let tId: string;
    await act(async () => {
      await result.current.createThread({ title: 'Active' });
      const t = await result.current.createThread({ title: 'Archived' });
      tId = t.id;
    });

    await act(async () => {
      await result.current.toggleArchiveThread(tId!);
    });

    const archived = result.current.getFilteredThreads({ showArchived: true });
    expect(archived).toHaveLength(1);
    expect(archived[0].title).toBe('Archived');
  });

  it('filters threads by folderId', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    await act(async () => {
      await result.current.createThread({ title: 'Folder A', folderId: 'f1' });
      await result.current.createThread({ title: 'Folder B', folderId: 'f2' });
    });

    const filtered = result.current.getFilteredThreads({ folderId: 'f1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Folder A');
  });

  it('computes threadCounts correctly', async () => {
    const { result } = renderHook(() => useChats());
    await act(async () => {});

    let trashId: string;
    let archiveId: string;
    await act(async () => {
      await result.current.createThread({ title: 'Active 1' });
      await result.current.createThread({ title: 'Active 2' });
      const t = await result.current.createThread({ title: 'Trashed' });
      trashId = t.id;
      const a = await result.current.createThread({ title: 'Archived' });
      archiveId = a.id;
    });

    await act(async () => {
      await result.current.trashThread(trashId!);
      await result.current.toggleArchiveThread(archiveId!);
    });

    expect(result.current.threadCounts.total).toBe(2);
    expect(result.current.threadCounts.trashed).toBe(1);
    expect(result.current.threadCounts.archived).toBe(1);
  });

  it('auto-purges old trashed threads on load', async () => {
    // Manually insert a thread that was trashed 31 days ago
    const oldThread = {
      id: 'old-trashed',
      title: 'Old Trash',
      messages: [],
      model: 'claude-sonnet-4-6',
      provider: 'anthropic' as const,
      tags: [],
      trashed: true,
      trashedAt: Date.now() - 31 * 86400000,
      archived: false,
      createdAt: Date.now() - 60 * 86400000,
      updatedAt: Date.now() - 31 * 86400000,
    };
    await db.chatThreads.add(oldThread);

    const { result } = renderHook(() => useChats());
    await act(async () => {});

    // Old trashed thread should have been purged
    expect(result.current.threads.find(t => t.id === 'old-trashed')).toBeUndefined();
    const stored = await db.chatThreads.get('old-trashed');
    expect(stored).toBeUndefined();
  });
});
