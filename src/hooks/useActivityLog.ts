import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { ActivityLogEntry, ActivityCategory, ActivityAction } from '../types';
import { nanoid } from 'nanoid';

const MAX_ENTRIES = 1000;

export function useActivityLog() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);

  // Load entries on mount, trim to MAX_ENTRIES
  useEffect(() => {
    (async () => {
      const all = await db.activityLog.orderBy('timestamp').reverse().toArray();
      if (all.length > MAX_ENTRIES) {
        const toRemove = all.slice(MAX_ENTRIES);
        await db.activityLog.bulkDelete(toRemove.map((e) => e.id));
        setEntries(all.slice(0, MAX_ENTRIES));
      } else {
        setEntries(all);
      }
    })();
  }, []);

  const log = useCallback(async (
    category: ActivityCategory,
    action: ActivityAction,
    detail: string,
    itemId?: string,
    itemTitle?: string,
  ) => {
    const entry: ActivityLogEntry = {
      id: nanoid(),
      action,
      category,
      detail,
      itemId,
      itemTitle,
      timestamp: Date.now(),
    };
    await db.activityLog.add(entry);
    setEntries((prev) => {
      const next = [entry, ...prev];
      return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
    });
  }, []);

  const clear = useCallback(async () => {
    await db.activityLog.clear();
    setEntries([]);
  }, []);

  const getFiltered = useCallback((opts: { category?: ActivityCategory; search?: string }) => {
    let filtered = entries;
    if (opts.category) {
      filtered = filtered.filter((e) => e.category === opts.category);
    }
    if (opts.search) {
      const lower = opts.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          (typeof e.detail === 'string' && e.detail.toLowerCase().includes(lower)) ||
          (typeof e.itemTitle === 'string' && e.itemTitle.toLowerCase().includes(lower))
      );
    }
    return filtered;
  }, [entries]);

  return { entries, log, clear, getFiltered };
}
