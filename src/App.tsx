import { useState, useCallback, useMemo, useEffect } from 'react';
import { AppLayout } from './components/Layout/AppLayout';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { NoteList } from './components/Notes/NoteList';
import { NoteEditor } from './components/Notes/NoteEditor';
import { TaskListView } from './components/Tasks/TaskList';
import { TimelineView } from './components/Timeline/TimelineView';
import { WhiteboardView } from './components/Whiteboard/WhiteboardView';
import { ActivityLogView } from './components/Activity/ActivityLogView';
import { QuickCapture } from './components/Clips/QuickCapture';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { useNotes } from './hooks/useNotes';
import { useTasks } from './hooks/useTasks';
import { useTimeline } from './hooks/useTimeline';
import { useTimelines } from './hooks/useTimelines';
import { useWhiteboards } from './hooks/useWhiteboards';
import { useFolders } from './hooks/useFolders';
import { useTags } from './hooks/useTags';
import { useSettings } from './hooks/useSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useActivityLog } from './hooks/useActivityLog';
import { ActivityLogContext } from './hooks/ActivityLogContext';
import { ScreenshareContext } from './hooks/ScreenshareContext';
import { getEffectiveClsLevels, isAboveClsThreshold } from './lib/classification';
import type { ViewMode, SortOption, EditorMode, Note, TaskViewMode, IOCType } from './types';
import { FileText } from 'lucide-react';
import { cn } from './lib/utils';
import { exportJSON, importJSON, downloadFile, exportInvestigationJSON } from './lib/export';
import { ConfirmDialog } from './components/Common/ConfirmDialog';
import { SearchOverlay } from './components/Search/SearchOverlay';
import { extractIOCs, mergeIOCAnalysis } from './lib/ioc-extractor';
import { ErrorBoundary } from './components/Common/ErrorBoundary';
import { ActiveFilterBar } from './components/Common/ActiveFilterBar';
import { InvestigationDetailPanel } from './components/Investigation/InvestigationDetailPanel';
import type { InvestigationStatus } from './types';
import { GraphView } from './components/Graph/GraphView';
import { IOCStatsView } from './components/Analysis/IOCStatsView';
import type { LayoutName } from './components/Graph/GraphCanvas';
import { useNavigationHistory } from './hooks/useNavigationHistory';
import type { NavState } from './hooks/useNavigationHistory';
import { useTour } from './hooks/useTour';
import { TourOverlay } from './components/Tour/TourOverlay';
import { TourTooltip } from './components/Tour/TourTooltip';

// Parse hash deep-link on initial load: #entity=note:xxx, #entity=task:xxx, #entity=event:xxx
function parseEntityHash(): { type: 'note' | 'task' | 'event'; id: string } | null {
  const match = window.location.hash.match(/^#entity=(note|task|event):(.+)$/);
  if (!match) return null;
  // Clear the hash after reading
  history.replaceState(null, '', location.pathname + location.search);
  return { type: match[1] as 'note' | 'task' | 'event', id: match[2] };
}

const initialDeepLink = parseEntityHash();

export default function App() {
  const { settings, updateSettings, toggleTheme } = useSettings();
  const notes = useNotes();
  const tasks = useTasks();
  const timeline = useTimeline();
  const { timelines, createTimeline, updateTimeline, deleteTimeline, reload: reloadTimelines } = useTimelines();
  const { whiteboards, createWhiteboard, updateWhiteboard, deleteWhiteboard, reload: reloadWhiteboards } = useWhiteboards();
  const { folders, createFolder, findOrCreateFolder, updateFolder, deleteFolder, deleteFolderWithContents } = useFolders();
  const { tags, createTag, updateTag, deleteTag } = useTags();

  const tour = useTour({
    onComplete: () => updateSettings({ tourCompleted: true }),
    onNavigate: (view) => setActiveView(view),
  });

  const activityLog = useActivityLog();

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

  const loggedDeleteFolderWithContents = useCallback(async (id: string) => {
    const folder = folders.find((f) => f.id === id);
    await deleteFolderWithContents(id);
    activityLog.log('folder', 'delete', `Deleted investigation "${folder?.name || 'Untitled'}" and all its contents`, id, folder?.name);
    notes.reload();
    tasks.reload();
    timeline.reload();
    reloadWhiteboards();
  }, [deleteFolderWithContents, folders, activityLog, notes, tasks, timeline, reloadWhiteboards]);

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
  const safeDefaultView: ViewMode = settings.defaultView === 'notes' || settings.defaultView === 'tasks' || settings.defaultView === 'timeline' || settings.defaultView === 'whiteboard' || settings.defaultView === 'activity' || settings.defaultView === 'graph' || settings.defaultView === 'ioc-stats' ? settings.defaultView : 'notes';
  const deepLinkView: ViewMode | undefined = initialDeepLink
    ? initialDeepLink.type === 'note' ? 'notes' : initialDeepLink.type === 'task' ? 'tasks' : 'timeline'
    : undefined;
  const [activeView, setActiveView] = useState<ViewMode>(deepLinkView ?? safeDefaultView);
  const [selectedNoteId, setSelectedNoteId] = useState<string | undefined>(
    initialDeepLink?.type === 'note' ? initialDeepLink.id : undefined,
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string>();
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
  const [selectedIOCTypes, setSelectedIOCTypes] = useState<IOCType[]>([]);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string>();
  const [selectedWhiteboardId, setSelectedWhiteboardId] = useState<string>();
  const [graphLayout, setGraphLayout] = useState<LayoutName>('cose-bilkent');
  const [screenshareMaxLevel, setScreenshareMaxLevel] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | undefined>();
  const [folderStatusFilter, setFolderStatusFilter] = useState<InvestigationStatus[]>(['active']);

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

        for (const clip of clips) {
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
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [findOrCreateFolder, loggedCreateNote, loggedCreateTask, loggedCreateEvent, timelines, navigateTo]);

  // Track Clips folder ID for OCI envelope type detection
  const clipsFolderId = useMemo(
    () => folders.find((f) => f.name === 'Clips')?.id,
    [folders]
  );

  // Filtered notes
  const filteredNotes = useMemo(
    () =>
      notes.getFilteredNotes({
        folderId: selectedFolderId,
        tag: selectedTag,
        showTrashed: showTrash,
        showArchived: showArchive,
        sort,
        iocTypes: selectedIOCTypes.length > 0 ? selectedIOCTypes : undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes.getFilteredNotes, selectedFolderId, selectedTag, showTrash, showArchive, sort, selectedIOCTypes]
  );

  // Filtered tasks
  const filteredTasks = useMemo(
    () =>
      tasks.getFilteredTasks({
        folderId: selectedFolderId,
        tag: selectedTag,
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
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline.getFilteredEvents, selectedFolderId, selectedTag, selectedTimelineId]
  );

  // Filtered whiteboards
  const filteredWhiteboards = useMemo(
    () => {
      let wbs = whiteboards;
      if (selectedFolderId) wbs = wbs.filter((w) => w.folderId === selectedFolderId);
      if (selectedTag) wbs = wbs.filter((w) => w.tags.includes(selectedTag));
      return wbs;
    },
    [whiteboards, selectedFolderId, selectedTag]
  );

  // Screenshare-filtered: folder-filtered arrays (for NoteList, TaskList, TimelineView)
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

  // Screenshare-filtered: unfiltered-by-folder arrays (for GraphView, IOCStatsView, SearchOverlay, NoteEditor, TaskListView)
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

  // Investigation-scoped arrays (for graph, IOC stats, search)
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

  const investigationScopedCounts = useMemo(() => {
    if (!selectedFolderId) return null;
    const iocKeys = new Set<string>();
    const collect = (a?: { iocs: Array<{ type: string; value: string; dismissed: boolean }> }) => {
      if (!a?.iocs) return;
      for (const i of a.iocs) if (!i.dismissed) iocKeys.add(`${i.type}:${i.value.toLowerCase()}`);
    };
    for (const n of investigationNotes) if (!n.trashed && !n.archived) collect(n.iocAnalysis);
    for (const t of investigationTasks) collect(t.iocAnalysis);
    for (const e of investigationTimelineEvents) collect(e.iocAnalysis);
    return {
      notes: investigationNotes.filter(n => !n.trashed && !n.archived).length,
      tasks: investigationTasks.length,
      events: investigationTimelineEvents.length,
      whiteboards: investigationWhiteboards.length,
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
    () => notes.notes.find((n) => n.id === selectedNoteId),
    [notes.notes, selectedNoteId]
  );

  // Auto-deselect when selected note is no longer in filtered list
  // Fixes stale editor after trash, delete, archive, restore, tag change, etc.
  useEffect(() => {
    if (selectedNoteId && filteredNotes.length >= 0 && !filteredNotes.find((n) => n.id === selectedNoteId)) {
      setSelectedNoteId(undefined);
    }
  }, [selectedNoteId, filteredNotes]);

  // Note counts (include all notes)
  const noteCounts = useMemo(() => ({
    total: notes.notes.filter((n) => !n.trashed && !n.archived).length,
    trashed: notes.notes.filter((n) => n.trashed).length,
    archived: notes.notes.filter((n) => n.archived && !n.trashed).length,
  }), [notes.notes]);

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

  const handleNewTask = useCallback(async () => {
    navigateTo('tasks');
  }, [navigateTo]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.reload, tasks.reload, timeline.reload, reloadTimelines, reloadWhiteboards]);

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
    downloadFile(json, `browsernotes-backup-${date}.json`, 'application/json');
  }, []);

  const handleQuickLoad = useCallback((file: File) => {
    setPendingImportFile(file);
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!pendingImportFile) return;
    const text = await pendingImportFile.text();
    await importJSON(text);
    setPendingImportFile(null);
    notes.reload();
    tasks.reload();
    timeline.reload();
    reloadTimelines();
    reloadWhiteboards();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImportFile, notes.reload, tasks.reload, timeline.reload, reloadTimelines, reloadWhiteboards]);

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
    if (ev) setSelectedTimelineId(ev.timelineId);
    navigateTo('timeline', { selectedTimelineId: ev?.timelineId });
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
  if (showTrash) listTitle = 'Trash';
  else if (showArchive) listTitle = 'Archive';
  else if (selectedFolderId) {
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
    onCreateFolder: (name: string) => loggedCreateFolder(name),
    onDeleteFolder: (id: string) => { loggedDeleteFolder(id); if (selectedFolderId === id) { setSelectedFolderId(undefined); setSelectedNoteId(undefined); } },
    onDeleteFolderWithContents: (id: string) => { loggedDeleteFolderWithContents(id); if (selectedFolderId === id) { setSelectedFolderId(undefined); setSelectedNoteId(undefined); } },
    onRenameFolder: (id: string, name: string) => updateFolder(id, { name }),
    onOpenSettings: () => { setShowSettings(true); },
    noteCounts,
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
    whiteboardCount: whiteboards.length,
    onMoveNoteToFolder: handleMoveNoteToFolder,
    onRenameTag: (id: string, name: string) => updateTag(id, { name }),
    onDeleteTag: loggedDeleteTag,
    onEditFolder: setEditingFolderId,
    folderStatusFilter,
    onFolderStatusFilterChange: setFolderStatusFilter,
    investigationScopedCounts,
  }), [activeView, folders, tags, selectedFolderId, selectedTag, showTrash, showArchive, loggedCreateFolder, loggedDeleteFolder, loggedDeleteFolderWithContents, updateFolder, noteCounts, tasks.taskCounts, timeline.eventCounts, timelines, selectedTimelineId, loggedCreateTimeline, loggedDeleteTimeline, updateTimeline, timelineEventCounts, whiteboards, selectedWhiteboardId, loggedCreateWhiteboard, loggedDeleteWhiteboard, updateWhiteboard, handleMoveNoteToFolder, updateTag, loggedDeleteTag, navigateTo, folderStatusFilter, investigationScopedCounts]);

  const selectedFolder = useMemo(() => folders.find((f) => f.id === selectedFolderId), [folders, selectedFolderId]);
  const selectedTagObj = useMemo(() => tags.find((t) => t.name === selectedTag), [tags, selectedTag]);
  const editingFolder = useMemo(() => folders.find((f) => f.id === editingFolderId), [folders, editingFolderId]);
  const investigationEntityCounts = useMemo(() => {
    if (!editingFolderId) return { notes: 0, tasks: 0, events: 0, whiteboards: 0 };
    return {
      notes: notes.notes.filter((n) => n.folderId === editingFolderId && !n.trashed).length,
      tasks: tasks.tasks.filter((t) => t.folderId === editingFolderId).length,
      events: timeline.events.filter((e) => e.folderId === editingFolderId).length,
      whiteboards: whiteboards.filter((w) => w.folderId === editingFolderId).length,
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
      activeView={activeView}
      onViewChange={(v: ViewMode) => navigateTo(v)}
      entityCounts={investigationScopedCounts}
    />
  ) : null;

  return (
    <ScreenshareContext.Provider value={screenshareCtx}>
    <ActivityLogContext.Provider value={activityLog.log}>
      <AppLayout
        header={
          <Header
            onOpenSearch={() => setSearchOverlayOpen(true)}
            theme={settings.theme}
            onToggleTheme={toggleTheme}
            onNewNote={() => setShowQuickCapture(true)}
            onNewTask={handleNewTask}
            onToggleSidebar={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
            onMobileMenuToggle={() => setMobileSidebarOpen((prev) => !prev)}
            sidebarCollapsed={settings.sidebarCollapsed}
            onQuickSave={handleQuickSave}
            onQuickLoad={handleQuickLoad}
            activeView={activeView}
            onStartTour={() => tour.start(activeView)}
            selectedFolderName={selectedFolder?.name}
            screenshareMaxLevel={screenshareMaxLevel}
            onScreenshareChange={setScreenshareMaxLevel}
            effectiveClsLevels={effectiveClsLevels}
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
        <div className={activeView === 'graph' && !showSettings ? 'hidden' : 'flex flex-col flex-1 overflow-hidden'}>
        {filterBar}
        {showSettings ? (
          <SettingsPanel
            settings={settings}
            onUpdateSettings={updateSettings}
            notes={notes.notes}
            onImportComplete={handleImportComplete}
          />
        ) : activeView === 'ioc-stats' ? (
          <IOCStatsView
            notes={screensafeNotes}
            tasks={screensafeTasks}
            timelineEvents={screensafeTimelineEvents}
            settings={settings}
            scopedNotes={investigationNotes}
            scopedTasks={investigationTasks}
            scopedTimelineEvents={investigationTimelineEvents}
            selectedFolderId={selectedFolderId}
            selectedFolderName={selectedFolder?.name}
          />
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
            onToggleStar={loggedToggleStar}
            getFilteredEvents={timeline.getFilteredEvents}
            timelines={timelines}
            selectedTimelineId={selectedTimelineId}
            onTimelineReload={reloadTimelines}
            onEventsReload={timeline.reload}
            scopeLabel={selectedFolder?.name}
            selectedFolderId={selectedFolderId}
          />
        ) : activeView === 'whiteboard' ? (
          <WhiteboardView
            whiteboards={filteredWhiteboards}
            folders={folders}
            allTags={tags}
            onCreateWhiteboard={(name?: string) => loggedCreateWhiteboard(name, selectedFolderId)}
            onUpdateWhiteboard={updateWhiteboard}
            onDeleteWhiteboard={loggedDeleteWhiteboard}
            onCreateTag={loggedCreateTag}
            selectedWhiteboardId={selectedWhiteboardId ?? null}
            onWhiteboardSelect={(id) => setSelectedWhiteboardId(id ?? undefined)}
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
            onCreateTask={(data) => loggedCreateTask({ ...data, folderId: data.folderId ?? selectedFolderId, clsLevel: data.clsLevel ?? selectedFolder?.clsLevel })}
            viewMode={taskViewMode}
            onViewModeChange={setTaskViewMode}
            getTasksByStatus={(status) => tasks.getTasksByStatus(status, selectedFolderId)}
            allNotes={screensafeNotes}
            allTimelineEvents={screensafeTimelineEvents}
            scopeLabel={selectedFolder?.name}
            selectedFolderId={selectedFolderId}
          />
        ) : (
          /* Notes view — responsive: list OR editor on mobile */
          <div className="flex flex-1 overflow-hidden">
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
                showTrash={showTrash}
                onEmptyTrash={loggedEmptyTrash}
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
            onNavigateToTimelineEvent={(id) => { const ev = timeline.events.find((e) => e.id === id); if (ev) setSelectedTimelineId(ev.timelineId); navigateTo('timeline', { selectedTimelineId: ev?.timelineId }); }}
            onUpdateNote={notes.updateNote}
            onUpdateTask={tasks.updateTask}
            onUpdateEvent={timeline.updateEvent}
          />
        </div>
        </ErrorBoundary>
      </AppLayout>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileSidebarOpen(false)} />
          <div className="relative h-full w-60 shrink-0" onClick={(e) => e.stopPropagation()}>
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
            downloadFile(json, `browsernotes-${slug}-${date}.json`, 'application/json');
            activityLog.log('data', 'export', `Exported investigation "${folder?.name}"`, folderId, folder?.name);
          }}
        />
      )}

      {tour.isActive && tour.currentStep && (
        <>
          <TourOverlay targetRect={tour.targetRect} />
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
    </ScreenshareContext.Provider>
  );
}
