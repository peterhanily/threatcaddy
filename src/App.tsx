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
import type { ViewMode, SortOption, EditorMode, Note, TaskViewMode, IOCType } from './types';
import { FileText } from 'lucide-react';
import { cn } from './lib/utils';
import { exportJSON, importJSON, downloadFile } from './lib/export';
import { ConfirmDialog } from './components/Common/ConfirmDialog';
import { SearchOverlay } from './components/Search/SearchOverlay';
import { extractIOCs, mergeIOCAnalysis } from './lib/ioc-extractor';
import { ErrorBoundary } from './components/Common/ErrorBoundary';
import { ActiveFilterBar } from './components/Common/ActiveFilterBar';
import { useTour } from './hooks/useTour';
import { TourOverlay } from './components/Tour/TourOverlay';
import { TourTooltip } from './components/Tour/TourTooltip';

export default function App() {
  const { settings, updateSettings, toggleTheme } = useSettings();
  const notes = useNotes();
  const tasks = useTasks();
  const timeline = useTimeline();
  const { timelines, createTimeline, updateTimeline, deleteTimeline, reload: reloadTimelines } = useTimelines();
  const { whiteboards, createWhiteboard, updateWhiteboard, deleteWhiteboard, reload: reloadWhiteboards } = useWhiteboards();
  const { folders, createFolder, findOrCreateFolder, updateFolder, deleteFolder } = useFolders();
  const { tags, createTag, updateTag, deleteTag } = useTags();

  const tour = useTour({
    onComplete: () => updateSettings({ tourCompleted: true }),
  });

  const activityLog = useActivityLog();

  // Instrumented wrappers for activity logging
  const loggedCreateNote = useCallback(async (partial?: Partial<Note>) => {
    const note = await notes.createNote(partial);
    activityLog.log('note', 'create', `Created note "${note.title}"`, note.id, note.title);
    return note;
  }, [notes.createNote, activityLog.log]);

  const loggedTrashNote = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.trashNote(id);
    activityLog.log('note', 'trash', `Trashed note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes.trashNote, notes.notes, activityLog.log]);

  const loggedRestoreNote = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.restoreNote(id);
    activityLog.log('note', 'restore', `Restored note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes.restoreNote, notes.notes, activityLog.log]);

  const loggedTogglePin = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.togglePin(id);
    const action = note?.pinned ? 'unpin' : 'pin';
    activityLog.log('note', action, `${action === 'pin' ? 'Pinned' : 'Unpinned'} note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes.togglePin, notes.notes, activityLog.log]);

  const loggedToggleArchive = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.toggleArchive(id);
    const action = note?.archived ? 'unarchive' : 'archive';
    activityLog.log('note', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes.toggleArchive, notes.notes, activityLog.log]);

  const loggedEmptyTrash = useCallback(async () => {
    const count = notes.notes.filter((n) => n.trashed).length;
    await notes.emptyTrash();
    activityLog.log('note', 'empty-trash', `Emptied trash (${count} notes)`);
  }, [notes.emptyTrash, notes.notes, activityLog.log]);

  const loggedCreateTask = useCallback(async (partial?: Partial<import('./types').Task>) => {
    const task = await tasks.createTask(partial);
    activityLog.log('task', 'create', `Created task "${task.title || 'Untitled'}"`, task.id, task.title);
    return task;
  }, [tasks.createTask, activityLog.log]);

  const loggedDeleteTask = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.deleteTask(id);
    activityLog.log('task', 'delete', `Deleted task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks.deleteTask, tasks.tasks, activityLog.log]);

  const loggedToggleComplete = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.toggleComplete(id);
    const action = task?.completed ? 'reopen' : 'complete';
    activityLog.log('task', action, `${action === 'complete' ? 'Completed' : 'Reopened'} task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks.toggleComplete, tasks.tasks, activityLog.log]);

  const loggedCreateEvent = useCallback(async (data: Partial<import('./types').TimelineEvent>) => {
    const event = await timeline.createEvent(data);
    activityLog.log('timeline', 'create', `Created timeline event "${event.title || 'Untitled'}"`, event.id, event.title);
    return event;
  }, [timeline.createEvent, activityLog.log]);

  const loggedDeleteEvent = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.deleteEvent(id);
    activityLog.log('timeline', 'delete', `Deleted timeline event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline.deleteEvent, timeline.events, activityLog.log]);

  const loggedToggleStar = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.toggleStar(id);
    const action = event?.starred ? 'unstar' : 'star';
    activityLog.log('timeline', action, `${action === 'star' ? 'Starred' : 'Unstarred'} event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline.toggleStar, timeline.events, activityLog.log]);

  const loggedCreateTimeline = useCallback(async (name: string) => {
    const tl = await createTimeline(name);
    activityLog.log('timeline', 'create', `Created timeline "${name}"`, tl.id, name);
    return tl;
  }, [createTimeline, activityLog.log]);

  const loggedDeleteTimeline = useCallback(async (id: string) => {
    const tl = timelines.find((t) => t.id === id);
    await deleteTimeline(id);
    activityLog.log('timeline', 'delete', `Deleted timeline "${tl?.name || 'Untitled'}"`, id, tl?.name);
  }, [deleteTimeline, timelines, activityLog.log]);

  const loggedCreateWhiteboard = useCallback(async (name?: string) => {
    const wb = await createWhiteboard(name);
    activityLog.log('whiteboard', 'create', `Created whiteboard "${wb.name}"`, wb.id, wb.name);
    return wb;
  }, [createWhiteboard, activityLog.log]);

  const loggedDeleteWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboards.find((w) => w.id === id);
    await deleteWhiteboard(id);
    activityLog.log('whiteboard', 'delete', `Deleted whiteboard "${wb?.name || 'Untitled'}"`, id, wb?.name);
  }, [deleteWhiteboard, whiteboards, activityLog.log]);

  const loggedCreateFolder = useCallback(async (name: string) => {
    const folder = await createFolder(name);
    activityLog.log('folder', 'create', `Created folder "${name}"`, folder.id, name);
    return folder;
  }, [createFolder, activityLog.log]);

  const loggedDeleteFolder = useCallback(async (id: string) => {
    const folder = folders.find((f) => f.id === id);
    await deleteFolder(id);
    activityLog.log('folder', 'delete', `Deleted folder "${folder?.name || 'Untitled'}"`, id, folder?.name);
  }, [deleteFolder, folders, activityLog.log]);

  const loggedCreateTag = useCallback(async (name: string) => {
    const tag = await createTag(name);
    activityLog.log('tag', 'create', `Created tag "${name}"`, tag.id, name);
    return tag;
  }, [createTag, activityLog.log]);

  const loggedDeleteTag = useCallback(async (id: string) => {
    const tag = tags.find((t) => t.id === id);
    await deleteTag(id);
    activityLog.log('tag', 'delete', `Deleted tag "${tag?.name || ''}"`, id, tag?.name);
  }, [deleteTag, tags, activityLog.log]);

  // UI state — guard against stale 'clips' defaultView in localStorage
  const safeDefaultView: ViewMode = settings.defaultView === 'notes' || settings.defaultView === 'tasks' || settings.defaultView === 'timeline' || settings.defaultView === 'whiteboard' || settings.defaultView === 'activity' ? settings.defaultView : 'notes';
  const [activeView, setActiveView] = useState<ViewMode>(safeDefaultView);
  const [selectedNoteId, setSelectedNoteId] = useState<string>();
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
        const clipsFolder = await findOrCreateFolder('Clips');
        let firstNote = null;
        for (const clip of clips) {
          // Sanitize clip fields — only accept expected string/number types
          const rawContent = typeof clip.content === 'string' ? clip.content : '';
          const sourceUrl = typeof clip.sourceUrl === 'string' ? clip.sourceUrl : '';
          const sourceTitle = typeof clip.sourceTitle === 'string' ? clip.sourceTitle : '';
          const clipTitle = typeof clip.title === 'string' ? clip.title : '';
          const createdAt = typeof clip.createdAt === 'number' ? clip.createdAt : Date.now();
          const timestamp = new Date(createdAt).toLocaleString();
          const content = `*Clipped ${timestamp}*\n\n${rawContent}`;
          const freshIOCs = extractIOCs(rawContent);
          const iocAnalysis = mergeIOCAnalysis(undefined, freshIOCs);
          const iocTypes = [...new Set(freshIOCs.filter((i) => !i.dismissed).map((i) => i.type))];
          const note = await loggedCreateNote({
            title: sourceUrl || clipTitle || rawContent.substring(0, 80) || 'Clip',
            content,
            folderId: clipsFolder.id,
            sourceUrl,
            sourceTitle,
            createdAt,
            iocAnalysis,
            iocTypes,
          });
          if (!firstNote) firstNote = note;
        }
        setActiveView('notes');
        setSelectedFolderId(clipsFolder.id);
        if (firstNote) setSelectedNoteId(firstNote.id);
      } catch (error) {
        console.error('Failed to import clips:', error);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [findOrCreateFolder, loggedCreateNote]);

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
    [notes.getFilteredNotes, selectedFolderId, selectedTag, showTrash, showArchive, sort, selectedIOCTypes]
  );

  // Filtered tasks
  const filteredTasks = useMemo(
    () =>
      tasks.getFilteredTasks({
        folderId: selectedFolderId,
        tag: selectedTag,
      }),
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
  }, [notes.updateNote]);

  const handleNewNote = useCallback(async () => {
    if (showQuickCapture) return;
    setShowSettings(false);
    setActiveView('notes');
    setShowTrash(false);
    setShowArchive(false);
    const note = await loggedCreateNote({
      folderId: selectedFolderId,
    });
    setSelectedNoteId(note.id);
  }, [loggedCreateNote, selectedFolderId, showQuickCapture]);

  const handleNewTask = useCallback(async () => {
    setShowSettings(false);
    setActiveView('tasks');
  }, []);

  const handleQuickCapture = useCallback(async (data: Partial<Note>) => {
    const note = await loggedCreateNote(data);
    setActiveView('notes');
    setSelectedNoteId(note.id);
  }, [loggedCreateNote]);

  const handleImportComplete = useCallback(() => {
    notes.reload();
    tasks.reload();
    timeline.reload();
    reloadTimelines();
    reloadWhiteboards();
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
  }, [pendingImportFile, notes.reload, tasks.reload, timeline.reload, reloadTimelines, reloadWhiteboards]);

  // Keyboard shortcuts
  // Search overlay navigation callbacks
  const handleSearchNavigateToNote = useCallback((id: string) => {
    setActiveView('notes');
    setSelectedNoteId(id);
    setSelectedFolderId(undefined);
    setSelectedTag(undefined);
    setShowTrash(false);
    setShowArchive(false);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSearchNavigateToTask = useCallback((_id: string) => {
    setActiveView('tasks');
    setSelectedFolderId(undefined);
    setSelectedTag(undefined);
  }, []);

  const handleSearchNavigateToTimeline = useCallback((id: string) => {
    setActiveView('timeline');
    // Find the event to select its timeline
    const ev = timeline.events.find((e) => e.id === id);
    if (ev) setSelectedTimelineId(ev.timelineId);
  }, [timeline.events]);

  const handleSearchNavigateToWhiteboard = useCallback((id: string) => {
    setActiveView('whiteboard');
    setSelectedWhiteboardId(id);
  }, []);

  useKeyboardShortcuts({
    onNewNote: handleNewNote,
    onNewTask: handleNewTask,
    onSearch: () => setSearchOverlayOpen(true),
    onSave: handleQuickSave,
    onTogglePreview: handleToggleEditorMode,
    onSwitchView: (view) => { setActiveView(view); setShowSettings(false); },
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
    listTitle = folder?.name || 'Folder';
  }
  else if (selectedTag) listTitle = `#${selectedTag}`;

  const sidebarProps = useMemo(() => ({
    activeView,
    onViewChange: (v: ViewMode) => { setActiveView(v); setShowSettings(false); },
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
    onCreateWhiteboard: loggedCreateWhiteboard,
    onDeleteWhiteboard: (id: string) => { loggedDeleteWhiteboard(id); if (selectedWhiteboardId === id) setSelectedWhiteboardId(undefined); },
    onRenameWhiteboard: (id: string, name: string) => updateWhiteboard(id, { name }),
    whiteboardCount: whiteboards.length,
    onMoveNoteToFolder: handleMoveNoteToFolder,
    onRenameTag: (id: string, name: string) => updateTag(id, { name }),
    onDeleteTag: loggedDeleteTag,
  }), [activeView, folders, tags, selectedFolderId, selectedTag, showTrash, showArchive, loggedCreateFolder, loggedDeleteFolder, updateFolder, noteCounts, tasks.taskCounts, timeline.eventCounts, timelines, selectedTimelineId, loggedCreateTimeline, loggedDeleteTimeline, updateTimeline, timelineEventCounts, whiteboards, selectedWhiteboardId, loggedCreateWhiteboard, loggedDeleteWhiteboard, updateWhiteboard, handleMoveNoteToFolder, updateTag, loggedDeleteTag]);

  const selectedFolder = useMemo(() => folders.find((f) => f.id === selectedFolderId), [folders, selectedFolderId]);
  const selectedTagObj = useMemo(() => tags.find((t) => t.name === selectedTag), [tags, selectedTag]);

  const filterBar = (selectedFolderId || selectedTag) ? (
    <ActiveFilterBar
      folderName={selectedFolder?.name}
      folderColor={selectedFolder?.color}
      tagName={selectedTag}
      tagColor={selectedTagObj?.color}
      onClear={() => { setSelectedFolderId(undefined); setSelectedTag(undefined); }}
    />
  ) : null;

  return (
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
            onStartTour={tour.start}
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
        <div className="flex flex-col flex-1 overflow-hidden">
        {filterBar}
        {showSettings ? (
          <SettingsPanel
            settings={settings}
            onUpdateSettings={updateSettings}
            notes={notes.notes}
            onImportComplete={handleImportComplete}
          />
        ) : activeView === 'activity' ? (
          <ActivityLogView
            entries={activityLog.entries}
            getFiltered={activityLog.getFiltered}
            onClear={activityLog.clear}
          />
        ) : activeView === 'timeline' ? (
          <TimelineView
            events={filteredTimelineEvents}
            allTags={tags}
            folders={folders}
            onCreateTag={loggedCreateTag}
            onCreateEvent={(data) => loggedCreateEvent({ ...data, timelineId: selectedTimelineId || timelines[0]?.id || '' })}
            onUpdateEvent={timeline.updateEvent}
            onDeleteEvent={loggedDeleteEvent}
            onToggleStar={loggedToggleStar}
            getFilteredEvents={timeline.getFilteredEvents}
            timelines={timelines}
            selectedTimelineId={selectedTimelineId}
            onTimelineReload={reloadTimelines}
            onEventsReload={timeline.reload}
          />
        ) : activeView === 'whiteboard' ? (
          <WhiteboardView
            whiteboards={filteredWhiteboards}
            folders={folders}
            allTags={tags}
            onCreateWhiteboard={loggedCreateWhiteboard}
            onUpdateWhiteboard={updateWhiteboard}
            onDeleteWhiteboard={loggedDeleteWhiteboard}
            onCreateTag={loggedCreateTag}
            selectedWhiteboardId={selectedWhiteboardId ?? null}
            onWhiteboardSelect={(id) => setSelectedWhiteboardId(id ?? undefined)}
          />
        ) : activeView === 'tasks' ? (
          <TaskListView
            tasks={filteredTasks}
            allTags={tags}
            folders={folders}
            onCreateTag={loggedCreateTag}
            onToggleComplete={loggedToggleComplete}
            onUpdateTask={tasks.updateTask}
            onDeleteTask={loggedDeleteTask}
            onCreateTask={(data) => loggedCreateTask(data)}
            viewMode={taskViewMode}
            onViewModeChange={setTaskViewMode}
            getTasksByStatus={(status) => tasks.getTasksByStatus(status, selectedFolderId)}
          />
        ) : (
          /* Notes view — responsive: list OR editor on mobile */
          <div className="flex flex-1 overflow-hidden">
            <div className={cn(
              'shrink-0 h-full',
              selectedNote ? 'hidden md:block md:w-72' : 'w-full md:w-72'
            )}>
              <NoteList
                notes={filteredNotes}
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
        notes={notes.notes}
        tasks={tasks.tasks}
        clipsFolderId={clipsFolderId}
        onNavigateToNote={handleSearchNavigateToNote}
        onNavigateToTask={handleSearchNavigateToTask}
        timelineEvents={timeline.events}
        whiteboards={whiteboards}
        onNavigateToTimeline={handleSearchNavigateToTimeline}
        onNavigateToWhiteboard={handleSearchNavigateToWhiteboard}
      />

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
  );
}
