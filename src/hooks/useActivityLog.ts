import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { ActivityLogEntry, ActivityCategory, ActivityAction } from '../types';
import { nanoid } from 'nanoid';

const RETENTION_DAYS = 30;

export function useActivityLog() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);

  // Load entries on mount, prune anything older than 30 days
  useEffect(() => {
    (async () => {
      const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
      // Use toArray() (goes through DBCore query handler → decrypts).
      // Avoid orderBy().reverse() which may use openCursor and bypass
      // the encryption middleware's query-level decryption.
      const all = await db.activityLog.toArray();
      const kept: ActivityLogEntry[] = [];
      const expiredIds: string[] = [];
      for (const entry of all) {
        if (entry.timestamp >= cutoff) {
          kept.push(entry);
        } else {
          expiredIds.push(entry.id);
        }
      }
      if (expiredIds.length > 0) {
        await db.activityLog.bulkDelete(expiredIds);
      }
      kept.sort((a, b) => b.timestamp - a.timestamp);
      // Cap in-memory entries to prevent excessive state size
      setEntries(kept.length > 5000 ? kept.slice(0, 5000) : kept);
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
    setEntries((prev) => [entry, ...prev]);
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
