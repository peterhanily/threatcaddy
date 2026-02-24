import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { Timeline } from '../types';
import { nanoid } from 'nanoid';

export function useTimelines() {
  const [timelines, setTimelines] = useState<Timeline[]>([]);

  const loadTimelines = useCallback(async () => {
    const all = await db.timelines.toArray();
    setTimelines(all.sort((a, b) => a.order - b.order));
  }, []);

  useEffect(() => {
    loadTimelines();
  }, [loadTimelines]);

  const createTimeline = useCallback(async (name: string, description?: string, color?: string): Promise<Timeline> => {
    const maxOrder = timelines.reduce((max, t) => Math.max(max, t.order), 0);
    const now = Date.now();
    const timeline: Timeline = {
      id: nanoid(),
      name,
      description,
      color,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    await db.timelines.add(timeline);
    setTimelines((prev) => [...prev, timeline].sort((a, b) => a.order - b.order));
    return timeline;
  }, [timelines]);

  const updateTimeline = useCallback(async (id: string, updates: Partial<Timeline>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    await db.timelines.update(id, patched);
    setTimelines((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patched } : t)).sort((a, b) => a.order - b.order)
    );
  }, []);

  const deleteTimeline = useCallback(async (id: string) => {
    const all = await db.timelines.toArray();
    if (all.length <= 1) return;
    await db.transaction('rw', [db.timelines, db.timelineEvents], async () => {
      await db.timelines.delete(id);
      await db.timelineEvents.where('timelineId').equals(id).delete();
    });
    setTimelines((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    timelines,
    createTimeline,
    updateTimeline,
    deleteTimeline,
    reload: loadTimelines,
  };
}
