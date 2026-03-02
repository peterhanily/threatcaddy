/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelines } from '../hooks/useTimelines';
import { db } from '../db';

describe('useTimelines', () => {
  beforeEach(async () => {
    await db.timelines.clear();
    await db.timelineEvents.clear();
  });

  it('starts with empty timelines', async () => {
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});
    expect(result.current.timelines).toEqual([]);
  });

  it('creates a timeline with name', async () => {
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});

    await act(async () => {
      await result.current.createTimeline('Incident Alpha');
    });

    expect(result.current.timelines).toHaveLength(1);
    expect(result.current.timelines[0].name).toBe('Incident Alpha');
    expect(result.current.timelines[0].id).toBeDefined();
    expect(result.current.timelines[0].createdAt).toBeDefined();
    expect(result.current.timelines[0].updatedAt).toBeDefined();
  });

  it('creates a timeline with description and color', async () => {
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});

    await act(async () => {
      await result.current.createTimeline('Incident Beta', 'A phishing campaign', '#ef4444');
    });

    expect(result.current.timelines[0].name).toBe('Incident Beta');
    expect(result.current.timelines[0].description).toBe('A phishing campaign');
    expect(result.current.timelines[0].color).toBe('#ef4444');
  });

  it('persists to IndexedDB', async () => {
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});

    await act(async () => {
      await result.current.createTimeline('Persisted');
    });

    const stored = await db.timelines.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Persisted');
  });

  it('auto-increments order', async () => {
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});

    await act(async () => {
      await result.current.createTimeline('First');
    });
    expect(result.current.timelines[0].order).toBe(1);

    await act(async () => {
      await result.current.createTimeline('Second');
    });
    expect(result.current.timelines[1].order).toBe(2);

    await act(async () => {
      await result.current.createTimeline('Third');
    });
    expect(result.current.timelines[2].order).toBe(3);
  });

  it('sorts timelines by order', async () => {
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});

    await act(async () => {
      await result.current.createTimeline('Alpha');
    });
    await act(async () => {
      await result.current.createTimeline('Beta');
    });

    const betaId = result.current.timelines[1].id;
    await act(async () => {
      await result.current.updateTimeline(betaId, { order: 0 });
    });

    expect(result.current.timelines[0].name).toBe('Beta');
    expect(result.current.timelines[1].name).toBe('Alpha');
  });

  it('updates a timeline', async () => {
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});

    await act(async () => {
      await result.current.createTimeline('Original');
    });
    const id = result.current.timelines[0].id;

    await act(async () => {
      await result.current.updateTimeline(id, { name: 'Renamed' });
    });

    expect(result.current.timelines[0].name).toBe('Renamed');

    const stored = await db.timelines.get(id);
    expect(stored!.name).toBe('Renamed');
    expect(stored!.updatedAt).toBeGreaterThanOrEqual(stored!.createdAt);
  });

  it('deletes a timeline and cascades to events', async () => {
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});

    await act(async () => {
      await result.current.createTimeline('Doomed');
    });
    const timelineId = result.current.timelines[0].id;

    // Add a timeline event linked to this timeline
    await db.timelineEvents.add({
      id: 'e1', title: 'Event in timeline', timestamp: Date.now(),
      eventType: 'other', source: '', confidence: 'low',
      linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: [], starred: false,
      trashed: false, archived: false,
      timelineId, createdAt: Date.now(), updatedAt: Date.now(),
    });

    await act(async () => {
      await result.current.deleteTimeline(timelineId);
    });

    expect(result.current.timelines).toHaveLength(0);

    // Verify the event was cascade-deleted
    const event = await db.timelineEvents.get('e1');
    expect(event).toBeUndefined();
  });

  it('deletes a timeline and removes db.timelineEvents entries', async () => {
    const { result } = renderHook(() => useTimelines());
    await act(async () => {});

    await act(async () => {
      await result.current.createTimeline('Timeline A');
    });
    await act(async () => {
      await result.current.createTimeline('Timeline B');
    });
    const timelineAId = result.current.timelines[0].id;
    const timelineBId = result.current.timelines[1].id;

    // Add events to both timelines
    await db.timelineEvents.add({
      id: 'e-a', title: 'Event A', timestamp: Date.now(),
      eventType: 'other', source: '', confidence: 'low',
      linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: [], starred: false,
      trashed: false, archived: false,
      timelineId: timelineAId, createdAt: Date.now(), updatedAt: Date.now(),
    });
    await db.timelineEvents.add({
      id: 'e-b', title: 'Event B', timestamp: Date.now(),
      eventType: 'other', source: '', confidence: 'low',
      linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: [], starred: false,
      trashed: false, archived: false,
      timelineId: timelineBId, createdAt: Date.now(), updatedAt: Date.now(),
    });

    await act(async () => {
      await result.current.deleteTimeline(timelineAId);
    });

    // Event from deleted timeline should be gone
    const eventA = await db.timelineEvents.get('e-a');
    expect(eventA).toBeUndefined();

    // Event from other timeline should remain
    const eventB = await db.timelineEvents.get('e-b');
    expect(eventB).toBeDefined();
    expect(eventB!.timelineId).toBe(timelineBId);
  });
});
