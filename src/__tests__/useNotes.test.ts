/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import { useNotes } from '../hooks/useNotes';
import { db } from '../db';

describe('useNotes', () => {
  beforeEach(async () => {
    await db.notes.clear();
  });

  it('starts with empty notes', async () => {
    const { result } = renderHook(() => useNotes());
    // Wait for initial load
    await act(async () => {});
    expect(result.current.notes).toEqual([]);
  });

  it('loads preexisting notes and finishes loading under real StrictMode replay', async () => {
    await db.notes.add({
      id: 'strict-mode-note', title: 'Preexisting note', content: 'Persisted content', tags: [],
      pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1,
    });
    const { result } = renderHook(() => useNotes(), {
      wrapper: ({ children }) => createElement(StrictMode, null, children),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notes).toEqual([expect.objectContaining({ id: 'strict-mode-note', content: 'Persisted content' })]);
  });

  it('suppresses a late load after unmount', async () => {
    let finish!: (notes: []) => void;
    const read = vi.spyOn(db.notes, 'toArray').mockReturnValueOnce(new Promise<[]>((resolve) => { finish = resolve; }) as ReturnType<typeof db.notes.toArray>);
    try {
      const { result, unmount } = renderHook(() => useNotes());
      unmount();
      await act(async () => { finish([]); });
      expect(result.current.loading).toBe(true);
    } finally { read.mockRestore(); }
  });

  it('rejects a save to a missing note without recreating it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});
      await expect(result.current.updateNote('deleted-note', { content: 'Retained draft' })).rejects.toThrow('no longer exists');
      expect(await db.notes.get('deleted-note')).toBeUndefined();
    } finally { log.mockRestore(); }
  });

  it('creates a note with defaults', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});

    await act(async () => {
      await result.current.createNote();
    });

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].title).toBe('Untitled Note');
    expect(result.current.notes[0].content).toBe('');
    expect(result.current.notes[0].tags).toEqual([]);
    expect(result.current.notes[0].pinned).toBe(false);
    expect(result.current.notes[0].trashed).toBe(false);
    expect(result.current.notes[0].archived).toBe(false);
  });

  it('creates a note with partial overrides', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});

    await act(async () => {
      await result.current.createNote({ title: 'My Note', content: '# Hello', tags: ['test'] });
    });

    expect(result.current.notes[0].title).toBe('My Note');
    expect(result.current.notes[0].content).toBe('# Hello');
    expect(result.current.notes[0].tags).toEqual(['test']);
  });

  it('persists notes to IndexedDB', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});

    await act(async () => {
      await result.current.createNote({ title: 'Persisted' });
    });

    const stored = await db.notes.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('Persisted');
  });

  it('publishes a custom atomic creation only after its persistence promise commits', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});
    let finish!: () => void;
    const committed = new Promise<void>(resolve => { finish = resolve; });
    const persist = vi.fn(async (note: Parameters<typeof db.notes.add>[0]) => {
      await committed;
      await db.notes.add(note);
    });
    let saved!: ReturnType<typeof result.current.createNote>;
    act(() => { saved = result.current.createNote({ title: 'Atomic product', content: 'Reviewed content' }, persist); });
    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(result.current.notes).toEqual([]);
    expect(await db.notes.count()).toBe(0);
    await act(async () => { finish(); await saved; });
    expect(result.current.notes).toEqual([expect.objectContaining({ title: 'Atomic product', content: 'Reviewed content' })]);
    expect(await db.notes.count()).toBe(1);
  });

  it('retains no phantom note when custom atomic persistence rejects', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});
      const persist = vi.fn().mockRejectedValue(new Error('Source classification changed'));
      await expect(result.current.createNote({ title: 'Rejected product' }, persist)).rejects.toThrow('classification changed');
      expect(result.current.notes).toEqual([]);
      expect(await db.notes.count()).toBe(0);
    } finally { errorLog.mockRestore(); }
  });

  it('updates a note', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});

    await act(async () => {
      await result.current.createNote({ title: 'Original' });
    });
    const id = result.current.notes[0].id;

    await act(async () => {
      await result.current.updateNote(id, { title: 'Updated' });
    });

    expect(result.current.notes[0].title).toBe('Updated');
    const stored = await db.notes.get(id);
    expect(stored!.title).toBe('Updated');
  });

  it('deletes a note', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});

    await act(async () => {
      await result.current.createNote({ title: 'Doomed' });
    });
    const id = result.current.notes[0].id;

    await act(async () => {
      await result.current.deleteNote(id);
    });

    expect(result.current.notes).toHaveLength(0);
    const stored = await db.notes.get(id);
    expect(stored).toBeUndefined();
  });

  it('trashes and restores a note', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});

    await act(async () => {
      await result.current.createNote({ title: 'Trash Me' });
    });
    const id = result.current.notes[0].id;

    await act(async () => {
      await result.current.trashNote(id);
    });
    expect(result.current.notes[0].trashed).toBe(true);
    expect(result.current.notes[0].trashedAt).toBeGreaterThan(0);

    await act(async () => {
      await result.current.restoreNote(id);
    });
    expect(result.current.notes[0].trashed).toBe(false);
    expect(result.current.notes[0].trashedAt).toBeUndefined();
  });

  it('toggles pin', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});

    await act(async () => {
      await result.current.createNote({ title: 'Pin Me' });
    });
    const id = result.current.notes[0].id;
    expect(result.current.notes[0].pinned).toBe(false);

    await act(async () => {
      await result.current.togglePin(id);
    });
    expect(result.current.notes[0].pinned).toBe(true);

    await act(async () => {
      await result.current.togglePin(id);
    });
    expect(result.current.notes[0].pinned).toBe(false);
  });

  it('toggles archive', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});

    await act(async () => {
      await result.current.createNote({ title: 'Archive Me' });
    });
    const id = result.current.notes[0].id;

    await act(async () => {
      await result.current.toggleArchive(id);
    });
    expect(result.current.notes[0].archived).toBe(true);

    await act(async () => {
      await result.current.toggleArchive(id);
    });
    expect(result.current.notes[0].archived).toBe(false);
  });

  it('empties trash', async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {});

    await act(async () => {
      await result.current.createNote({ title: 'Normal' });
      await result.current.createNote({ title: 'Trash 1' });
      await result.current.createNote({ title: 'Trash 2' });
    });

    const id1 = result.current.notes.find((n) => n.title === 'Trash 1')!.id;
    const id2 = result.current.notes.find((n) => n.title === 'Trash 2')!.id;

    await act(async () => {
      await result.current.trashNote(id1);
      await result.current.trashNote(id2);
    });

    await act(async () => {
      await result.current.emptyTrash();
    });

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].title).toBe('Normal');
  });

  describe('getFilteredNotes', () => {
    it('excludes trashed and archived by default', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({ title: 'Active' });
        await result.current.createNote({ title: 'Trashed', trashed: true, trashedAt: Date.now() });
        await result.current.createNote({ title: 'Archived', archived: true });
      });

      const filtered = result.current.getFilteredNotes({});
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Active');
    });

    it('shows only trashed when showTrashed', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({ title: 'Active' });
        await result.current.createNote({ title: 'Trashed', trashed: true, trashedAt: Date.now() });
      });

      const filtered = result.current.getFilteredNotes({ showTrashed: true });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Trashed');
    });

    it('shows only archived when showArchived', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({ title: 'Active' });
        await result.current.createNote({ title: 'Archived', archived: true });
      });

      const filtered = result.current.getFilteredNotes({ showArchived: true });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Archived');
    });

    it('filters by folderId', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({ title: 'In Folder', folderId: 'f1' });
        await result.current.createNote({ title: 'No Folder' });
        await result.current.createNote({ title: 'Other Folder', folderId: 'f2' });
      });

      const filtered = result.current.getFilteredNotes({ folderId: 'f1' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('In Folder');
    });

    it('excludes folder IDs', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({ title: 'Normal' });
        await result.current.createNote({ title: 'Clips', folderId: 'clips-id' });
      });

      const filtered = result.current.getFilteredNotes({ excludeFolderIds: ['clips-id'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Normal');
    });

    it('filters by tag', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({ title: 'Tagged', tags: ['important'] });
        await result.current.createNote({ title: 'Untagged' });
      });

      const filtered = result.current.getFilteredNotes({ tag: 'important' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Tagged');
    });

    it('filters by search text', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({ title: 'React Guide', content: 'Learn React hooks' });
        await result.current.createNote({ title: 'Vue Guide', content: 'Learn Vue composition' });
      });

      const filtered = result.current.getFilteredNotes({ search: 'react' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('React Guide');
    });

    it('filters by IOC types', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({ title: 'Has IPs', iocTypes: ['ipv4'] });
        await result.current.createNote({ title: 'Has Domains', iocTypes: ['domain'] });
        await result.current.createNote({ title: 'No IOCs' });
      });

      const filtered = result.current.getFilteredNotes({ iocTypes: ['ipv4'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Has IPs');
    });

    it('sorts by updatedAt desc by default', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      const now = Date.now();
      await act(async () => {
        await result.current.createNote({ title: 'Old', updatedAt: now - 2000, createdAt: now - 2000 });
        await result.current.createNote({ title: 'New', updatedAt: now, createdAt: now });
        await result.current.createNote({ title: 'Mid', updatedAt: now - 1000, createdAt: now - 1000 });
      });

      const filtered = result.current.getFilteredNotes({});
      expect(filtered.map((n) => n.title)).toEqual(['New', 'Mid', 'Old']);
    });

    it('sorts by title asc', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({ title: 'Charlie' });
        await result.current.createNote({ title: 'Alice' });
        await result.current.createNote({ title: 'Bob' });
      });

      const filtered = result.current.getFilteredNotes({ sort: 'title', sortDir: 'asc' });
      expect(filtered.map((n) => n.title)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('always places pinned notes first', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      const now = Date.now();
      await act(async () => {
        await result.current.createNote({ title: 'Unpinned New', updatedAt: now });
        await result.current.createNote({ title: 'Pinned Old', pinned: true, updatedAt: now - 5000 });
      });

      const filtered = result.current.getFilteredNotes({});
      expect(filtered[0].title).toBe('Pinned Old');
      expect(filtered[1].title).toBe('Unpinned New');
    });

    it('sorts by IOC count', async () => {
      const { result } = renderHook(() => useNotes());
      await act(async () => {});

      await act(async () => {
        await result.current.createNote({
          title: 'Few IOCs',
          iocAnalysis: { extractedAt: Date.now(), iocs: [
            { id: '1', type: 'ipv4', value: '1.2.3.4', confidence: 'high', firstSeen: Date.now(), dismissed: false },
          ] },
        });
        await result.current.createNote({
          title: 'Many IOCs',
          iocAnalysis: { extractedAt: Date.now(), iocs: [
            { id: '2', type: 'ipv4', value: '5.6.7.8', confidence: 'high', firstSeen: Date.now(), dismissed: false },
            { id: '3', type: 'domain', value: 'evil.com', confidence: 'high', firstSeen: Date.now(), dismissed: false },
            { id: '4', type: 'md5', value: 'a'.repeat(32), confidence: 'medium', firstSeen: Date.now(), dismissed: false },
          ] },
        });
        await result.current.createNote({ title: 'No IOCs' });
      });

      const filtered = result.current.getFilteredNotes({ sort: 'iocCount' });
      expect(filtered.map((n) => n.title)).toEqual(['Many IOCs', 'Few IOCs', 'No IOCs']);
    });
  });
});
