import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../db';
import type { StandaloneIOC } from '../types';
import { nanoid } from 'nanoid';
import { purgeOldTrash } from '../lib/trash-purge';

/** Manages standalone IOCs stored in IndexedDB -- create, update, bulk import, trash, and tag operations. */
export function useStandaloneIOCs() {
  const [iocs, setIOCs] = useState<StandaloneIOC[]>([]);
  const [loading, setLoading] = useState(true);

  const loadIOCs = useCallback(async () => {
    const all = await db.standaloneIOCs.toArray();
    const remaining = await purgeOldTrash(all, db.standaloneIOCs);
    setIOCs(remaining.sort((a, b) => b.createdAt - a.createdAt));
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadIOCs();
  }, [loadIOCs]);

  const createIOC = useCallback(async (partial?: Partial<StandaloneIOC>): Promise<StandaloneIOC> => {
    const now = Date.now();
    const ioc: StandaloneIOC = {
      id: nanoid(),
      type: 'ipv4',
      value: '',
      confidence: 'medium',
      tags: [],
      trashed: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    await db.standaloneIOCs.add(ioc);
    setIOCs((prev) => [ioc, ...prev]);
    return ioc;
  }, []);

  const updateIOC = useCallback(async (id: string, updates: Partial<StandaloneIOC>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    await db.standaloneIOCs.update(id, patched);
    setIOCs((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...patched } : i))
    );
  }, []);

  const deleteIOC = useCallback(async (id: string) => {
    await db.standaloneIOCs.delete(id);
    setIOCs((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const trashIOC = useCallback(async (id: string) => {
    await updateIOC(id, { trashed: true, trashedAt: Date.now() });
  }, [updateIOC]);

  const restoreIOC = useCallback(async (id: string) => {
    await updateIOC(id, { trashed: false, trashedAt: undefined });
  }, [updateIOC]);

  const toggleArchiveIOC = useCallback(async (id: string) => {
    const ioc = iocs.find((i) => i.id === id);
    if (ioc) await updateIOC(id, { archived: !ioc.archived });
  }, [iocs, updateIOC]);

  const emptyTrashIOCs = useCallback(async () => {
    const trashedIds = iocs.filter((i) => i.trashed).map((i) => i.id);
    if (trashedIds.length === 0) return;
    await db.standaloneIOCs.bulkDelete(trashedIds);
    setIOCs((prev) => prev.filter((i) => !i.trashed));
  }, [iocs]);

  const getFilteredIOCs = useCallback(
    (opts: { folderId?: string; tag?: string; type?: string; showTrashed?: boolean; showArchived?: boolean }) => {
      let filtered = iocs;

      if (opts.showTrashed) {
        filtered = filtered.filter((i) => i.trashed);
      } else if (opts.showArchived) {
        filtered = filtered.filter((i) => i.archived && !i.trashed);
      } else {
        filtered = filtered.filter((i) => !i.trashed && !i.archived);
      }

      if (opts.folderId) {
        filtered = filtered.filter((i) => i.folderId === opts.folderId);
      }
      if (opts.tag) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        filtered = filtered.filter((i) => i.tags.includes(opts.tag!));
      }
      if (opts.type) {
        filtered = filtered.filter((i) => i.type === opts.type);
      }
      return filtered;
    },
    [iocs]
  );

  const iocCounts = useMemo(() => ({
    total: iocs.filter((i) => !i.trashed && !i.archived).length,
    trashed: iocs.filter((i) => i.trashed).length,
    archived: iocs.filter((i) => i.archived && !i.trashed).length,
  }), [iocs]);

  return {
    iocs,
    loading,
    createIOC,
    updateIOC,
    deleteIOC,
    trashIOC,
    restoreIOC,
    toggleArchiveIOC,
    emptyTrashIOCs,
    getFilteredIOCs,
    iocCounts,
    reload: loadIOCs,
  };
}
