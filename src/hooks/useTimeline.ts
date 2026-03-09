import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../db';
import type { TimelineEvent, TimelineEventType } from '../types';
import { nanoid } from 'nanoid';
import { purgeOldTrash } from '../lib/trash-purge';

export function useTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    const all = await db.timelineEvents.toArray();
    const remaining = await purgeOldTrash(all, db.timelineEvents);
    setEvents(remaining);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvents();
  }, [loadEvents]);

  const createEvent = useCallback(async (partial?: Partial<TimelineEvent>): Promise<TimelineEvent> => {
    const event: TimelineEvent = {
      id: nanoid(),
      timestamp: Date.now(),
      title: '',
      eventType: 'other',
      source: '',
      confidence: 'low',
      linkedIOCIds: [],
      linkedNoteIds: [],
      linkedTaskIds: [],
      mitreAttackIds: [],
      assets: [],
      tags: [],
      starred: false,
      timelineId: '',
      trashed: false,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...partial,
    };
    try {
      await db.timelineEvents.add(event);
    } catch (err) {
      console.error('Failed to create timeline event:', err);
      throw err;
    }
    setEvents((prev) => [event, ...prev]);
    return event;
  }, []);

  const updateEvent = useCallback(async (id: string, updates: Partial<TimelineEvent>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    try {
      await db.timelineEvents.update(id, patched);
    } catch (err) {
      console.error('Failed to update timeline event:', err);
      throw err;
    }
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patched } : e)));
  }, []);

  const deleteEvent = useCallback(async (id: string) => {
    try {
      await db.timelineEvents.delete(id);
      // Batch orphan link cleanup: collect affected entities then update in bulk
      const [linkedNotes, linkedTasks] = await Promise.all([
        db.notes.toArray().then(items => items.filter(n => n.linkedTimelineEventIds?.includes(id))),
        db.tasks.toArray().then(items => items.filter(t => t.linkedTimelineEventIds?.includes(id))),
      ]);
      const ops: Promise<unknown>[] = [];
      for (const n of linkedNotes) {
        ops.push(db.notes.update(n.id, { linkedTimelineEventIds: (n.linkedTimelineEventIds ?? []).filter(eid => eid !== id) }));
      }
      for (const t of linkedTasks) {
        ops.push(db.tasks.update(t.id, { linkedTimelineEventIds: (t.linkedTimelineEventIds ?? []).filter(eid => eid !== id) }));
      }
      await Promise.all(ops);
    } catch (err) {
      console.error('Failed to delete timeline event:', err);
      throw err;
    }
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const trashEvent = useCallback(async (id: string) => {
    await updateEvent(id, { trashed: true, trashedAt: Date.now() });
  }, [updateEvent]);

  const restoreEvent = useCallback(async (id: string) => {
    await updateEvent(id, { trashed: false, trashedAt: undefined });
  }, [updateEvent]);

  const toggleArchiveEvent = useCallback(async (id: string) => {
    const event = events.find((e) => e.id === id);
    if (event) await updateEvent(id, { archived: !event.archived });
  }, [events, updateEvent]);

  const emptyTrashEvents = useCallback(async () => {
    const trashedIds = events.filter((e) => e.trashed).map((e) => e.id);
    if (trashedIds.length === 0) return;
    try {
      await db.timelineEvents.bulkDelete(trashedIds);
      // Batch orphan link cleanup in a single pass per table
      const idSet = new Set(trashedIds);
      const [allNotes, allTasks] = await Promise.all([
        db.notes.toArray(),
        db.tasks.toArray(),
      ]);
      const ops: Promise<unknown>[] = [];
      for (const n of allNotes) {
        if (n.linkedTimelineEventIds?.some(eid => idSet.has(eid))) {
          ops.push(db.notes.update(n.id, { linkedTimelineEventIds: (n.linkedTimelineEventIds ?? []).filter(eid => !idSet.has(eid)) }));
        }
      }
      for (const t of allTasks) {
        if (t.linkedTimelineEventIds?.some(eid => idSet.has(eid))) {
          ops.push(db.tasks.update(t.id, { linkedTimelineEventIds: (t.linkedTimelineEventIds ?? []).filter(eid => !idSet.has(eid)) }));
        }
      }
      await Promise.all(ops);
    } catch (err) {
      console.error('Failed to empty event trash:', err);
      throw err;
    }
    setEvents((prev) => prev.filter((e) => !e.trashed));
  }, [events]);

  const toggleStar = useCallback(async (id: string) => {
    const event = events.find((e) => e.id === id);
    if (event) await updateEvent(id, { starred: !event.starred });
  }, [events, updateEvent]);

  const getFilteredEvents = useCallback(
    (opts: {
      eventTypes?: TimelineEventType[];
      source?: string;
      folderId?: string;
      timelineId?: string;
      tag?: string;
      starred?: boolean;
      dateStart?: number;
      dateEnd?: number;
      search?: string;
      sortDir?: 'asc' | 'desc';
      showTrashed?: boolean;
      showArchived?: boolean;
    }) => {
      let filtered = events;

      if (opts.showTrashed) {
        filtered = filtered.filter((e) => e.trashed);
      } else if (opts.showArchived) {
        filtered = filtered.filter((e) => e.archived && !e.trashed);
      } else {
        filtered = filtered.filter((e) => !e.trashed && !e.archived);
      }

      if (opts.timelineId) {
        filtered = filtered.filter((e) => e.timelineId === opts.timelineId);
      }

      if (opts.eventTypes && opts.eventTypes.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        filtered = filtered.filter((e) => opts.eventTypes!.includes(e.eventType));
      }

      if (opts.source) {
        const lower = opts.source.toLowerCase();
        filtered = filtered.filter((e) => e.source.toLowerCase().includes(lower));
      }

      if (opts.folderId) {
        filtered = filtered.filter((e) => e.folderId === opts.folderId);
      }

      if (opts.tag) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        filtered = filtered.filter((e) => e.tags.includes(opts.tag!));
      }

      if (opts.starred) {
        filtered = filtered.filter((e) => e.starred);
      }

      if (opts.dateStart) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        filtered = filtered.filter((e) => e.timestamp >= opts.dateStart!);
      }

      if (opts.dateEnd) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        filtered = filtered.filter((e) => e.timestamp <= opts.dateEnd!);
      }

      if (opts.search) {
        const lower = opts.search.toLowerCase();
        filtered = filtered.filter(
          (e) =>
            e.title.toLowerCase().includes(lower) ||
            (e.description?.toLowerCase().includes(lower) ?? false) ||
            e.source.toLowerCase().includes(lower)
        );
      }

      const dir = opts.sortDir || 'desc';
      filtered.sort((a, b) => {
        if (a.starred !== b.starred) return a.starred ? -1 : 1;
        return dir === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
      });

      return filtered;
    },
    [events]
  );

  const eventCounts = useMemo(() => {
    const active = events.filter((e) => !e.trashed && !e.archived);
    return {
      total: active.length,
      starred: active.filter((e) => e.starred).length,
      trashed: events.filter((e) => e.trashed).length,
      archived: events.filter((e) => e.archived && !e.trashed).length,
    };
  }, [events]);

  return {
    events,
    loading,
    createEvent,
    updateEvent,
    deleteEvent,
    trashEvent,
    restoreEvent,
    toggleArchiveEvent,
    emptyTrashEvents,
    toggleStar,
    getFilteredEvents,
    eventCounts,
    reload: loadEvents,
  };
}
