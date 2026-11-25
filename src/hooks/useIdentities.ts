import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { db } from '../db';
import i18n from '../i18n';
import type { Identity } from '../types';
import { purgeOldTrash } from '../lib/trash-purge';
import { deleteEntitiesWithReferences } from '../lib/entity-relations';
import { deleteCheckpointsFor } from '../lib/checkpoints';
import { compactHeldChangesFor } from '../lib/sync-outgoing';
import { sameText } from '../lib/identity-model';
import { mergeIdentities as mergeIdentityRecords } from '../lib/merge-identities';

/** Whether two names are the same name (case and spacing aside). */
const sameName = (a: string, b: string) => sameText(a) === sameText(b);

/** Manages the people, organizations, systems and accounts recorded in investigations. */
export function useIdentities(folderId?: string) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const scope = useMemo(() => ({ folderId }), [folderId]);
  const [loadState, setLoadState] = useState({ scope, loading: true, loadedSuccessfully: false });
  const activeScopeRef = useRef<typeof scope | null>(null);
  const loadRequestRef = useRef<symbol | null>(null);

  useLayoutEffect(() => {
    activeScopeRef.current = scope;
    return () => { activeScopeRef.current = null; loadRequestRef.current = null; };
  }, [scope]);

  const loadIdentities = useCallback(async () => {
    if (activeScopeRef.current !== scope) return;
    const request = Symbol('identities-load');
    loadRequestRef.current = request;
    const current = () => activeScopeRef.current === scope && loadRequestRef.current === request;
    setLoadState({ scope, loading: true, loadedSuccessfully: false });
    try {
      const all = folderId
        ? await db.identities.where('folderId').equals(folderId).toArray()
        : await db.identities.toArray();
      if (!current()) return;
      const remaining = await purgeOldTrash(all, db.identities);
      if (!current()) return;
      setIdentities(remaining.sort((a, b) => b.updatedAt - a.updatedAt));
      setLoadState({ scope, loading: false, loadedSuccessfully: true });
    } catch (err) {
      if (current()) {
        console.error('Failed to load identities:', err);
        setLoadState({ scope, loading: false, loadedSuccessfully: false });
      }
    }
  }, [folderId, scope]);

  useEffect(() => {
    // Initial IndexedDB hydration intentionally updates loading/data state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadIdentities();
  }, [loadIdentities]);

  const createIdentity = useCallback(async (partial?: Partial<Identity>): Promise<Identity> => {
    const { getCurrentUserName } = await import('../lib/utils');
    const now = Date.now();
    const identity: Identity = {
      id: nanoid(),
      type: 'person',
      name: '',
      aliases: [],
      details: [],
      connections: [],
      tags: [],
      trashed: false,
      archived: false,
      createdBy: partial?.createdBy || getCurrentUserName(),
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    await db.identities.add(identity);
    setIdentities((prev) => [identity, ...prev]);
    return identity;
  }, []);

  /** A rename keeps the old name as another name, so earlier mentions still match. `updates`
   * may be computed from the stored row, so changes made in quick succession build on each other. */
  const updateIdentity = useCallback(async (id: string, updates: Partial<Identity> | ((current: Identity) => Partial<Identity>)) => {
    const updated = await db.transaction('rw', db.identities, db.checkpoints, async () => {
      const existing = await db.identities.get(id);
      if (!existing) return undefined;
      const patched: Partial<Identity> = { ...(typeof updates === 'function' ? updates(existing) : updates), updatedAt: Date.now() };
      const name = patched.name;
      if (name !== undefined && !sameName(name, existing.name)) {
        const aliases = (patched.aliases ?? existing.aliases).filter(alias => !sameName(alias, name));
        if (existing.name.trim() && !aliases.some(alias => sameName(alias, existing.name))) aliases.push(existing.name);
        patched.aliases = aliases;
      }
      await db.identities.update(id, patched);
      // An AI undo checkpoint of this identity can no longer apply once it is edited, and keeps a
      // copy of details since removed (a private phone edited out): it goes (PRIV-1).
      await deleteCheckpointsFor(new Map([['identities', new Set([id])]]));
      return patched;
    });
    if (updated) {
      setIdentities((prev) => prev.map((identity) => (identity.id === id ? { ...identity, ...updated } : identity)));
      // Held for a server that does not sync identities: the earlier copy is not kept (PRIV-2).
      void compactHeldChangesFor(new Map([['identities', new Set([id])]]));
      return;
    }
    // Deleted or merged elsewhere (another tab, a teammate): drop it from view and say the save failed.
    setIdentities((prev) => prev.filter((identity) => identity.id !== id));
    throw new Error(i18n.t('error.notFound', { ns: 'common' }));
  }, []);

  /** Also removes every connection that points to it. */
  const deleteIdentity = useCallback(async (id: string) => {
    await deleteEntitiesWithReferences({ identities: [id] });
    await loadIdentities();
  }, [loadIdentities]);

  const trashIdentity = useCallback(async (id: string) => {
    await updateIdentity(id, { trashed: true, trashedAt: Date.now() });
  }, [updateIdentity]);

  const restoreIdentity = useCallback(async (id: string) => {
    await updateIdentity(id, { trashed: false, trashedAt: undefined });
  }, [updateIdentity]);

  const toggleArchiveIdentity = useCallback(async (id: string) => {
    const identity = identities.find((candidate) => candidate.id === id);
    if (identity) await updateIdentity(id, { archived: !identity.archived });
  }, [identities, updateIdentity]);

  const emptyTrashIdentities = useCallback(async () => {
    const trashedIds = identities.filter((identity) => identity.trashed).map((identity) => identity.id);
    if (trashedIds.length === 0) return;
    await deleteEntitiesWithReferences({ identities: trashedIds });
    await loadIdentities();
  }, [identities, loadIdentities]);

  /**
   * Folds `goneId` into `keepId` and deletes it, in one transaction. The kept identity
   * gains the other's names, details, connections and tags, and links to the removed
   * one now point to it. The more serious status, the stricter classification and any
   * privacy marking are kept. Only identities in the same investigation can be merged.
   */
  const mergeIdentities = useCallback(async (keepId: string, goneId: string) => {
    await mergeIdentityRecords(keepId, goneId);
    await loadIdentities();
  }, [loadIdentities]);

  return {
    identities,
    loading: loadState.scope !== scope || loadState.loading,
    loadedSuccessfully: loadState.scope === scope && loadState.loadedSuccessfully,
    createIdentity,
    updateIdentity,
    deleteIdentity,
    trashIdentity,
    restoreIdentity,
    toggleArchiveIdentity,
    emptyTrashIdentities,
    mergeIdentities,
    reload: loadIdentities,
  };
}
