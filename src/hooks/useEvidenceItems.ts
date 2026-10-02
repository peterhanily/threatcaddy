import { useCallback, useEffect, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { EvidenceItem } from '../types';
import { purgeOldTrash } from '../lib/trash-purge';
import { deleteEntitiesWithReferences } from '../lib/entity-relations';

/** Manages imported evidence source material stored separately from notes. */
export function useEvidenceItems(folderId?: string) {
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvidenceItems = useCallback(async () => {
    try {
      const all = folderId
        ? await db.evidenceItems.where('folderId').equals(folderId).toArray()
        : await db.evidenceItems.toArray();
      const remaining = await purgeOldTrash(all, db.evidenceItems);
      setEvidenceItems(remaining.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (err) {
      console.error('Failed to load evidence:', err);
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    // Initial IndexedDB hydration intentionally updates loading/data state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvidenceItems();
  }, [loadEvidenceItems]);

  const createEvidenceItem = useCallback(async (partial?: Partial<EvidenceItem>): Promise<EvidenceItem> => {
    const { getCurrentUserName } = await import('../lib/utils');
    const now = Date.now();
    const item: EvidenceItem = {
      id: nanoid(),
      title: 'Untitled Evidence',
      fileName: 'unknown',
      fileType: 'unknown',
      size: 0,
      content: '',
      extractionStatus: 'metadata-only',
      importedAt: now,
      chunkIndex: 1,
      chunkCount: 1,
      tags: [],
      trashed: false,
      archived: false,
      createdBy: partial?.createdBy || getCurrentUserName(),
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    await db.evidenceItems.add(item);
    setEvidenceItems((prev) => [item, ...prev]);
    return item;
  }, []);

  const updateEvidenceItem = useCallback(async (id: string, updates: Partial<EvidenceItem>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    await db.evidenceItems.update(id, patched);
    setEvidenceItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patched } : item)));
  }, []);

  const deleteEvidenceItem = useCallback(async (id: string) => {
    await deleteEntitiesWithReferences({ evidenceItems: [id] });
    setEvidenceItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const trashEvidenceItem = useCallback(async (id: string) => {
    await updateEvidenceItem(id, { trashed: true, trashedAt: Date.now() });
  }, [updateEvidenceItem]);

  const restoreEvidenceItem = useCallback(async (id: string) => {
    await updateEvidenceItem(id, { trashed: false, trashedAt: undefined });
  }, [updateEvidenceItem]);

  const toggleArchiveEvidenceItem = useCallback(async (id: string) => {
    const item = evidenceItems.find((candidate) => candidate.id === id);
    if (item) await updateEvidenceItem(id, { archived: !item.archived });
  }, [evidenceItems, updateEvidenceItem]);

  const emptyTrashEvidenceItems = useCallback(async () => {
    const trashedIds = evidenceItems.filter((item) => item.trashed).map((item) => item.id);
    if (trashedIds.length === 0) return;
    await deleteEntitiesWithReferences({ evidenceItems: trashedIds });
    setEvidenceItems((prev) => prev.filter((item) => !item.trashed));
  }, [evidenceItems]);

  const getFilteredEvidenceItems = useCallback(
    (opts: { folderId?: string; tag?: string; showTrashed?: boolean; showArchived?: boolean }) => {
      let filtered = evidenceItems;

      if (opts.showTrashed) {
        filtered = filtered.filter((item) => item.trashed);
      } else if (opts.showArchived) {
        filtered = filtered.filter((item) => item.archived && !item.trashed);
      } else {
        filtered = filtered.filter((item) => !item.trashed && !item.archived);
      }

      if (opts.folderId) {
        filtered = filtered.filter((item) => item.folderId === opts.folderId);
      }
      const tag = opts.tag;
      if (tag) {
        filtered = filtered.filter((item) => item.tags.includes(tag));
      }
      return filtered;
    },
    [evidenceItems],
  );

  const evidenceCounts = useMemo(() => ({
    total: evidenceItems.filter((item) => !item.trashed && !item.archived).length,
    trashed: evidenceItems.filter((item) => item.trashed).length,
    archived: evidenceItems.filter((item) => item.archived && !item.trashed).length,
  }), [evidenceItems]);

  return {
    evidenceItems,
    loading,
    createEvidenceItem,
    updateEvidenceItem,
    deleteEvidenceItem,
    trashEvidenceItem,
    restoreEvidenceItem,
    toggleArchiveEvidenceItem,
    emptyTrashEvidenceItems,
    getFilteredEvidenceItems,
    evidenceCounts,
    reload: loadEvidenceItems,
  };
}
