import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../db';
import { syncSnapshot } from '../lib/server-api';
import type {
  Note,
  Task,
  TimelineEvent,
  Whiteboard,
  StandaloneIOC,
  ChatThread,
  InvestigationDataMode,
} from '../types';

export interface InvestigationData {
  notes: Note[];
  tasks: Task[];
  events: TimelineEvent[];
  whiteboards: Whiteboard[];
  iocs: StandaloneIOC[];
  chats: ChatThread[];
  loading: boolean;
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
  loading: false,
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the current folderId to avoid stale updates from in-flight requests
  const activeFolderRef = useRef(folderId);
  activeFolderRef.current = folderId;

  const clearData = useCallback(() => {
    setNotes([]);
    setTasks([]);
    setEvents([]);
    setWhiteboards([]);
    setIOCs([]);
    setChats([]);
  }, []);

  const loadLocal = useCallback(async (id: string) => {
    const [n, t, e, w, i, c] = await Promise.all([
      db.notes.where('folderId').equals(id).toArray(),
      db.tasks.where('folderId').equals(id).toArray(),
      db.timelineEvents.where('folderId').equals(id).toArray(),
      db.whiteboards.where('folderId').equals(id).toArray(),
      db.standaloneIOCs.where('folderId').equals(id).toArray(),
      db.chatThreads.where('folderId').equals(id).toArray(),
    ]);

    // Filter out trashed and archived entities
    const filterActive = <T extends { trashed: boolean; archived: boolean }>(arr: T[]): T[] =>
      arr.filter((item) => !item.trashed && !item.archived);

    if (activeFolderRef.current !== id) return;

    setNotes(filterActive(n));
    setTasks(filterActive(t));
    setEvents(filterActive(e));
    setWhiteboards(filterActive(w));
    setIOCs(filterActive(i));
    setChats(filterActive(c));
  }, []);

  const loadRemote = useCallback(async (id: string) => {
    const snapshot = await syncSnapshot(id);

    if (activeFolderRef.current !== id) return;

    const filterActive = <T extends { trashed?: boolean; archived?: boolean }>(arr: T[]): T[] =>
      arr.filter((item) => !item.trashed && !item.archived);

    setNotes(filterActive((snapshot.notes ?? []) as Note[]));
    setTasks(filterActive((snapshot.tasks ?? []) as Task[]));
    setEvents(filterActive((snapshot.timelineEvents ?? []) as TimelineEvent[]));
    setWhiteboards(filterActive((snapshot.whiteboards ?? []) as Whiteboard[]));
    setIOCs(filterActive((snapshot.standaloneIOCs ?? []) as StandaloneIOC[]));
    setChats(filterActive((snapshot.chatThreads ?? []) as ChatThread[]));
  }, []);

  const load = useCallback(async () => {
    if (!folderId) {
      clearData();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (mode === 'remote') {
        await loadRemote(folderId);
      } else {
        await loadLocal(folderId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load investigation data';
      setError(message);
      clearData();
    } finally {
      setLoading(false);
    }
  }, [folderId, mode, loadLocal, loadRemote, clearData]);

  useEffect(() => {
    load();
  }, [load]);

  return folderId
    ? {
        notes,
        tasks,
        events,
        whiteboards,
        iocs,
        chats,
        loading,
        error,
        refresh: load,
        isRemote: mode === 'remote',
      }
    : EMPTY;
}
