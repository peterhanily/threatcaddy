import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { AppLayout } from './components/Layout/AppLayout';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { NoteList } from './components/Notes/NoteList';
import { NoteEditor } from './components/Notes/NoteEditor';
import { TaskListView } from './components/Tasks/TaskList';
const TimelineView = lazy(() => import('./components/Timeline/TimelineView').then(m => ({ default: m.TimelineView })));
const WhiteboardView = lazy(() => import('./components/Whiteboard/WhiteboardView').then(m => ({ default: m.WhiteboardView })));
const ActivityLogView = lazy(() => import('./components/Activity/ActivityLogView').then(m => ({ default: m.ActivityLogView })));
import { QuickCapture } from './components/Clips/QuickCapture';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { useNotes } from './hooks/useNotes';
import { useTasks } from './hooks/useTasks';
import { useTimeline } from './hooks/useTimeline';
import { useTimelines } from './hooks/useTimelines';
import { useWhiteboards } from './hooks/useWhiteboards';
import { useStandaloneIOCs } from './hooks/useStandaloneIOCs';
import { useChats } from './hooks/useChats';
import { useFolders } from './hooks/useFolders';
import { useTags } from './hooks/useTags';
import { useSettings } from './hooks/useSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useActivityLog } from './hooks/useActivityLog';
import { ActivityLogContext } from './hooks/ActivityLogContext';
import { ScreenshareContext } from './hooks/ScreenshareContext';
import { getEffectiveClsLevels, isAboveClsThreshold } from './lib/classification';
import type { ViewMode, SortOption, EditorMode, Note, Task, TimelineEvent, TaskViewMode, IOCType, StandaloneIOC, ChatThread } from './types';
import { DEFAULT_QUICK_LINKS } from './types';
const DashboardView = lazy(() => import('./components/Dashboard/DashboardView').then(m => ({ default: m.DashboardView })));
import { FileText } from 'lucide-react';
import { cn } from './lib/utils';
import { exportJSON, importJSON, downloadFile, exportInvestigationJSON } from './lib/export';
import { ConfirmDialog } from './components/Common/ConfirmDialog';
import { SearchOverlay } from './components/Search/SearchOverlay';
import { extractIOCs, mergeIOCAnalysis } from './lib/ioc-extractor';
import { generateSampleInvestigation, isSampleEntity } from './lib/sample-investigation';
import { db } from './db';
import { ErrorBoundary } from './components/Common/ErrorBoundary';
import { ActiveFilterBar } from './components/Common/ActiveFilterBar';
import { InvestigationDetailPanel } from './components/Investigation/InvestigationDetailPanel';
import type { InvestigationStatus } from './types';
const GraphView = lazy(() => import('./components/Graph/GraphView').then(m => ({ default: m.GraphView })));
const ChatView = lazy(() => import('./components/Chat/ChatView').then(m => ({ default: m.ChatView })));
const IOCStatsView = lazy(() => import('./components/Analysis/IOCStatsView').then(m => ({ default: m.IOCStatsView })));
import { StandaloneIOCForm } from './components/Analysis/StandaloneIOCForm';
import { StandaloneIOCList } from './components/Analysis/StandaloneIOCList';
const TrashArchiveView = lazy(() => import('./components/TrashArchive/TrashArchiveView').then(m => ({ default: m.TrashArchiveView })));
import type { LayoutName } from './components/Graph/GraphCanvas';
import { useNavigationHistory } from './hooks/useNavigationHistory';
import type { NavState } from './hooks/useNavigationHistory';
import { useTour } from './hooks/useTour';
import { TourOverlay, TourGlow } from './components/Tour/TourOverlay';
import { TourTooltip } from './components/Tour/TourTooltip';
import { DemoWelcomeModal } from './components/Common/DemoWelcomeModal';
import { DataImportModal } from './components/Import/DataImportModal';
import type { ImportResult } from './lib/data-import';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { ToastContainer } from './components/Common/Toast';
import { generateInvestigationReport } from './lib/report';
import { useIsMobile } from './hooks/useIsMobile';
const ExecDashboard = lazy(() => import('./components/ExecMode/ExecDashboard').then(m => ({ default: m.ExecDashboard })));
import { ShareReceiver } from './components/ExecMode/ShareReceiver';
import { ShareDialog } from './components/ExecMode/ShareDialog';
import type { SharePayload, InvestigationBundle } from './lib/share';
import { AuthProvider, useAuth } from './contexts/AuthContext';
const CaddyShackView = lazy(() => import('./components/CaddyShack/CaddyShackView').then(m => ({ default: m.CaddyShackView })));
import { ConflictDialog } from './components/Common/ConflictDialog';
import type { PresenceUser, InvestigationMember } from './types';
import { configureServerApi, fetchInvestigationMembers } from './lib/server-api';
import { syncEngine } from './lib/sync-engine';
import { enableSync, disableSync, installSyncHooks } from './lib/sync-middleware';

// Install Dexie hooks once at module load so every write is captured
installSyncHooks();
import { WSClient } from './lib/ws-client';
import type { SyncResult } from './lib/server-api';

// Parse share hash on initial load: #share=<encoded>
function parseShareHash(): string | null {
  const match = window.location.hash.match(/^#share=(.+)$/);
  return match?.[1] ?? null;
}
const initialShareData = parseShareHash();

// Parse hash deep-link on initial load: #entity=note:xxx, #entity=task:xxx, #entity=event:xxx
function parseEntityHash(): { type: 'note' | 'task' | 'event'; id: string } | null {
  // Don't parse entity hash if we have a share hash
  if (initialShareData) return null;
  const match = window.location.hash.match(/^#entity=(note|task|event):(.+)$/);
  if (!match) return null;
  // Clear the hash after reading
  history.replaceState(null, '', location.pathname + location.search);
  return { type: match[1] as 'note' | 'task' | 'event', id: match[2] };
}

const initialDeepLink = parseEntityHash();

const NAV_STORAGE_KEY = 'threatcaddy-nav-state';

function loadNavState(): NavState | null {
  try {
    const raw = sessionStorage.getItem(NAV_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const savedNavState = loadNavState();

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </AuthProvider>
  );
}

function AppInner() {
  const { settings, updateSettings, toggleTheme } = useSettings();
  const { addToast } = useToast();
  const notes = useNotes();
  const tasks = useTasks();
  const timeline = useTimeline();
  const { timelines, createTimeline, updateTimeline, deleteTimeline, reload: reloadTimelines } = useTimelines();
  const { whiteboards, createWhiteboard, updateWhiteboard, deleteWhiteboard, trashWhiteboard, restoreWhiteboard, toggleArchiveWhiteboard, emptyTrashWhiteboards, getFilteredWhiteboards, whiteboardCounts, reload: reloadWhiteboards } = useWhiteboards();
  const standaloneIOCsHook = useStandaloneIOCs();
  const chatsHook = useChats();
  const { folders, createFolder, findOrCreateFolder, updateFolder, deleteFolder, trashFolderContents, archiveFolder, unarchiveFolder, reload: reloadFolders } = useFolders();
  const { tags, createTag, updateTag, deleteTag, reload: reloadTags } = useTags();

  const tour = useTour({
    onComplete: () => updateSettings({ tourCompleted: true }),
    onNavigate: (view) => setActiveView(view),
    onShowSettings: (show) => setShowSettings(show),
  });

  const activityLog = useActivityLog();

  // ─── Team Server Integration ───────────────────────────────────
  const auth = useAuth();
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncResult[]>([]);
  const wsClientRef = useRef<WSClient | null>(null);

  // Configure server API and sync engine when auth state changes
  useEffect(() => {
    if (auth.serverUrl && auth.connected) {
      configureServerApi(auth.serverUrl, auth.getAccessToken);
      enableSync();
      syncEngine.setConflictHandler((conflicts) => setSyncConflicts(conflicts));
      syncEngine.setRemoteChangeHandler((_changes, tables) => {
        // Targeted reload: only refresh hooks for tables that changed
        if (tables.has('notes')) notes.reload();
        if (tables.has('tasks')) tasks.reload();
        if (tables.has('timelineEvents')) timeline.reload();
        if (tables.has('timelines')) reloadTimelines();
        if (tables.has('whiteboards')) reloadWhiteboards();
        if (tables.has('standaloneIOCs')) standaloneIOCsHook.reload();
        if (tables.has('chatThreads')) chatsHook.reload();
        if (tables.has('folders')) reloadFolders();
        if (tables.has('tags')) reloadTags();
      });
      syncEngine.start();

      // Connect WebSocket
      auth.getAccessToken().then((token) => {
        if (token && auth.serverUrl) {
          const ws = new WSClient(auth.serverUrl, token);
          ws.onStatusChange((ok) => auth.setReachable(ok));
          ws.connect();
          syncEngine.setWSClient(ws);
          ws.on('entity-change', (msg) => {
            // Fast-path: apply the entity change directly to Dexie
            const { table, op, entityId, data } = msg as { table: string; op: 'put' | 'delete'; entityId: string; data?: Record<string, unknown> };
            if (table && op && entityId) {
              syncEngine.applyRemoteChange(table, op, entityId, data).catch(() => {
                // Fall back to full sync on error
                syncEngine.sync();
              });
            } else {
              syncEngine.sync();
            }
          });
          ws.on('presence', (msg) => {
            setPresenceUsers((msg.users as PresenceUser[]) || []);
          });
          ws.on('notification', () => {
            window.dispatchEvent(new CustomEvent('ws-notification'));
          });
          wsClientRef.current = ws;
        }
      });
    } else {
      disableSync();
      syncEngine.stop();
      syncEngine.setWSClient(null);
      configureServerApi(null, async () => null);
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
      setPresenceUsers([]);
    }

    return () => {
      syncEngine.stop();
      syncEngine.setWSClient(null);
      disableSync();
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
    };
  }, [auth.serverUrl, auth.connected]);

  const handleResolveConflict = useCallback(async (entityId: string, choice: 'mine' | 'theirs') => {
    const conflict = syncConflicts.find((c) => c.entityId === entityId);
    if (conflict) {
      await syncEngine.resolveConflicts([conflict], choice);
    }
    setSyncConflicts((prev) => prev.filter((c) => c.entityId !== entityId));
  }, [syncConflicts]);

  const handleResolveAllConflicts = useCallback(async (choice: 'mine' | 'theirs') => {
    await syncEngine.resolveConflicts(syncConflicts, choice);
    setSyncConflicts([]);
  }, [syncConflicts]);

  // Share receiver state — listen for hash changes to support re-navigation
  const [shareData, setShareData] = useState<string | null>(initialShareData);
  useEffect(() => {
    const handleHashChange = () => {
      const data = parseShareHash();
      if (data) setShareData(data);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Mobile exec mode
  const isMobile = useIsMobile();
  const [forceAnalystMode, setForceAnalystMode] = useState(() =>
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem('tc-analyst-mode') === '1',
  );
  useEffect(() => {
    if (forceAnalystMode) sessionStorage.setItem('tc-analyst-mode', '1');
    else sessionStorage.removeItem('tc-analyst-mode');
  }, [forceAnalystMode]);

  // Deep links force analyst mode on mobile so the target entity is reachable
  useEffect(() => {
    if (initialDeepLink && isMobile) setForceAnalystMode(true);
  }, [isMobile]);

  // Instrumented wrappers for activity logging
  const loggedCreateNote = useCallback(async (partial?: Partial<Note>) => {
    const note = await notes.createNote(partial);
    activityLog.log('note', 'create', `Created note "${note.title}"`, note.id, note.title);
    return note;
  }, [notes, activityLog]);

  const loggedTrashNote = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.trashNote(id);
    activityLog.log('note', 'trash', `Trashed note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes, activityLog]);

  const loggedRestoreNote = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.restoreNote(id);
    activityLog.log('note', 'restore', `Restored note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes, activityLog]);

  const loggedTogglePin = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.togglePin(id);
    const action = note?.pinned ? 'unpin' : 'pin';
    activityLog.log('note', action, `${action === 'pin' ? 'Pinned' : 'Unpinned'} note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes, activityLog]);

  const loggedToggleArchive = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.toggleArchive(id);
    const action = note?.archived ? 'unarchive' : 'archive';
    activityLog.log('note', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes, activityLog]);

  const loggedEmptyTrash = useCallback(async () => {
    const count = notes.notes.filter((n) => n.trashed).length;
    await notes.emptyTrash();
    activityLog.log('note', 'empty-trash', `Emptied trash (${count} notes)`);
  }, [notes, activityLog]);

  const loggedCreateTask = useCallback(async (partial?: Partial<import('./types').Task>) => {
    const task = await tasks.createTask(partial);
    activityLog.log('task', 'create', `Created task "${task.title || 'Untitled'}"`, task.id, task.title);
    return task;
  }, [tasks, activityLog]);

  const loggedDeleteTask = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.deleteTask(id);
    activityLog.log('task', 'delete', `Deleted task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, activityLog]);

  const loggedToggleComplete = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.toggleComplete(id);
    const action = task?.completed ? 'reopen' : 'complete';
    activityLog.log('task', action, `${action === 'complete' ? 'Completed' : 'Reopened'} task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, activityLog]);

  const loggedCreateEvent = useCallback(async (data: Partial<import('./types').TimelineEvent>) => {
    const event = await timeline.createEvent(data);
    activityLog.log('timeline', 'create', `Created timeline event "${event.title || 'Untitled'}"`, event.id, event.title);
    return event;
  }, [timeline, activityLog]);

  const loggedDeleteEvent = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.deleteEvent(id);
    activityLog.log('timeline', 'delete', `Deleted timeline event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, activityLog]);

  const loggedToggleStar = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.toggleStar(id);
    const action = event?.starred ? 'unstar' : 'star';
    activityLog.log('timeline', action, `${action === 'star' ? 'Starred' : 'Unstarred'} event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, activityLog]);

  const loggedCreateTimeline = useCallback(async (name: string) => {
    const tl = await createTimeline(name);
    activityLog.log('timeline', 'create', `Created timeline "${name}"`, tl.id, name);
    return tl;
  }, [createTimeline, activityLog]);

  const loggedDeleteTimeline = useCallback(async (id: string) => {
    const tl = timelines.find((t) => t.id === id);
    await deleteTimeline(id);
    activityLog.log('timeline', 'delete', `Deleted timeline "${tl?.name || 'Untitled'}"`, id, tl?.name);
  }, [deleteTimeline, timelines, activityLog]);

  const loggedCreateWhiteboard = useCallback(async (name?: string, folderId?: string) => {
    const wb = await createWhiteboard(name, folderId);
    activityLog.log('whiteboard', 'create', `Created whiteboard "${wb.name}"`, wb.id, wb.name);
    return wb;
  }, [createWhiteboard, activityLog]);

  const loggedDeleteWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboards.find((w) => w.id === id);
    await deleteWhiteboard(id);
    activityLog.log('whiteboard', 'delete', `Deleted whiteboard "${wb?.name || 'Untitled'}"`, id, wb?.name);
  }, [deleteWhiteboard, whiteboards, activityLog]);

  // Task trash/archive wrappers
  const loggedTrashTask = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.trashTask(id);
    activityLog.log('task', 'trash', `Trashed task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, activityLog]);

  const loggedRestoreTask = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.restoreTask(id);
    activityLog.log('task', 'restore', `Restored task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, activityLog]);

  const loggedToggleArchiveTask = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.toggleArchiveTask(id);
    const action = task?.archived ? 'unarchive' : 'archive';
    activityLog.log('task', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, activityLog]);

  const loggedEmptyTrashTasks = useCallback(async () => {
    const count = tasks.tasks.filter((t) => t.trashed).length;
    await tasks.emptyTrashTasks();
    activityLog.log('task', 'empty-trash', `Emptied task trash (${count} tasks)`);
  }, [tasks, activityLog]);

  // Timeline event trash/archive wrappers
  const loggedTrashEvent = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.trashEvent(id);
    activityLog.log('timeline', 'trash', `Trashed event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, activityLog]);

  const loggedRestoreEvent = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.restoreEvent(id);
    activityLog.log('timeline', 'restore', `Restored event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, activityLog]);

  const loggedToggleArchiveEvent = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.toggleArchiveEvent(id);
    const action = event?.archived ? 'unarchive' : 'archive';
    activityLog.log('timeline', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, activityLog]);

  const loggedEmptyTrashEvents = useCallback(async () => {
    const count = timeline.events.filter((e) => e.trashed).length;
    await timeline.emptyTrashEvents();
    activityLog.log('timeline', 'empty-trash', `Emptied event trash (${count} events)`);
  }, [timeline, activityLog]);

  // Whiteboard trash/archive wrappers
  const loggedTrashWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboards.find((w) => w.id === id);
    await trashWhiteboard(id);
    activityLog.log('whiteboard', 'trash', `Trashed whiteboard "${wb?.name || 'Untitled'}"`, id, wb?.name);
  }, [trashWhiteboard, whiteboards, activityLog]);

  const loggedRestoreWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboards.find((w) => w.id === id);
    await restoreWhiteboard(id);
    activityLog.log('whiteboard', 'restore', `Restored whiteboard "${wb?.name || 'Untitled'}"`, id, wb?.name);
  }, [restoreWhiteboard, whiteboards, activityLog]);

  const loggedToggleArchiveWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboards.find((w) => w.id === id);
    await toggleArchiveWhiteboard(id);
    const action = wb?.archived ? 'unarchive' : 'archive';
    activityLog.log('whiteboard', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} whiteboard "${wb?.name || 'Untitled'}"`, id, wb?.name);
  }, [toggleArchiveWhiteboard, whiteboards, activityLog]);

  const loggedEmptyTrashWhiteboards = useCallback(async () => {
    const count = whiteboards.filter((w) => w.trashed).length;
    await emptyTrashWhiteboards();
    activityLog.log('whiteboard', 'empty-trash', `Emptied whiteboard trash (${count} whiteboards)`);
  }, [emptyTrashWhiteboards, whiteboards, activityLog]);

  // Standalone IOC wrappers
  const loggedCreateIOC = useCallback(async (partial?: Partial<StandaloneIOC>) => {
    const ioc = await standaloneIOCsHook.createIOC(partial);
    activityLog.log('ioc', 'create', `Created standalone IOC "${ioc.value}"`, ioc.id, ioc.value);
    return ioc;
  }, [standaloneIOCsHook, activityLog]);

  const loggedTrashIOC = useCallback(async (id: string) => {
    const ioc = standaloneIOCsHook.iocs.find((i) => i.id === id);
    await standaloneIOCsHook.trashIOC(id);
    activityLog.log('ioc', 'trash', `Trashed IOC "${ioc?.value || ''}"`, id, ioc?.value);
  }, [standaloneIOCsHook, activityLog]);

  const loggedRestoreIOC = useCallback(async (id: string) => {
    const ioc = standaloneIOCsHook.iocs.find((i) => i.id === id);
    await standaloneIOCsHook.restoreIOC(id);
    activityLog.log('ioc', 'restore', `Restored IOC "${ioc?.value || ''}"`, id, ioc?.value);
  }, [standaloneIOCsHook, activityLog]);

  const loggedToggleArchiveIOC = useCallback(async (id: string) => {
    const ioc = standaloneIOCsHook.iocs.find((i) => i.id === id);
    await standaloneIOCsHook.toggleArchiveIOC(id);
    const action = ioc?.archived ? 'unarchive' : 'archive';
    activityLog.log('ioc', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} IOC "${ioc?.value || ''}"`, id, ioc?.value);
  }, [standaloneIOCsHook, activityLog]);

  const loggedDeleteIOC = useCallback(async (id: string) => {
    const ioc = standaloneIOCsHook.iocs.find((i) => i.id === id);
    await standaloneIOCsHook.deleteIOC(id);
    activityLog.log('ioc', 'delete', `Deleted IOC "${ioc?.value || ''}"`, id, ioc?.value);
  }, [standaloneIOCsHook, activityLog]);

  const loggedEmptyTrashIOCs = useCallback(async () => {
    const count = standaloneIOCsHook.iocs.filter((i) => i.trashed).length;
    await standaloneIOCsHook.emptyTrashIOCs();
    activityLog.log('ioc', 'empty-trash', `Emptied IOC trash (${count} IOCs)`);
  }, [standaloneIOCsHook, activityLog]);

  const loggedCreateFolder = useCallback(async (name: string) => {
    const folder = await createFolder(name);
    activityLog.log('folder', 'create', `Created investigation "${name}"`, folder.id, name);
    return folder;
  }, [createFolder, activityLog]);

  const loggedDeleteFolder = useCallback(async (id: string) => {
    const folder = folders.find((f) => f.id === id);
    await deleteFolder(id);
    activityLog.log('folder', 'delete', `Deleted investigation "${folder?.name || 'Untitled'}"`, id, folder?.name);
  }, [deleteFolder, folders, activityLog]);

  const loggedTrashFolderContents = useCallback(async (id: string) => {
    const folder = folders.find((f) => f.id === id);
    await trashFolderContents(id);
    activityLog.log('folder', 'trash', `Trashed contents of investigation "${folder?.name || 'Untitled'}" and removed folder`, id, folder?.name);
    notes.reload();
    tasks.reload();
    timeline.reload();
    reloadWhiteboards();
    standaloneIOCsHook.reload();
  }, [trashFolderContents, folders, activityLog, notes, tasks, timeline, reloadWhiteboards, standaloneIOCsHook]);

  const loggedArchiveFolder = useCallback(async (id: string) => {
    const folder = folders.find((f) => f.id === id);
    await archiveFolder(id);
    activityLog.log('folder', 'archive', `Archived investigation "${folder?.name || 'Untitled'}" and all contents`, id, folder?.name);
    notes.reload();
    tasks.reload();
    timeline.reload();
    reloadWhiteboards();
    standaloneIOCsHook.reload();
  }, [archiveFolder, folders, activityLog, notes, tasks, timeline, reloadWhiteboards, standaloneIOCsHook]);

  const loggedUnarchiveFolder = useCallback(async (id: string) => {
    const folder = folders.find((f) => f.id === id);
    await unarchiveFolder(id);
    activityLog.log('folder', 'unarchive', `Unarchived investigation "${folder?.name || 'Untitled'}" and all contents`, id, folder?.name);
    notes.reload();
    tasks.reload();
    timeline.reload();
    reloadWhiteboards();
    standaloneIOCsHook.reload();
  }, [unarchiveFolder, folders, activityLog, notes, tasks, timeline, reloadWhiteboards, standaloneIOCsHook]);

  const emptyAllTrash = useCallback(async () => {
    await loggedEmptyTrash();
    await loggedEmptyTrashTasks();
    await loggedEmptyTrashEvents();
    await loggedEmptyTrashWhiteboards();
    await loggedEmptyTrashIOCs();
  }, [loggedEmptyTrash, loggedEmptyTrashTasks, loggedEmptyTrashEvents, loggedEmptyTrashWhiteboards, loggedEmptyTrashIOCs]);

  const loggedCreateTag = useCallback(async (name: string) => {
    const tag = await createTag(name);
    activityLog.log('tag', 'create', `Created tag "${name}"`, tag.id, name);
    return tag;
  }, [createTag, activityLog]);

  const loggedDeleteTag = useCallback(async (id: string) => {
    const tag = tags.find((t) => t.id === id);
    await deleteTag(id);
    activityLog.log('tag', 'delete', `Deleted tag "${tag?.name || ''}"`, id, tag?.name);
  }, [deleteTag, tags, activityLog]);

  // UI state — guard against stale 'clips' defaultView in localStorage
  const safeDefaultView: ViewMode = settings.defaultView === 'dashboard' || settings.defaultView === 'notes' || settings.defaultView === 'tasks' || settings.defaultView === 'timeline' || settings.defaultView === 'whiteboard' || settings.defaultView === 'activity' || settings.defaultView === 'graph' || settings.defaultView === 'ioc-stats' || settings.defaultView === 'chat' || settings.defaultView === 'caddyshack' ? settings.defaultView : 'notes';
  const deepLinkView: ViewMode | undefined = initialDeepLink
    ? initialDeepLink.type === 'note' ? 'notes' : initialDeepLink.type === 'task' ? 'tasks' : 'timeline'
    : undefined;
  const [activeView, setActiveView] = useState<ViewMode>(deepLinkView ?? savedNavState?.view ?? safeDefaultView);
  const [selectedNoteId, setSelectedNoteId] = useState<string | undefined>(
    initialDeepLink?.type === 'note' ? initialDeepLink.id : savedNavState?.selectedNoteId,
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(savedNavState?.selectedFolderId);
  const [selectedTag, setSelectedTag] = useState<string>();
  const [showTrash, setShowTrash] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const [sort, setSort] = useState<SortOption>('updatedAt');
  const [editorMode, setEditorMode] = useState<EditorMode>(settings.editorMode);
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>(settings.taskViewMode);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [shareLinkPayload, setShareLinkPayload] = useState<SharePayload | null>(null);
  const [selectedIOCTypes, setSelectedIOCTypes] = useState<IOCType[]>([]);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | undefined>(savedNavState?.selectedTimelineId);
  const [selectedWhiteboardId, setSelectedWhiteboardId] = useState<string | undefined>(savedNavState?.selectedWhiteboardId);
  const [selectedChatThreadId, setSelectedChatThreadId] = useState<string | undefined>(() => {
    try { return sessionStorage.getItem('tc-chat-thread') || undefined; } catch { return undefined; }
  });
  const [graphLayout, setGraphLayout] = useState<LayoutName>('cose-bilkent');
  const [screenshareMaxLevel, setScreenshareMaxLevel] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | undefined>();
  const [folderStatusFilter, setFolderStatusFilter] = useState<InvestigationStatus[]>(['active']);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const demoProcessedRef = useRef(false);

  // Fetch investigation members for task assignee support
  const [investigationMembers, setInvestigationMembers] = useState<InvestigationMember[]>([]);
  useEffect(() => {
    if (!auth.connected || !selectedFolderId) {
      setInvestigationMembers([]);
      return;
    }
    fetchInvestigationMembers(selectedFolderId)
      .then((data) => setInvestigationMembers(data.members || []))
      .catch(() => setInvestigationMembers([]));
  }, [auth.connected, selectedFolderId]);

  const effectiveClsLevels = useMemo(() => getEffectiveClsLevels(settings.tiClsLevels), [settings.tiClsLevels]);

  // Browser back/forward navigation
  const handleNavRestore = useCallback((state: NavState) => {
    setActiveView(state.view);
    if (state.selectedNoteId !== undefined) setSelectedNoteId(state.selectedNoteId);
    if (state.selectedTimelineId !== undefined) setSelectedTimelineId(state.selectedTimelineId);
    if (state.selectedWhiteboardId !== undefined) setSelectedWhiteboardId(state.selectedWhiteboardId);
    if (state.selectedFolderId !== undefined) setSelectedFolderId(state.selectedFolderId);
    setShowSettings(false);
  }, []);
  const { navigate: navPush } = useNavigationHistory({ onViewChange: handleNavRestore });

  // Persist navigation state to sessionStorage for refresh restoration
  useEffect(() => {
    sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({
      view: activeView,
      selectedNoteId,
      selectedFolderId,
      selectedTimelineId,
      selectedWhiteboardId,
    }));
  }, [activeView, selectedNoteId, selectedFolderId, selectedTimelineId, selectedWhiteboardId]);

  // Persist chat thread selection
  useEffect(() => {
    if (selectedChatThreadId) sessionStorage.setItem('tc-chat-thread', selectedChatThreadId);
    else sessionStorage.removeItem('tc-chat-thread');
  }, [selectedChatThreadId]);

  const loggedCreateChatThread = useCallback(async (partial?: Partial<import('./types').ChatThread>) => {
    const thread = await chatsHook.createThread(partial);
    activityLog.log('chat', 'create', `Created chat thread "${thread.title}"`, thread.id, thread.title);
    return thread;
  }, [chatsHook, activityLog]);

  const loggedTrashChatThread = useCallback(async (id: string) => {
    const thread = chatsHook.threads.find((t) => t.id === id);
    await chatsHook.trashThread(id);
    activityLog.log('chat', 'trash', `Trashed chat thread "${thread?.title || 'Untitled'}"`, id, thread?.title);
    if (selectedChatThreadId === id) setSelectedChatThreadId(undefined);
  }, [chatsHook, activityLog, selectedChatThreadId]);

  const navigateTo = useCallback((view: ViewMode, opts?: { selectedNoteId?: string; selectedTimelineId?: string; selectedWhiteboardId?: string }) => {
    setActiveView(view);
    setShowSettings(false);
    // Auto-select investigation timeline when switching to timeline view
    if (view === 'timeline' && !opts?.selectedTimelineId && selectedFolderId) {
      const folder = folders.find((f) => f.id === selectedFolderId);
      if (folder?.timelineId) {
        setSelectedTimelineId(folder.timelineId);
        navPush({ view, ...opts, selectedTimelineId: folder.timelineId });
        return;
      }
    }
    navPush({ view, ...opts });
  }, [navPush, selectedFolderId, folders]);

  // Resolve timeline deep-link once events are loaded
  const deepLinkTimelineResolved = useCallback(() => {
    if (initialDeepLink?.type !== 'event' || !timeline.events.length) return;
    const ev = timeline.events.find((e) => e.id === initialDeepLink.id);
    if (ev && !selectedTimelineId) setSelectedTimelineId(ev.timelineId);
  }, [timeline.events, selectedTimelineId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run when events load for deep-link resolution
  useEffect(deepLinkTimelineResolved, [timeline.events]);

  // Navigate in response to notification clicks
  useEffect(() => {
    const handler = (e: Event) => {
      const { type, postId, folderId } = (e as CustomEvent).detail ?? {};
      if ((type === 'mention' || type === 'reply' || type === 'reaction') && postId) {
        if (folderId) setSelectedFolderId(folderId);
        setActiveView('caddyshack');
        window.dispatchEvent(new CustomEvent('caddyshack-select-post', { detail: { postId } }));
      } else if (type === 'invite' && folderId) {
        setSelectedFolderId(folderId);
        navigateTo('notes');
      }
    };
    window.addEventListener('notification-navigate', handler);
    return () => window.removeEventListener('notification-navigate', handler);
  }, [navigateTo]);

  // Listen for clip imports from the Chrome extension via postMessage
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      // Only accept messages from our own window (extension injects script into this page)
      // event.source === window ensures only same-window postMessage is accepted,
      // blocking cross-window/cross-tab attacks even under file:// where origins are "null"
      if (event.source !== window) return;
      const isFileProtocol = window.location.protocol === 'file:';
      if (!isFileProtocol && event.origin !== window.location.origin) return;
      if (event.data?.type !== 'BROWSERNOTES_IMPORT_CLIPS') return;
      const clips = event.data.clips;
      if (!Array.isArray(clips) || clips.length === 0) return;

      try {
        const folderCache = new Map<string, typeof folders[0]>();
        let firstEntityType: string = 'note';
        let firstEntityId: string | undefined;
        let lastFolderId: string | undefined;
        const entityTypesUsed = new Set<string>();

        let failedClips = 0;
        for (const clip of clips) {
          try {
          // Sanitize clip fields — only accept expected string/number types
          const rawContent = typeof clip.content === 'string' ? clip.content : '';
          const sourceUrl = typeof clip.sourceUrl === 'string' ? clip.sourceUrl : '';
          const sourceTitle = typeof clip.sourceTitle === 'string' ? clip.sourceTitle : '';
          const clipTitle = typeof clip.title === 'string' ? clip.title : '';
          const createdAt = typeof clip.createdAt === 'number' ? clip.createdAt : Date.now();
          const entityType = typeof clip.entityType === 'string' ? clip.entityType : 'note';
          const folderName = typeof clip.folderName === 'string' && clip.folderName.trim()
            ? clip.folderName.trim() : 'Clips';
          const clsLevel = typeof clip.clsLevel === 'string' && clip.clsLevel ? clip.clsLevel : undefined;

          // Resolve folder (cached)
          if (!folderCache.has(folderName)) {
            folderCache.set(folderName, await findOrCreateFolder(folderName));
          }
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- just set above
          const folder = folderCache.get(folderName)!;
          lastFolderId = folder.id;

          const timestamp = new Date(createdAt).toLocaleString();
          const content = `*Clipped ${timestamp}*\n\n${rawContent}`;
          const freshIOCs = extractIOCs(rawContent);
          const iocAnalysis = mergeIOCAnalysis(undefined, freshIOCs);
          const iocTypes = [...new Set(freshIOCs.filter((i) => !i.dismissed).map((i) => i.type))];

          entityTypesUsed.add(entityType);

          if (entityType === 'task') {
            const task = await loggedCreateTask({
              title: clipTitle || rawContent.substring(0, 80) || 'Clip Task',
              description: content,
              folderId: folder.id,
              clsLevel: clsLevel || folder.clsLevel,
              status: 'todo',
              priority: 'none',
              iocAnalysis,
              iocTypes,
            });
            if (!firstEntityId) { firstEntityId = task.id; firstEntityType = 'task'; }
          } else if (entityType === 'timeline-event') {
            const event = await loggedCreateEvent({
              title: clipTitle || rawContent.substring(0, 80) || 'Clip Event',
              description: content,
              source: sourceUrl || 'Extension clip',
              folderId: folder.id,
              clsLevel: clsLevel || folder.clsLevel,
              eventType: 'evidence',
              confidence: 'medium',
              timelineId: timelines[0]?.id || '',
              iocAnalysis,
              iocTypes,
            });
            if (!firstEntityId) { firstEntityId = event.id; firstEntityType = 'timeline-event'; }
          } else {
            const note = await loggedCreateNote({
              title: sourceUrl || clipTitle || rawContent.substring(0, 80) || 'Clip',
              content,
              folderId: folder.id,
              clsLevel: clsLevel || folder.clsLevel,
              sourceUrl,
              sourceTitle,
              createdAt,
              iocAnalysis,
              iocTypes,
            });
            if (!firstEntityId) { firstEntityId = note.id; firstEntityType = 'note'; }
          }
          } catch (clipErr) {
            console.error('Failed to import clip:', clipErr);
            failedClips++;
          }
        }
        if (failedClips > 0) {
          addToast('warning', `Imported with ${failedClips} failed clip${failedClips > 1 ? 's' : ''}`);
        }

        // Navigate to the appropriate view
        if (entityTypesUsed.size === 1) {
          if (firstEntityType === 'task') {
            navigateTo('tasks');
          } else if (firstEntityType === 'timeline-event') {
            navigateTo('timeline');
          } else {
            navigateTo('notes', { selectedNoteId: firstEntityId });
          }
        } else {
          // Mixed batch — default to notes
          navigateTo('notes');
        }
        if (lastFolderId) setSelectedFolderId(lastFolderId);
      } catch (error) {
        console.error('Failed to import clips:', error);
        addToast('error', 'Failed to import clips from extension');
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [findOrCreateFolder, loggedCreateNote, loggedCreateTask, loggedCreateEvent, timelines, navigateTo, addToast]);

  // Track Clips folder ID for OCI envelope type detection
  const clipsFolderId = useMemo(
    () => folders.find((f) => f.name === 'Clips')?.id,
    [folders]
  );

  // Filtered notes (always exclude trashed/archived — TrashArchiveView handles those)
  const filteredNotes = useMemo(
    () =>
      notes.getFilteredNotes({
        folderId: selectedFolderId,
        tag: selectedTag,
        showTrashed: false,
        showArchived: false,
        sort,
        iocTypes: selectedIOCTypes.length > 0 ? selectedIOCTypes : undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes.getFilteredNotes, selectedFolderId, selectedTag, sort, selectedIOCTypes]
  );

  // Filtered tasks
  const filteredTasks = useMemo(
    () =>
      tasks.getFilteredTasks({
        folderId: selectedFolderId,
        tag: selectedTag,
        showTrashed: false,
        showArchived: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks.getFilteredTasks, selectedFolderId, selectedTag]
  );

  // Filtered timeline events
  const filteredTimelineEvents = useMemo(
    () =>
      timeline.getFilteredEvents({
        folderId: selectedFolderId,
        tag: selectedTag,
        timelineId: selectedTimelineId,
        showTrashed: false,
        showArchived: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline.getFilteredEvents, selectedFolderId, selectedTag, selectedTimelineId]
  );

  // Filtered whiteboards
  const filteredWhiteboards = useMemo(
    () => getFilteredWhiteboards({
      folderId: selectedFolderId,
      tag: selectedTag,
      showTrashed: false,
      showArchived: false,
    }),
    [getFilteredWhiteboards, selectedFolderId, selectedTag]
  );

  // Auto-deselect whiteboard when trashed/archived/filtered out
  useEffect(() => {
    if (selectedWhiteboardId && !filteredWhiteboards.find((w) => w.id === selectedWhiteboardId)) {
      setSelectedWhiteboardId(undefined);
    }
  }, [selectedWhiteboardId, filteredWhiteboards]);

  // Filtered standalone IOCs
  const filteredStandaloneIOCs = useMemo(
    () => standaloneIOCsHook.getFilteredIOCs({
      folderId: selectedFolderId,
      tag: selectedTag,
      showTrashed: false,
      showArchived: false,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [standaloneIOCsHook.getFilteredIOCs, selectedFolderId, selectedTag]
  );

  // Screenshare-safe: filter once on full arrays, derive folder-scoped and investigation-scoped from these
  const screensafeNotes = useMemo(
    () => screenshareMaxLevel ? notes.notes.filter((n) => !isAboveClsThreshold(n.clsLevel, screenshareMaxLevel, effectiveClsLevels)) : notes.notes,
    [notes.notes, screenshareMaxLevel, effectiveClsLevels]
  );
  const screensafeTasks = useMemo(
    () => screenshareMaxLevel ? tasks.tasks.filter((t) => !isAboveClsThreshold(t.clsLevel, screenshareMaxLevel, effectiveClsLevels)) : tasks.tasks,
    [tasks.tasks, screenshareMaxLevel, effectiveClsLevels]
  );
  const screensafeTimelineEvents = useMemo(
    () => screenshareMaxLevel ? timeline.events.filter((e) => !isAboveClsThreshold(e.clsLevel, screenshareMaxLevel, effectiveClsLevels)) : timeline.events,
    [timeline.events, screenshareMaxLevel, effectiveClsLevels]
  );

  // Folder-filtered + screenshare-safe (for NoteList, TaskList, TimelineView)
  // Derive from screensafe arrays instead of re-filtering with isAboveClsThreshold
  const ssFilteredNotes = useMemo(
    () => screenshareMaxLevel ? filteredNotes.filter((n) => !isAboveClsThreshold(n.clsLevel, screenshareMaxLevel, effectiveClsLevels)) : filteredNotes,
    [filteredNotes, screenshareMaxLevel, effectiveClsLevels]
  );
  const ssFilteredTasks = useMemo(
    () => screenshareMaxLevel ? filteredTasks.filter((t) => !isAboveClsThreshold(t.clsLevel, screenshareMaxLevel, effectiveClsLevels)) : filteredTasks,
    [filteredTasks, screenshareMaxLevel, effectiveClsLevels]
  );
  const ssFilteredTimelineEvents = useMemo(
    () => screenshareMaxLevel ? filteredTimelineEvents.filter((e) => !isAboveClsThreshold(e.clsLevel, screenshareMaxLevel, effectiveClsLevels)) : filteredTimelineEvents,
    [filteredTimelineEvents, screenshareMaxLevel, effectiveClsLevels]
  );

  // Investigation-scoped arrays (for graph, IOC stats, search) — derive from screensafe
  const investigationNotes = useMemo(
    () => selectedFolderId ? screensafeNotes.filter((n) => n.folderId === selectedFolderId) : screensafeNotes,
    [screensafeNotes, selectedFolderId]
  );
  const investigationTasks = useMemo(
    () => selectedFolderId ? screensafeTasks.filter((t) => t.folderId === selectedFolderId) : screensafeTasks,
    [screensafeTasks, selectedFolderId]
  );
  const investigationTimelineEvents = useMemo(
    () => selectedFolderId ? screensafeTimelineEvents.filter((e) => e.folderId === selectedFolderId) : screensafeTimelineEvents,
    [screensafeTimelineEvents, selectedFolderId]
  );
  const investigationWhiteboards = useMemo(
    () => selectedFolderId ? whiteboards.filter((w) => w.folderId === selectedFolderId) : whiteboards,
    [whiteboards, selectedFolderId]
  );
  const investigationStandaloneIOCs = useMemo(
    () => selectedFolderId ? standaloneIOCsHook.iocs.filter((i) => i.folderId === selectedFolderId) : standaloneIOCsHook.iocs,
    [standaloneIOCsHook.iocs, selectedFolderId]
  );

  const investigationScopedCounts = useMemo(() => {
    if (!selectedFolderId) return null;
    const iocKeys = new Set<string>();
    const collect = (a?: { iocs: Array<{ type: string; value: string; dismissed: boolean }> }) => {
      if (!a?.iocs) return;
      for (const i of a.iocs) if (!i.dismissed) iocKeys.add(`${i.type}:${i.value.toLowerCase()}`);
    };
    for (const n of investigationNotes) if (!n.trashed && !n.archived) collect(n.iocAnalysis);
    for (const t of investigationTasks) if (!t.trashed && !t.archived) collect(t.iocAnalysis);
    for (const e of investigationTimelineEvents) if (!e.trashed && !e.archived) collect(e.iocAnalysis);
    return {
      notes: investigationNotes.filter(n => !n.trashed && !n.archived).length,
      tasks: investigationTasks.filter(t => !t.trashed && !t.archived).length,
      events: investigationTimelineEvents.filter(e => !e.trashed && !e.archived).length,
      whiteboards: investigationWhiteboards.filter(w => !w.trashed && !w.archived).length,
      iocs: iocKeys.size,
    };
  }, [selectedFolderId, investigationNotes, investigationTasks, investigationTimelineEvents, investigationWhiteboards]);

  // Screenshare context value
  const screenshareCtx = useMemo(
    () => ({ maxLevel: screenshareMaxLevel, effectiveLevels: effectiveClsLevels }),
    [screenshareMaxLevel, effectiveClsLevels]
  );

  // Timeline event counts per timeline
  const timelineEventCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ev of timeline.events) {
      counts[ev.timelineId] = (counts[ev.timelineId] || 0) + 1;
    }
    return counts;
  }, [timeline.events]);

  // Selected note
  const selectedNote = useMemo(
    () => filteredNotes.find((n) => n.id === selectedNoteId),
    [filteredNotes, selectedNoteId]
  );

  // Auto-deselect when selected note is no longer in filtered list
  // Fixes stale editor after trash, delete, archive, restore, tag change, etc.
  useEffect(() => {
    if (selectedNoteId && !filteredNotes.find((n) => n.id === selectedNoteId)) {
      setSelectedNoteId(undefined);
    }
  }, [selectedNoteId, filteredNotes]);

  // Note counts (include all notes)
  const noteCounts = useMemo(() => ({
    total: notes.notes.filter((n) => !n.trashed && !n.archived).length,
    trashed: notes.notes.filter((n) => n.trashed).length,
    archived: notes.notes.filter((n) => n.archived && !n.trashed).length,
  }), [notes.notes]);

  // Combined trash/archive counts across all entity types
  const combinedTrashedCount = useMemo(() =>
    noteCounts.trashed + tasks.taskCounts.trashed + timeline.eventCounts.trashed + whiteboardCounts.trashed + standaloneIOCsHook.iocCounts.trashed,
    [noteCounts.trashed, tasks.taskCounts.trashed, timeline.eventCounts.trashed, whiteboardCounts.trashed, standaloneIOCsHook.iocCounts.trashed]
  );
  const combinedArchivedCount = useMemo(() =>
    noteCounts.archived + tasks.taskCounts.archived + timeline.eventCounts.archived + whiteboardCounts.archived + standaloneIOCsHook.iocCounts.archived,
    [noteCounts.archived, tasks.taskCounts.archived, timeline.eventCounts.archived, whiteboardCounts.archived, standaloneIOCsHook.iocCounts.archived]
  );

  const handleMoveNoteToFolder = useCallback((noteId: string, folderId: string) => {
    notes.updateNote(noteId, { folderId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.updateNote]);

  const handleNewNote = useCallback(async () => {
    if (showQuickCapture) return;
    setShowTrash(false);
    setShowArchive(false);
    const folder = selectedFolderId ? folders.find((f) => f.id === selectedFolderId) : undefined;
    const note = await loggedCreateNote({
      folderId: selectedFolderId,
      clsLevel: folder?.clsLevel,
    });
    setSelectedNoteId(note.id);
    navigateTo('notes', { selectedNoteId: note.id });
  }, [loggedCreateNote, selectedFolderId, showQuickCapture, navigateTo, folders]);

  const [pendingNewTask, setPendingNewTask] = useState(false);
  const [pendingNewEvent, setPendingNewEvent] = useState(false);

  const handleNewTask = useCallback(async () => {
    setShowTrash(false);
    setShowArchive(false);
    setPendingNewTask(true);
    navigateTo('tasks');
  }, [navigateTo]);

  const handleNewTimelineEvent = useCallback(() => {
    setShowTrash(false);
    setShowArchive(false);
    setPendingNewEvent(true);
    navigateTo('timeline');
  }, [navigateTo]);

  const handleNewWhiteboard = useCallback(async () => {
    const wb = await loggedCreateWhiteboard(undefined, selectedFolderId);
    setSelectedWhiteboardId(wb.id);
    navigateTo('whiteboard', { selectedWhiteboardId: wb.id });
  }, [loggedCreateWhiteboard, selectedFolderId, navigateTo]);

  const [showIOCForm, setShowIOCForm] = useState(false);

  const handleNewIOC = useCallback(() => {
    setShowIOCForm(true);
  }, []);

  const handleShareNoteLink = useCallback((note: Note) => {
    setShareLinkPayload({ v: 1, s: 'note', t: Date.now(), d: note });
  }, []);

  const handleShareInvestigationLink = useCallback((folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const bundle: InvestigationBundle = {
      folder,
      notes: notes.notes.filter((n) => n.folderId === folderId && !n.trashed),
      tasks: tasks.tasks.filter((t) => t.folderId === folderId && !t.trashed),
      events: timeline.events.filter((e) => e.folderId === folderId && !e.trashed),
      timelines: timelines.filter((tl) => folder.timelineId === tl.id),
      whiteboards: whiteboards.filter((w) => w.folderId === folderId && !w.trashed),
      iocs: standaloneIOCsHook.iocs.filter((i) => i.folderId === folderId && !i.trashed),
      tags,
    };
    setShareLinkPayload({ v: 1, s: 'investigation', t: Date.now(), d: bundle });
  }, [folders, notes.notes, tasks.tasks, timeline.events, timelines, whiteboards, standaloneIOCsHook.iocs, tags]);

  const handleShareChatThread = useCallback((thread: ChatThread) => {
    setShareLinkPayload({ v: 1, s: 'chat', t: Date.now(), d: thread });
  }, []);

  const handleSaveSharedPayload = useCallback(async (payload: SharePayload) => {
    if (payload.s === 'investigation') {
      const bundle = payload.d as InvestigationBundle;
      await db.transaction('rw', [db.folders, db.notes, db.tasks, db.timelineEvents, db.whiteboards, db.standaloneIOCs, db.timelines, db.tags], async () => {
        await db.folders.put(bundle.folder);
        await db.notes.bulkPut(bundle.notes);
        await db.tasks.bulkPut(bundle.tasks);
        await db.timelineEvents.bulkPut(bundle.events);
        await db.whiteboards.bulkPut(bundle.whiteboards);
        await db.standaloneIOCs.bulkPut(bundle.iocs);
        await db.timelines.bulkPut(bundle.timelines);
        await db.tags.bulkPut(bundle.tags);
      });
      reloadFolders();
      notes.reload();
      tasks.reload();
      timeline.reload();
      reloadTimelines();
      reloadWhiteboards();
      standaloneIOCsHook.reload();
      reloadTags();
      addToast('success', `Saved investigation "${bundle.folder.name}" with all entities`);
    } else if (payload.s === 'note') {
      await db.notes.put(payload.d as Note);
      notes.reload();
      addToast('success', 'Note saved to ThreatCaddy');
    } else if (payload.s === 'task') {
      await db.tasks.put(payload.d as Task);
      tasks.reload();
      addToast('success', 'Task saved to ThreatCaddy');
    } else if (payload.s === 'event') {
      await db.timelineEvents.put(payload.d as TimelineEvent);
      timeline.reload();
      addToast('success', 'Event saved to ThreatCaddy');
    } else if (payload.s === 'chat') {
      await db.chatThreads.put(payload.d as ChatThread);
      chatsHook.reload();
      addToast('success', 'Chat saved to ThreatCaddy');
    }
  }, [notes, tasks, timeline, chatsHook, reloadFolders, reloadTimelines, reloadWhiteboards, standaloneIOCsHook, reloadTags, addToast]);

  const [showDataImport, setShowDataImport] = useState(false);

  const handleDataImportComplete = useCallback((result: ImportResult) => {
    activityLog.log(
      'data',
      'import',
      `Data import: ${result.timelineEventsCreated} events, ${result.iocsExtracted} IOCs`,
    );
    addToast('success', `Imported ${result.timelineEventsCreated} events and ${result.iocsExtracted} IOCs`);
    // Reload all hooks to pick up new entities
    notes.reload();
    timeline.reload();
    standaloneIOCsHook.reload();
    reloadTimelines();
    reloadTags();
    // Navigate based on what was imported
    if (result.timelineEventsCreated > 0) {
      navigateTo('timeline');
    } else if (result.iocsExtracted > 0) {
      navigateTo('ioc-stats');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityLog, addToast, notes.reload, timeline.reload, standaloneIOCsHook.reload, reloadTimelines, reloadTags, navigateTo]);

  const handleQuickCapture = useCallback(async (data: Partial<Note>) => {
    const folder = selectedFolderId ? folders.find((f) => f.id === selectedFolderId) : undefined;
    const note = await loggedCreateNote({
      ...data,
      folderId: data.folderId ?? selectedFolderId,
      clsLevel: data.clsLevel ?? folder?.clsLevel,
    });
    setSelectedNoteId(note.id);
    navigateTo('notes', { selectedNoteId: note.id });
  }, [loggedCreateNote, navigateTo, selectedFolderId, folders]);

  const handleImportComplete = useCallback(() => {
    notes.reload();
    tasks.reload();
    timeline.reload();
    reloadTimelines();
    reloadWhiteboards();
    standaloneIOCsHook.reload();
    reloadFolders();
    reloadTags();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.reload, tasks.reload, timeline.reload, reloadTimelines, reloadWhiteboards, standaloneIOCsHook.reload, reloadFolders, reloadTags]);

  const handleToggleEditorMode = useCallback(() => {
    setEditorMode((prev) => {
      const modes: EditorMode[] = ['edit', 'split', 'preview'];
      const nextIndex = (modes.indexOf(prev) + 1) % modes.length;
      return modes[nextIndex];
    });
  }, []);

  const handleQuickSave = useCallback(async () => {
    const json = await exportJSON();
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(json, `threatcaddy-backup-${date}.json`, 'application/json');
  }, []);

  const handleQuickLoad = useCallback((file: File) => {
    setPendingImportFile(file);
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!pendingImportFile) return;
    const text = await pendingImportFile.text();
    await importJSON(text);
    setPendingImportFile(null);
    handleImportComplete();
  }, [pendingImportFile, handleImportComplete]);

  // Sample investigation
  const sampleLoaded = useMemo(() => folders.some((f) => f.id === 'sample-investigation'), [folders]);

  const handleLoadSample = useCallback(async () => {
    const data = generateSampleInvestigation();
    // Write all entities to DB
    await db.folders.put(data.folder);
    await db.timelines.put(data.timeline);
    await db.tags.bulkPut(data.tags);
    await db.notes.bulkPut(data.notes);
    await db.tasks.bulkPut(data.tasks);
    await db.timelineEvents.bulkPut(data.timelineEvents);
    await db.standaloneIOCs.bulkPut(data.standaloneIOCs);
    await db.whiteboards.bulkPut([data.whiteboard]);
    // Reload all hooks
    handleImportComplete();
    // Navigate to sample
    setSelectedFolderId('sample-investigation');
    navigateTo('notes');
    activityLog.log('data', 'import', 'Loaded sample investigation "Operation DARK GLACIER"');
  }, [handleImportComplete, navigateTo, activityLog]);

  const handleDeleteSample = useCallback(async () => {
    // Delete all entities with sample- prefix
    const allNotes = await db.notes.toArray();
    const allTasks = await db.tasks.toArray();
    const allEvents = await db.timelineEvents.toArray();
    const allIOCs = await db.standaloneIOCs.toArray();
    const allWB = await db.whiteboards.toArray();
    const allTimelines = await db.timelines.toArray();
    const allTags = await db.tags.toArray();

    await db.notes.bulkDelete(allNotes.filter((n) => isSampleEntity(n.id)).map((n) => n.id));
    await db.tasks.bulkDelete(allTasks.filter((t) => isSampleEntity(t.id)).map((t) => t.id));
    await db.timelineEvents.bulkDelete(allEvents.filter((e) => isSampleEntity(e.id)).map((e) => e.id));
    await db.standaloneIOCs.bulkDelete(allIOCs.filter((i) => isSampleEntity(i.id)).map((i) => i.id));
    await db.whiteboards.bulkDelete(allWB.filter((w) => isSampleEntity(w.id)).map((w) => w.id));
    await db.timelines.bulkDelete(allTimelines.filter((t) => isSampleEntity(t.id)).map((t) => t.id));
    await db.tags.bulkDelete(allTags.filter((t) => isSampleEntity(t.id)).map((t) => t.id));
    await db.folders.delete('sample-investigation');

    handleImportComplete();
    if (selectedFolderId === 'sample-investigation') {
      setSelectedFolderId(undefined);
    }
    activityLog.log('data', 'delete', 'Removed sample investigation "Operation DARK GLACIER"');
  }, [handleImportComplete, selectedFolderId, activityLog]);

  // ?demo URL parameter handling
  useEffect(() => {
    if (demoProcessedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('demo')) return;
    demoProcessedRef.current = true;
    // Clean the ?demo param from the URL so it doesn't linger
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    if (sampleLoaded) {
      setShowDemoModal(true);
    } else {
      handleLoadSample().then(() => setShowDemoModal(true));
    }
  }, [sampleLoaded, handleLoadSample]);

  // Keyboard shortcuts
  // Search overlay navigation callbacks
  const handleSearchNavigateToNote = useCallback((id: string) => {
    setSelectedNoteId(id);
    setSelectedFolderId(undefined);
    setSelectedTag(undefined);
    setShowTrash(false);
    setShowArchive(false);
    navigateTo('notes', { selectedNoteId: id });
  }, [navigateTo]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSearchNavigateToTask = useCallback((_id: string) => {
    setSelectedFolderId(undefined);
    setSelectedTag(undefined);
    navigateTo('tasks');
  }, [navigateTo]);

  const handleSearchNavigateToTimeline = useCallback((id: string) => {
    const ev = timeline.events.find((e) => e.id === id);
    if (ev) {
      setSelectedTimelineId(ev.timelineId);
      navigateTo('timeline', { selectedTimelineId: ev.timelineId });
    } else {
      navigateTo('timeline');
    }
  }, [timeline.events, navigateTo]);

  const handleSearchNavigateToWhiteboard = useCallback((id: string) => {
    setSelectedWhiteboardId(id);
    navigateTo('whiteboard', { selectedWhiteboardId: id });
  }, [navigateTo]);

  useKeyboardShortcuts({
    onNewNote: handleNewNote,
    onNewTask: handleNewTask,
    onSearch: () => setSearchOverlayOpen(true),
    onSave: handleQuickSave,
    onTogglePreview: handleToggleEditorMode,
    onSwitchView: (view) => { navigateTo(view); },
    onEscape: () => {
      setSearchOverlayOpen(false);
      setShowQuickCapture(false);
      setShowSettings(false);
      setMobileSidebarOpen(false);
    },
  });

  // Determine list title
  let listTitle = 'Notes';
  if (selectedFolderId) {
    const folder = folders.find((f) => f.id === selectedFolderId);
    listTitle = folder?.name || 'Investigation';
  }
  else if (selectedTag) listTitle = `#${selectedTag}`;

  const sidebarProps = useMemo(() => ({
    activeView,
    onViewChange: (v: ViewMode) => { navigateTo(v); },
    folders,
    tags,
    selectedFolderId,
    onFolderSelect: setSelectedFolderId,
    selectedTag,
    onTagSelect: setSelectedTag,
    showTrash,
    onShowTrash: setShowTrash,
    showArchive,
    onShowArchive: setShowArchive,
    onCreateFolder: async (name: string) => { const f = await loggedCreateFolder(name); setSelectedFolderId(f.id); setSelectedTag(undefined); setShowTrash(false); setShowArchive(false); },
    onDeleteFolder: (id: string) => { loggedDeleteFolder(id); if (selectedFolderId === id) { setSelectedFolderId(undefined); setSelectedNoteId(undefined); } },
    onTrashFolderContents: (id: string) => { loggedTrashFolderContents(id); if (selectedFolderId === id) { setSelectedFolderId(undefined); setSelectedNoteId(undefined); } },
    onArchiveFolder: (id: string) => { loggedArchiveFolder(id); },
    onUnarchiveFolder: (id: string) => { loggedUnarchiveFolder(id); },
    onRenameFolder: (id: string, name: string) => updateFolder(id, { name }),
    onOpenSettings: () => { setShowSettings(true); },
    noteCounts: { ...noteCounts, trashed: combinedTrashedCount, archived: combinedArchivedCount },
    taskCounts: tasks.taskCounts,
    timelineCounts: timeline.eventCounts,
    timelines,
    selectedTimelineId,
    onTimelineSelect: setSelectedTimelineId,
    onCreateTimeline: (name: string) => loggedCreateTimeline(name),
    onDeleteTimeline: (id: string) => { loggedDeleteTimeline(id); if (selectedTimelineId === id) setSelectedTimelineId(undefined); },
    onRenameTimeline: (id: string, name: string) => updateTimeline(id, { name }),
    timelineEventCounts,
    whiteboards,
    selectedWhiteboardId,
    onWhiteboardSelect: (id: string) => setSelectedWhiteboardId(id),
    onCreateWhiteboard: (name?: string) => loggedCreateWhiteboard(name, selectedFolderId),
    onDeleteWhiteboard: (id: string) => { loggedDeleteWhiteboard(id); if (selectedWhiteboardId === id) setSelectedWhiteboardId(undefined); },
    onRenameWhiteboard: (id: string, name: string) => updateWhiteboard(id, { name }),
    whiteboardCount: whiteboardCounts.total,
    onMoveNoteToFolder: handleMoveNoteToFolder,
    onRenameTag: (id: string, name: string) => updateTag(id, { name }),
    onDeleteTag: loggedDeleteTag,
    onEditFolder: setEditingFolderId,
    folderStatusFilter,
    onFolderStatusFilterChange: setFolderStatusFilter,
    investigationScopedCounts,
    chatCount: chatsHook.threadCounts.total,
  }), [activeView, folders, tags, selectedFolderId, selectedTag, showTrash, showArchive, loggedCreateFolder, loggedDeleteFolder, loggedTrashFolderContents, loggedArchiveFolder, loggedUnarchiveFolder, updateFolder, noteCounts, combinedTrashedCount, combinedArchivedCount, tasks.taskCounts, timeline.eventCounts, timelines, selectedTimelineId, loggedCreateTimeline, loggedDeleteTimeline, updateTimeline, timelineEventCounts, whiteboards, selectedWhiteboardId, loggedCreateWhiteboard, loggedDeleteWhiteboard, updateWhiteboard, whiteboardCounts, handleMoveNoteToFolder, updateTag, loggedDeleteTag, navigateTo, folderStatusFilter, investigationScopedCounts, chatsHook.threadCounts.total]);

  const selectedFolder = useMemo(() => folders.find((f) => f.id === selectedFolderId), [folders, selectedFolderId]);
  const selectedTagObj = useMemo(() => tags.find((t) => t.name === selectedTag), [tags, selectedTag]);
  const editingFolder = useMemo(() => folders.find((f) => f.id === editingFolderId), [folders, editingFolderId]);
  const investigationEntityCounts = useMemo(() => {
    if (!editingFolderId) return { notes: 0, tasks: 0, events: 0, whiteboards: 0 };
    return {
      notes: notes.notes.filter((n) => n.folderId === editingFolderId && !n.trashed).length,
      tasks: tasks.tasks.filter((t) => t.folderId === editingFolderId && !t.trashed).length,
      events: timeline.events.filter((e) => e.folderId === editingFolderId && !e.trashed).length,
      whiteboards: whiteboards.filter((w) => w.folderId === editingFolderId && !w.trashed).length,
    };
  }, [editingFolderId, notes.notes, tasks.tasks, timeline.events, whiteboards]);

  const filterBar = (selectedFolderId || selectedTag) ? (
    <ActiveFilterBar
      folderName={selectedFolder?.name}
      folderColor={selectedFolder?.color}
      folderStatus={selectedFolder?.status}
      tagName={selectedTag}
      tagColor={selectedTagObj?.color}
      onClear={() => { setSelectedFolderId(undefined); setSelectedTag(undefined); }}
      onEditFolder={selectedFolderId ? () => setEditingFolderId(selectedFolderId) : undefined}
    />
  ) : null;

  // Share receiver — early return on all devices
  if (shareData) {
    return (
      <ShareReceiver
        encodedData={shareData}
        theme={settings.theme}
        onDismiss={() => {
          setShareData(null);
          history.replaceState(null, '', location.pathname + location.search);
        }}
        onSave={handleSaveSharedPayload}
      />
    );
  }

  // Mobile exec mode — replace entire UI with executive dashboard
  if (isMobile && !forceAnalystMode) {
    return (
      <ScreenshareContext.Provider value={screenshareCtx}>
      <ActivityLogContext.Provider value={activityLog.log}>
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-500">Loading…</div>}>
        <ExecDashboard
          folders={folders}
          allNotes={notes.notes}
          allTasks={tasks.tasks}
          allEvents={timeline.events}
          allWhiteboards={whiteboards}
          allIOCs={standaloneIOCsHook.iocs}
          allTimelines={timelines}
          allTags={tags}
          activityEntries={activityLog.entries}
          theme={settings.theme}
          onToggleTheme={toggleTheme}
          onSwitchToAnalystMode={(folderId) => {
            setForceAnalystMode(true);
            if (folderId) {
              setSelectedFolderId(folderId);
              setActiveView('notes');
            }
          }}
        />
        </Suspense>
      </ActivityLogContext.Provider>
      <ToastContainer />
      </ScreenshareContext.Provider>
    );
  }

  return (
    <ScreenshareContext.Provider value={screenshareCtx}>
    <ActivityLogContext.Provider value={activityLog.log}>
      {/* Analyst mode banner on mobile */}
      {isMobile && forceAnalystMode && (
        <div className="bg-accent/10 border-b border-accent/20 px-3 py-2 flex items-center justify-between text-xs shrink-0">
          <span className="text-text-secondary">Analyst Mode — optimized for desktop</span>
          <button
            onClick={() => setForceAnalystMode(false)}
            className="text-accent font-medium ml-2 whitespace-nowrap"
          >
            Back to Exec Mode
          </button>
        </div>
      )}
      <AppLayout
        header={
          <Header
            onOpenSearch={() => setSearchOverlayOpen(true)}
            theme={settings.theme}
            onToggleTheme={toggleTheme}
            onNewNote={() => setShowQuickCapture(true)}
            onNewTask={handleNewTask}
            onNewTimelineEvent={handleNewTimelineEvent}
            onNewWhiteboard={handleNewWhiteboard}
            onNewIOC={handleNewIOC}
            onImportData={() => setShowDataImport(true)}
            onToggleSidebar={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
            onMobileMenuToggle={() => setMobileSidebarOpen((prev) => !prev)}
            sidebarCollapsed={settings.sidebarCollapsed}
            onQuickSave={handleQuickSave}
            onQuickLoad={handleQuickLoad}
            onStartTour={() => tour.start(activeView)}
            selectedFolderName={selectedFolder?.name}
            screenshareMaxLevel={screenshareMaxLevel}
            onScreenshareChange={setScreenshareMaxLevel}
            effectiveClsLevels={effectiveClsLevels}
            presenceUsers={presenceUsers}
          />
        }
        sidebar={
          <Sidebar
            {...sidebarProps}
            collapsed={settings.sidebarCollapsed}
            onToggleCollapsed={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
            onNavigate={() => setSelectedNoteId(undefined)}
          />
        }
      >
        <ErrorBoundary>
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-500">Loading…</div>}>
        <div className={activeView === 'graph' && !showSettings ? 'hidden' : 'flex flex-col flex-1 overflow-hidden'}>
        {filterBar}
        {showSettings ? (
          <SettingsPanel
            settings={settings}
            onUpdateSettings={updateSettings}
            notes={notes.notes}
            onImportComplete={handleImportComplete}
            sampleLoaded={sampleLoaded}
            onLoadSample={handleLoadSample}
            onDeleteSample={handleDeleteSample}
            onClose={() => setShowSettings(false)}
          />
        ) : showTrash || showArchive ? (
          <TrashArchiveView
            mode={showTrash ? 'trash' : 'archive'}
            notes={notes.notes}
            tasks={tasks.tasks}
            timelineEvents={timeline.events}
            whiteboards={whiteboards}
            standaloneIOCs={standaloneIOCsHook.iocs}
            folders={folders}
            onRestoreNote={loggedRestoreNote}
            onDeleteNotePermanently={(id) => { notes.deleteNote(id); activityLog.log('note', 'delete', 'Permanently deleted note', id); }}
            onTrashNote={loggedTrashNote}
            onUnarchiveNote={loggedToggleArchive}
            onRestoreTask={loggedRestoreTask}
            onDeleteTaskPermanently={loggedDeleteTask}
            onTrashTask={loggedTrashTask}
            onUnarchiveTask={loggedToggleArchiveTask}
            onRestoreEvent={loggedRestoreEvent}
            onDeleteEventPermanently={loggedDeleteEvent}
            onTrashEvent={loggedTrashEvent}
            onUnarchiveEvent={loggedToggleArchiveEvent}
            onRestoreWhiteboard={loggedRestoreWhiteboard}
            onDeleteWhiteboardPermanently={loggedDeleteWhiteboard}
            onTrashWhiteboard={loggedTrashWhiteboard}
            onUnarchiveWhiteboard={loggedToggleArchiveWhiteboard}
            onRestoreIOC={loggedRestoreIOC}
            onDeleteIOCPermanently={loggedDeleteIOC}
            onTrashIOC={loggedTrashIOC}
            onUnarchiveIOC={loggedToggleArchiveIOC}
            onEmptyAllTrash={emptyAllTrash}
          />
        ) : activeView === 'dashboard' ? (
          <DashboardView
            links={settings.quickLinks ?? DEFAULT_QUICK_LINKS}
            onUpdateLinks={(links) => updateSettings({ quickLinks: links })}
            onViewChange={navigateTo}
            folders={folders}
            allNotes={notes.notes}
            allTasks={tasks.tasks}
            allEvents={timeline.events}
            allWhiteboards={whiteboards}
            allIOCs={standaloneIOCsHook.iocs}
            onFolderSelect={(id) => {
              setSelectedFolderId(id);
              setShowTrash(false);
              setShowArchive(false);
              setSelectedTag(undefined);
            }}
          />
        ) : activeView === 'ioc-stats' ? (
          <div className="flex-1 flex flex-col overflow-y-auto">
            <IOCStatsView
              notes={screensafeNotes}
              tasks={screensafeTasks}
              timelineEvents={screensafeTimelineEvents}
              standaloneIOCs={standaloneIOCsHook.iocs.filter((i) => !i.trashed && !i.archived)}
              settings={settings}
              scopedNotes={investigationNotes}
              scopedTasks={investigationTasks}
              scopedTimelineEvents={investigationTimelineEvents}
              scopedStandaloneIOCs={investigationStandaloneIOCs.filter((i) => !i.trashed && !i.archived)}
              selectedFolderId={selectedFolderId}
              selectedFolderName={selectedFolder?.name}
            />
            <div className="border-t border-gray-800">
              <StandaloneIOCList
                iocs={filteredStandaloneIOCs}
                folders={folders}
                allTags={tags}
                onCreate={loggedCreateIOC}
                onUpdate={standaloneIOCsHook.updateIOC}
                onDelete={loggedDeleteIOC}
                onTrash={loggedTrashIOC}
                onRestore={loggedRestoreIOC}
                onToggleArchive={loggedToggleArchiveIOC}
                defaultFolderId={selectedFolderId}
              />
            </div>
          </div>
        ) : activeView === 'activity' ? (
          <ActivityLogView
            entries={activityLog.entries}
            getFiltered={activityLog.getFiltered}
            onClear={activityLog.clear}
          />
        ) : activeView === 'graph' ? (
          null /* GraphView is always-mounted below for layout persistence */
        ) : activeView === 'timeline' ? (
          <TimelineView
            events={ssFilteredTimelineEvents}
            allTags={tags}
            folders={folders}
            onCreateTag={loggedCreateTag}
            onCreateEvent={(data) => loggedCreateEvent({ ...data, folderId: data.folderId ?? selectedFolderId, clsLevel: data.clsLevel ?? selectedFolder?.clsLevel, timelineId: selectedTimelineId || timelines[0]?.id || '' })}
            onUpdateEvent={timeline.updateEvent}
            onDeleteEvent={loggedDeleteEvent}
            onTrashEvent={loggedTrashEvent}
            onRestoreEvent={loggedRestoreEvent}
            onToggleArchiveEvent={loggedToggleArchiveEvent}
            onToggleStar={loggedToggleStar}
            getFilteredEvents={timeline.getFilteredEvents}
            timelines={timelines}
            selectedTimelineId={selectedTimelineId}
            onTimelineReload={reloadTimelines}
            onEventsReload={timeline.reload}
            scopeLabel={selectedFolder?.name}
            selectedFolderId={selectedFolderId}
            openNewForm={pendingNewEvent}
            onNewFormOpened={() => setPendingNewEvent(false)}
          />
        ) : activeView === 'whiteboard' ? (
          <WhiteboardView
            whiteboards={filteredWhiteboards}
            folders={folders}
            allTags={tags}
            onCreateWhiteboard={(name?: string) => loggedCreateWhiteboard(name, selectedFolderId)}
            onUpdateWhiteboard={updateWhiteboard}
            onDeleteWhiteboard={loggedDeleteWhiteboard}
            onTrashWhiteboard={loggedTrashWhiteboard}
            onRestoreWhiteboard={loggedRestoreWhiteboard}
            onToggleArchiveWhiteboard={loggedToggleArchiveWhiteboard}
            onCreateTag={loggedCreateTag}
            selectedWhiteboardId={selectedWhiteboardId ?? null}
            onWhiteboardSelect={(id) => setSelectedWhiteboardId(id ?? undefined)}
          />
        ) : activeView === 'chat' ? (
          <ChatView
            threads={chatsHook.getFilteredThreads({ folderId: selectedFolderId, showTrashed: false, showArchived: false })}
            selectedThreadId={selectedChatThreadId}
            onSelectThread={setSelectedChatThreadId}
            onCreateThread={loggedCreateChatThread}
            onUpdateThread={chatsHook.updateThread}
            onAddMessage={chatsHook.addMessage}
            onTrashThread={loggedTrashChatThread}
            onShareThread={handleShareChatThread}
            settings={settings}
            selectedFolderId={selectedFolderId}
            selectedFolder={selectedFolder}
            onEntitiesChanged={() => { notes.reload(); tasks.reload(); timeline.reload(); standaloneIOCsHook.reload(); }}
          />
        ) : activeView === 'caddyshack' ? (
          <CaddyShackView
            folderId={selectedFolderId}
            folderName={selectedFolder?.name}
          />
        ) : activeView === 'tasks' ? (
          <TaskListView
            tasks={ssFilteredTasks}
            allTags={tags}
            folders={folders}
            onCreateTag={loggedCreateTag}
            onToggleComplete={loggedToggleComplete}
            onUpdateTask={tasks.updateTask}
            onDeleteTask={loggedDeleteTask}
            onTrashTask={loggedTrashTask}
            onRestoreTask={loggedRestoreTask}
            onToggleArchiveTask={loggedToggleArchiveTask}
            onCreateTask={(data) => loggedCreateTask({ ...data, folderId: data.folderId ?? selectedFolderId, clsLevel: data.clsLevel ?? selectedFolder?.clsLevel })}
            viewMode={taskViewMode}
            onViewModeChange={setTaskViewMode}
            getTasksByStatus={(status) => tasks.getTasksByStatus(status, selectedFolderId)}
            allNotes={screensafeNotes}
            allTimelineEvents={screensafeTimelineEvents}
            scopeLabel={selectedFolder?.name}
            selectedFolderId={selectedFolderId}
            openNewForm={pendingNewTask}
            onNewFormOpened={() => setPendingNewTask(false)}
            members={investigationMembers}
            currentUserId={auth.user?.id}
          />
        ) : (
          /* Notes view — responsive: list OR editor on mobile */
          <div data-tour="notes-editor" className="flex flex-1 overflow-hidden">
            <div className={cn(
              'shrink-0 h-full',
              selectedNote ? 'hidden md:block md:w-72' : 'w-full md:w-72'
            )}>
              <NoteList
                notes={ssFilteredNotes}
                selectedId={selectedNoteId}
                onSelect={setSelectedNoteId}
                sort={sort}
                onSortChange={setSort}
                title={listTitle}
                selectedIOCTypes={selectedIOCTypes}
                onIOCTypesChange={setSelectedIOCTypes}
                folders={folders}
                tiExportConfig={{
                  defaultClsLevel: settings.tiDefaultClsLevel,
                  defaultReportSource: settings.tiDefaultReportSource,
                }}
                onTrash={loggedTrashNote}
              />
            </div>
            <div className={cn('flex-1 min-w-0 overflow-hidden', !selectedNote && 'hidden md:block')}>
              {selectedNote ? (
                <NoteEditor
                  note={selectedNote}
                  onUpdate={notes.updateNote}
                  onTrash={loggedTrashNote}
                  onRestore={loggedRestoreNote}
                  onTogglePin={loggedTogglePin}
                  onToggleArchive={loggedToggleArchive}
                  allTags={tags}
                  folders={folders}
                  onCreateTag={loggedCreateTag}
                  editorMode={editorMode}
                  onEditorModeChange={setEditorMode}
                  onBack={() => setSelectedNoteId(undefined)}
                  clipsFolderId={clipsFolderId}
                  settings={settings}
                  allNotes={screensafeNotes}
                  allTasks={screensafeTasks}
                  allTimelineEvents={screensafeTimelineEvents}
                  onNavigateToNote={handleSearchNavigateToNote}
                  onShareLink={handleShareNoteLink}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600">
                  <FileText size={48} className="mb-3" />
                  <p className="text-lg font-medium">Select a note or create one</p>
                  <p className="text-sm mt-1">Ctrl+N for quick capture</p>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
        {/* Always-mounted GraphView — hidden via CSS when not active to preserve layout/positions */}
        <div className={activeView === 'graph' && !showSettings ? 'flex flex-1 overflow-hidden' : 'hidden'}>
          <GraphView
            visible={activeView === 'graph' && !showSettings}
            notes={screensafeNotes}
            tasks={screensafeTasks}
            timelineEvents={screensafeTimelineEvents}
            settings={settings}
            layout={graphLayout}
            onLayoutChange={setGraphLayout}
            scopedNotes={investigationNotes}
            scopedTasks={investigationTasks}
            scopedTimelineEvents={investigationTimelineEvents}
            selectedFolderId={selectedFolderId}
            selectedFolderName={selectedFolder?.name}
            onNavigateToNote={(id) => { setSelectedNoteId(id); setSelectedFolderId(undefined); setSelectedTag(undefined); setShowTrash(false); setShowArchive(false); navigateTo('notes', { selectedNoteId: id }); }}
            onNavigateToTask={() => { setSelectedFolderId(undefined); setSelectedTag(undefined); navigateTo('tasks'); }}
            onNavigateToTimelineEvent={(id) => { const ev = timeline.events.find((e) => e.id === id); if (ev) { setSelectedTimelineId(ev.timelineId); navigateTo('timeline', { selectedTimelineId: ev.timelineId }); } else { navigateTo('timeline'); } }}
            onUpdateNote={notes.updateNote}
            onUpdateTask={tasks.updateTask}
            onUpdateEvent={timeline.updateEvent}
          />
        </div>
        </Suspense>
        </ErrorBoundary>
      </AppLayout>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileSidebarOpen(false)} />
          <div className="relative h-full w-[260px] shrink-0" onClick={(e) => e.stopPropagation()}>
            <Sidebar
              {...sidebarProps}
              collapsed={false}
              onToggleCollapsed={() => setMobileSidebarOpen(false)}
              onNavigate={() => { setMobileSidebarOpen(false); setSelectedNoteId(undefined); }}
            />
          </div>
        </div>
      )}

      <QuickCapture
        open={showQuickCapture}
        onClose={() => setShowQuickCapture(false)}
        onCapture={handleQuickCapture}
        folders={folders}
        defaultFolderId={selectedFolderId}
      />

      <StandaloneIOCForm
        open={showIOCForm}
        onClose={() => setShowIOCForm(false)}
        onSubmit={async (data) => {
          await loggedCreateIOC(data);
          navigateTo('ioc-stats');
        }}
        folders={folders}
        defaultFolderId={selectedFolderId}
      />

      <DataImportModal
        open={showDataImport}
        onClose={() => setShowDataImport(false)}
        folders={folders}
        timelines={timelines}
        defaultFolderId={selectedFolderId}
        onCreateTimeline={loggedCreateTimeline}
        onImportComplete={handleDataImportComplete}
      />

      <ConfirmDialog
        open={!!pendingImportFile}
        onClose={() => setPendingImportFile(null)}
        onConfirm={handleConfirmImport}
        title="Load Backup"
        message="This will replace all your current notes, tasks, folders, and tags with the backup data. This cannot be undone."
        confirmLabel="Replace All Data"
        danger
      />

      <ShareDialog
        open={shareLinkPayload !== null}
        onClose={() => setShareLinkPayload(null)}
        payload={shareLinkPayload}
        folderId={shareLinkPayload?.s === 'investigation'
          ? (shareLinkPayload.d as InvestigationBundle).folder.id
          : undefined}
      />

      <DemoWelcomeModal
        open={showDemoModal}
        onClose={() => setShowDemoModal(false)}
        onStartTour={() => tour.start(activeView)}
        onDeleteDemo={handleDeleteSample}
      />

      <SearchOverlay
        open={searchOverlayOpen}
        onClose={() => setSearchOverlayOpen(false)}
        notes={screensafeNotes}
        tasks={screensafeTasks}
        clipsFolderId={clipsFolderId}
        onNavigateToNote={handleSearchNavigateToNote}
        onNavigateToTask={handleSearchNavigateToTask}
        timelineEvents={screensafeTimelineEvents}
        whiteboards={whiteboards}
        onNavigateToTimeline={handleSearchNavigateToTimeline}
        onNavigateToWhiteboard={handleSearchNavigateToWhiteboard}
        selectedFolderId={selectedFolderId}
        scopedNotes={investigationNotes}
        scopedTasks={investigationTasks}
        scopedTimelineEvents={investigationTimelineEvents}
        scopedWhiteboards={investigationWhiteboards}
        folders={folders}
      />

      {editingFolder && (
        <InvestigationDetailPanel
          folder={editingFolder}
          onUpdate={updateFolder}
          onClose={() => setEditingFolderId(undefined)}
          allTags={tags}
          onCreateTag={loggedCreateTag}
          entityCounts={investigationEntityCounts}
          effectiveClsLevels={effectiveClsLevels}
          onCreateTimeline={async (name) => {
            const tl = await loggedCreateTimeline(name);
            return tl;
          }}
          onNavigateToTimeline={(timelineId) => {
            setEditingFolderId(undefined);
            setSelectedTimelineId(timelineId);
            navigateTo('timeline', { selectedTimelineId: timelineId });
          }}
          onExport={async (folderId) => {
            const json = await exportInvestigationJSON(folderId);
            const folder = folders.find((f) => f.id === folderId);
            const slug = (folder?.name || 'investigation').toLowerCase().replace(/\s+/g, '-');
            const date = new Date().toISOString().slice(0, 10);
            downloadFile(json, `threatcaddy-${slug}-${date}.json`, 'application/json');
            activityLog.log('data', 'export', `Exported investigation "${folder?.name}"`, folderId, folder?.name);
            addToast('success', `Exported investigation "${folder?.name}"`);
          }}
          onGenerateReport={(folderId) => {
            const folder = folders.find((f) => f.id === folderId);
            if (!folder) return;
            const folderNotes = notes.notes.filter((n) => n.folderId === folderId && !n.trashed && !n.archived);
            const folderTasks = tasks.tasks.filter((t) => t.folderId === folderId && !t.trashed && !t.archived);
            const folderEvents = timeline.events.filter((e) => e.folderId === folderId && !e.trashed && !e.archived);
            const folderIOCs = standaloneIOCsHook.iocs.filter((i) => i.folderId === folderId && !i.trashed && !i.archived);
            const html = generateInvestigationReport({ folder, notes: folderNotes, tasks: folderTasks, events: folderEvents, standaloneIOCs: folderIOCs });
            const blob = new Blob([html], { type: 'text/html' });
            const blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
            activityLog.log('data', 'export', `Generated report for "${folder.name}"`, folderId, folder.name);
            addToast('success', `Report generated for "${folder.name}"`);
          }}
          onShareLink={handleShareInvestigationLink}
        />
      )}

      {tour.isActive && tour.currentStep && (
        <>
          <TourOverlay targetRect={tour.targetRect} />
          <TourGlow targetRect={tour.targetRect} />
          <TourTooltip
            step={tour.currentStep}
            targetRect={tour.targetRect}
            currentIndex={tour.currentStepIndex}
            totalSteps={tour.totalSteps}
            onNext={tour.next}
            onPrev={tour.prev}
            onSkip={tour.skip}
          />
        </>
      )}
    </ActivityLogContext.Provider>
    <ToastContainer />

    {/* Sync Conflict Dialog */}
    {syncConflicts.length > 0 && (
      <ConflictDialog
        conflicts={syncConflicts}
        onResolve={handleResolveConflict}
        onResolveAll={handleResolveAllConflicts}
        onClose={() => setSyncConflicts([])}
      />
    )}
    </ScreenshareContext.Provider>
  );
}
