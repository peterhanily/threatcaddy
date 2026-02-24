import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTags } from '../hooks/useTags';
import { db } from '../db';
import { TAG_COLORS } from '../types';

describe('useTags', () => {
  beforeEach(async () => {
    await db.tags.clear();
    await db.notes.clear();
    await db.tasks.clear();
    await db.timelineEvents.clear();
    await db.whiteboards.clear();
  });

  it('starts with empty tags', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});
    expect(result.current.tags).toEqual([]);
  });

  it('creates a tag with auto-cycling color', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('work');
    });

    expect(result.current.tags).toHaveLength(1);
    expect(result.current.tags[0].name).toBe('work');
    expect(result.current.tags[0].color).toBe(TAG_COLORS[0]);
  });

  it('creates a tag with explicit color', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('urgent', '#ff0000');
    });

    expect(result.current.tags[0].color).toBe('#ff0000');
  });

  it('deduplicates tags by name (case-insensitive)', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('Work');
    });

    let dup: Awaited<ReturnType<typeof result.current.createTag>>;
    await act(async () => {
      dup = await result.current.createTag('work');
    });

    expect(result.current.tags).toHaveLength(1);
    expect(dup!.name).toBe('Work'); // returns existing
  });

  it('persists tags to IndexedDB', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('persisted');
    });

    const stored = await db.tags.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('persisted');
  });

  it('updates a tag', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('old-name');
    });
    const id = result.current.tags[0].id;

    await act(async () => {
      await result.current.updateTag(id, { color: '#ef4444' });
    });

    expect(result.current.tags[0].color).toBe('#ef4444');
  });

  it('propagates tag rename to notes', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('old-tag');
    });
    const tagId = result.current.tags[0].id;

    // Add a note with that tag
    await db.notes.add({
      id: 'n1', title: 'Tagged note', content: '', tags: ['old-tag'],
      pinned: false, archived: false, trashed: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    await act(async () => {
      await result.current.updateTag(tagId, { name: 'new-tag' });
    });

    const note = await db.notes.get('n1');
    expect(note!.tags).toEqual(['new-tag']);
  });

  it('propagates tag rename to tasks', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('old-tag');
    });
    const tagId = result.current.tags[0].id;

    await db.tasks.add({
      id: 't1', title: 'Tagged task', tags: ['old-tag'],
      completed: false, priority: 'none', status: 'todo',
      order: 1, createdAt: Date.now(), updatedAt: Date.now(),
    });

    await act(async () => {
      await result.current.updateTag(tagId, { name: 'new-tag' });
    });

    const task = await db.tasks.get('t1');
    expect(task!.tags).toEqual(['new-tag']);
  });

  it('propagates tag rename to timeline events', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('old-tag');
    });
    const tagId = result.current.tags[0].id;

    await db.timelineEvents.add({
      id: 'e1', timestamp: Date.now(), title: 'Event', eventType: 'other',
      source: '', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [],
      linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: ['old-tag'],
      starred: false, timelineId: 'tl1', createdAt: Date.now(), updatedAt: Date.now(),
    });

    await act(async () => {
      await result.current.updateTag(tagId, { name: 'new-tag' });
    });

    const event = await db.timelineEvents.get('e1');
    expect(event!.tags).toEqual(['new-tag']);
  });

  it('propagates tag rename to whiteboards', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('old-tag');
    });
    const tagId = result.current.tags[0].id;

    await db.whiteboards.add({
      id: 'w1', name: 'Board', elements: '[]', tags: ['old-tag'],
      order: 0, createdAt: Date.now(), updatedAt: Date.now(),
    });

    await act(async () => {
      await result.current.updateTag(tagId, { name: 'new-tag' });
    });

    const wb = await db.whiteboards.get('w1');
    expect(wb!.tags).toEqual(['new-tag']);
  });

  it('renames only the target tag in a multi-tag array', async () => {
    const { result } = renderHook(() => useTags());
    await act(async () => {});

    await act(async () => {
      await result.current.createTag('alpha');
      await result.current.createTag('beta');
    });
    const alphaId = result.current.tags.find((t) => t.name === 'alpha')!.id;

    await db.notes.add({
      id: 'n1', title: 'Multi-tag', content: '', tags: ['alpha', 'beta'],
      pinned: false, archived: false, trashed: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    await act(async () => {
      await result.current.updateTag(alphaId, { name: 'gamma' });
    });

    const note = await db.notes.get('n1');
    expect(note!.tags).toEqual(['gamma', 'beta']);
  });

  describe('deleteTag', () => {
    it('removes the tag', async () => {
      const { result } = renderHook(() => useTags());
      await act(async () => {});

      await act(async () => {
        await result.current.createTag('doomed');
      });
      const id = result.current.tags[0].id;

      await act(async () => {
        await result.current.deleteTag(id);
      });

      expect(result.current.tags).toHaveLength(0);
    });

    it('removes tag from notes', async () => {
      const { result } = renderHook(() => useTags());
      await act(async () => {});

      await act(async () => {
        await result.current.createTag('remove-me');
      });
      const tagId = result.current.tags[0].id;

      await db.notes.add({
        id: 'n1', title: 'Note', content: '', tags: ['remove-me', 'keep-me'],
        pinned: false, archived: false, trashed: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteTag(tagId);
      });

      const note = await db.notes.get('n1');
      expect(note!.tags).toEqual(['keep-me']);
    });

    it('removes tag from tasks', async () => {
      const { result } = renderHook(() => useTags());
      await act(async () => {});

      await act(async () => {
        await result.current.createTag('remove-me');
      });
      const tagId = result.current.tags[0].id;

      await db.tasks.add({
        id: 't1', title: 'Task', tags: ['remove-me', 'keep-me'],
        completed: false, priority: 'none', status: 'todo',
        order: 1, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteTag(tagId);
      });

      const task = await db.tasks.get('t1');
      expect(task!.tags).toEqual(['keep-me']);
    });

    it('removes tag from timeline events', async () => {
      const { result } = renderHook(() => useTags());
      await act(async () => {});

      await act(async () => {
        await result.current.createTag('remove-me');
      });
      const tagId = result.current.tags[0].id;

      await db.timelineEvents.add({
        id: 'e1', timestamp: Date.now(), title: 'Event', eventType: 'other',
        source: '', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [],
        linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: ['remove-me', 'keep-me'],
        starred: false, timelineId: 'tl1', createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteTag(tagId);
      });

      const event = await db.timelineEvents.get('e1');
      expect(event!.tags).toEqual(['keep-me']);
    });

    it('removes tag from whiteboards', async () => {
      const { result } = renderHook(() => useTags());
      await act(async () => {});

      await act(async () => {
        await result.current.createTag('remove-me');
      });
      const tagId = result.current.tags[0].id;

      await db.whiteboards.add({
        id: 'w1', name: 'Board', elements: '[]', tags: ['remove-me', 'keep-me'],
        order: 0, createdAt: Date.now(), updatedAt: Date.now(),
      });

      await act(async () => {
        await result.current.deleteTag(tagId);
      });

      const wb = await db.whiteboards.get('w1');
      expect(wb!.tags).toEqual(['keep-me']);
    });
  });
});
