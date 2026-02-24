import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { TimelineEvent, TimelineEventType } from '../types';
import { nanoid } from 'nanoid';

export function useTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    const all = await db.timelineEvents.toArray();
    setEvents(all);
    setLoading(false);
  }, []);

  useEffect(() => {
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...partial,
    };
    await db.timelineEvents.add(event);
    setEvents((prev) => [event, ...prev]);
    return event;
  }, []);

  const updateEvent = useCallback(async (id: string, updates: Partial<TimelineEvent>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    await db.timelineEvents.update(id, patched);
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patched } : e)));
  }, []);

  const deleteEvent = useCallback(async (id: string) => {
    await db.timelineEvents.delete(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

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
    }) => {
      let filtered = events;

      if (opts.timelineId) {
        filtered = filtered.filter((e) => e.timelineId === opts.timelineId);
      }

      if (opts.eventTypes && opts.eventTypes.length > 0) {
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
        filtered = filtered.filter((e) => e.tags.includes(opts.tag!));
      }

      if (opts.starred) {
        filtered = filtered.filter((e) => e.starred);
      }

      if (opts.dateStart) {
        filtered = filtered.filter((e) => e.timestamp >= opts.dateStart!);
      }

      if (opts.dateEnd) {
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

  const eventCounts = {
    total: events.length,
    starred: events.filter((e) => e.starred).length,
  };

  return {
    events,
    loading,
    createEvent,
    updateEvent,
    deleteEvent,
    toggleStar,
    getFilteredEvents,
    eventCounts,
    reload: loadEvents,
  };
}
