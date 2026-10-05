import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { db } from '../db';
import { syncSnapshot } from '../lib/server-api';
import { sanitizeSyncBatch } from '../lib/sync-sanitize';
import type {
  Note,
  Task,
  TimelineEvent,
  Whiteboard,
  StandaloneIOC,
  ChatThread,
  EvidenceItem,
  InvestigationDataMode,
} from '../types';

export interface InvestigationData {
  notes: Note[];
  tasks: Task[];
  events: TimelineEvent[];
  whiteboards: Whiteboard[];
  iocs: StandaloneIOC[];
  chats: ChatThread[];
  evidence: EvidenceItem[];
  loading: boolean;
  loadedSuccessfully: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isRemote: boolean;
}

const EMPTY: InvestigationData = {
  notes: [],
  tasks: [],
  events: [],
  whiteboards: [],
  iocs: [],
  chats: [],
  evidence: [],
  loading: false,
  loadedSuccessfully: false,
  error: null,
  refresh: async () => {},
  isRemote: false,
};

export function useInvestigationData(
  folderId: string | null,
  mode: InvestigationDataMode,
): InvestigationData {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [whiteboards, setWhiteboards] = useState<Whiteboard[]>([]);
  const [iocs, setIOCs] = useState<StandaloneIOC[]>([]);
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fence success, failure and loading updates across scope/mode changes,
  // concurrent refreshes and unmount (not just successful responses).
  const requestVersion = useRef(0);
  const scope = useMemo(() => ({ folderId, mode }), [folderId, mode]);
  const [successfulScope, setSuccessfulScope] = useState<typeof scope | null>(null);
  const activeScope = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    ++requestVersion.current;
    return () => { activeScope.current = null; };
  }, [scope]);

  const clearData = useCallback(() => {
    setNotes([]);
    setTasks([]);
    setEvents([]);
    setWhiteboards([]);
    setIOCs([]);
    setChats([]);
    setEvidence([]);
  }, []);

  const loadLocal = useCallback(async (id: string, current: () => boolean) => {
    const [n, t, e, w, i, c, ev] = await Promise.all([
      db.notes.where('folderId').equals(id).toArray(),
      db.tasks.where('folderId').equals(id).toArray(),
      db.timelineEvents.where('folderId').equals(id).toArray(),
      db.whiteboards.where('folderId').equals(id).toArray(),
      db.standaloneIOCs.where('folderId').equals(id).toArray(),
      db.chatThreads.where('folderId').equals(id).toArray(),
      db.evidenceItems.where('folderId').equals(id).toArray(),
    ]);

    // Filter out trashed and archived entities
    const filterActive = <T extends { trashed: boolean; archived: boolean }>(arr: T[]): T[] =>
      arr.filter((item) => !item.trashed && !item.archived);

    if (!current()) return;

    setNotes(filterActive(n));
    setTasks(filterActive(t));
    setEvents(filterActive(e));
    setWhiteboards(filterActive(w));
    setIOCs(filterActive(i));
    setChats(filterActive(c));
    setEvidence(filterActive(ev));
  }, []);

  const loadRemote = useCallback(async (id: string, current: () => boolean) => {
    const raw = await syncSnapshot(id);
    const snapshot = Object.fromEntries(Object.entries(raw).map(([table, rows]) => [table,
      sanitizeSyncBatch(table, rows as Record<string, unknown>[])]));

    if (!current()) return;

    const filterActive = <T extends { trashed?: boolean; archived?: boolean }>(arr: T[]): T[] =>
      arr.filter((item) => !item.trashed && !item.archived);

    setNotes(filterActive((snapshot.notes ?? []) as unknown as Note[]));
    setTasks(filterActive((snapshot.tasks ?? []) as unknown as Task[]));
    setEvents(filterActive((snapshot.timelineEvents ?? []) as unknown as TimelineEvent[]));
    setWhiteboards(filterActive((snapshot.whiteboards ?? []) as unknown as Whiteboard[]));
    setIOCs(filterActive((snapshot.standaloneIOCs ?? []) as unknown as StandaloneIOC[]));
    setChats(filterActive((snapshot.chatThreads ?? []) as unknown as ChatThread[]));
    setEvidence(filterActive((snapshot.evidenceItems ?? []) as unknown as EvidenceItem[]));
  }, []);

  const load = useCallback(async () => {
    // A consumer may retain refresh across navigation/unmount. Such a callback
    // must not promote its old folder/mode to the newest request owner.
    if (activeScope.current !== scope) return;
    const request = ++requestVersion.current;
    const current = () => activeScope.current === scope && requestVersion.current === request;
    setSuccessfulScope(null);
    if (!folderId) {
      clearData();
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (mode === 'remote') {
        await loadRemote(folderId, current);
      } else {
        await loadLocal(folderId, current);
      }
      if (current()) setSuccessfulScope(scope);
    } catch (err) {
      if (!current()) return;
      setSuccessfulScope(null);
      const message = err instanceof Error ? err.message : 'Failed to load investigation data';
      setError(message);
      clearData();
    } finally {
      if (current()) setLoading(false);
    }
  }, [folderId, mode, loadLocal, loadRemote, clearData, scope]);

  useEffect(() => {
    clearData();
    void load();
  }, [load, clearData]);

  return folderId
    ? {
        notes,
        tasks,
        events,
        whiteboards,
        iocs,
        chats,
        evidence,
        loading,
        // Scope equality invalidates readiness in the first render after navigation,
        // before the loading effect runs. A failed read is never an empty success.
        loadedSuccessfully: successfulScope === scope && !loading && error === null,
        error,
        refresh: load,
        isRemote: mode === 'remote',
      }
    : EMPTY;
}
