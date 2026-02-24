import { useState, useCallback, useMemo, useEffect } from 'react';
import { AppLayout } from './components/Layout/AppLayout';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { NoteList } from './components/Notes/NoteList';
import { NoteEditor } from './components/Notes/NoteEditor';
import { TaskListView } from './components/Tasks/TaskList';
import { TimelineView } from './components/Timeline/TimelineView';
import { QuickCapture } from './components/Clips/QuickCapture';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { useNotes } from './hooks/useNotes';
import { useTasks } from './hooks/useTasks';
import { useTimeline } from './hooks/useTimeline';
import { useTimelines } from './hooks/useTimelines';
import { useFolders } from './hooks/useFolders';
import { useTags } from './hooks/useTags';
import { useSettings } from './hooks/useSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import type { ViewMode, SortOption, EditorMode, Note, TaskViewMode, IOCType } from './types';
import { FileText } from 'lucide-react';
import { cn } from './lib/utils';
import { exportJSON, importJSON, downloadFile } from './lib/export';
import { ConfirmDialog } from './components/Common/ConfirmDialog';
import { SearchOverlay } from './components/Search/SearchOverlay';
import { BrowseShared } from './components/Settings/BrowseShared';
import { extractIOCs, mergeIOCAnalysis } from './lib/ioc-extractor';
import { ErrorBoundary } from './components/Common/ErrorBoundary';

export default function App() {
  const { settings, updateSettings, toggleTheme } = useSettings();
  const notes = useNotes();
  const tasks = useTasks();
  const timeline = useTimeline();
  const { timelines, createTimeline, updateTimeline, deleteTimeline, reload: reloadTimelines } = useTimelines();
  const { folders, createFolder, findOrCreateFolder, updateFolder, deleteFolder } = useFolders();
  const { tags, createTag } = useTags();

  // UI state — guard against stale 'clips' defaultView in localStorage
  const safeDefaultView: ViewMode = settings.defaultView === 'notes' || settings.defaultView === 'tasks' || settings.defaultView === 'timeline' ? settings.defaultView : 'notes';
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
  const [browseSharedOpen, setBrowseSharedOpen] = useState(false);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string>();

  // Listen for clip imports from the Chrome extension via postMessage
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      // Only accept messages from our own origin (extension injects into same page)
      // For file:// URLs both event.origin and window.location.origin are "null"
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
          const note = await notes.createNote({
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
  }, [findOrCreateFolder, notes.createNote]);

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

  // Handlers
  const handleDeleteFolder = useCallback(async (id: string) => {
    await deleteFolder(id);
    if (selectedFolderId === id) {
      setSelectedFolderId(undefined);
      setSelectedNoteId(undefined);
    }
  }, [deleteFolder, selectedFolderId]);

  const handleMoveNoteToFolder = useCallback((noteId: string, folderId: string) => {
    notes.updateNote(noteId, { folderId });
  }, [notes.updateNote]);

  const handleNewNote = useCallback(async () => {
    if (showQuickCapture) return;
    setShowSettings(false);
    setActiveView('notes');
    setShowTrash(false);
    setShowArchive(false);
    const note = await notes.createNote({
      folderId: selectedFolderId,
    });
    setSelectedNoteId(note.id);
  }, [notes.createNote, selectedFolderId, showQuickCapture]);

  const handleNewTask = useCallback(async () => {
    setShowSettings(false);
    setActiveView('tasks');
  }, []);

  const handleQuickCapture = useCallback(async (data: Partial<Note>) => {
    const note = await notes.createNote(data);
    setActiveView('notes');
    setSelectedNoteId(note.id);
  }, [notes.createNote]);

  const handleImportComplete = useCallback(() => {
    notes.reload();
    tasks.reload();
    timeline.reload();
    reloadTimelines();
  }, [notes.reload, tasks.reload, timeline.reload, reloadTimelines]);

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
  }, [pendingImportFile, notes.reload, tasks.reload, timeline.reload, reloadTimelines]);

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

  useKeyboardShortcuts({
    onNewNote: handleNewNote,
    onNewTask: handleNewTask,
    onSearch: () => setSearchOverlayOpen(true),
    onSave: handleQuickSave,
    onTogglePreview: handleToggleEditorMode,
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
    onCreateFolder: (name: string) => createFolder(name),
    onDeleteFolder: handleDeleteFolder,
    onRenameFolder: (id: string, name: string) => updateFolder(id, { name }),
    onOpenSettings: () => { setShowSettings(true); },
    noteCounts,
    taskCounts: tasks.taskCounts,
    timelineCounts: timeline.eventCounts,
    timelines,
    selectedTimelineId,
    onTimelineSelect: setSelectedTimelineId,
    onCreateTimeline: (name: string) => createTimeline(name),
    onDeleteTimeline: (id: string) => { deleteTimeline(id); if (selectedTimelineId === id) setSelectedTimelineId(undefined); },
    onRenameTimeline: (id: string, name: string) => updateTimeline(id, { name }),
    timelineEventCounts,
    onMoveNoteToFolder: handleMoveNoteToFolder,
  }), [activeView, folders, tags, selectedFolderId, selectedTag, showTrash, showArchive, createFolder, handleDeleteFolder, updateFolder, noteCounts, tasks.taskCounts, timeline.eventCounts, timelines, selectedTimelineId, createTimeline, deleteTimeline, updateTimeline, timelineEventCounts, handleMoveNoteToFolder]);

  return (
    <>
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
        {showSettings ? (
          <SettingsPanel
            settings={settings}
            onUpdateSettings={updateSettings}
            notes={notes.notes}
            onImportComplete={handleImportComplete}
            onOpenBrowseShared={() => setBrowseSharedOpen(true)}
          />
        ) : activeView === 'timeline' ? (
          <TimelineView
            events={filteredTimelineEvents}
            allTags={tags}
            folders={folders}
            onCreateTag={createTag}
            onCreateEvent={(data) => timeline.createEvent({ ...data, timelineId: selectedTimelineId || timelines[0]?.id || '' })}
            onUpdateEvent={timeline.updateEvent}
            onDeleteEvent={timeline.deleteEvent}
            onToggleStar={timeline.toggleStar}
            getFilteredEvents={timeline.getFilteredEvents}
            timelines={timelines}
            selectedTimelineId={selectedTimelineId}
            onTimelineReload={reloadTimelines}
            onEventsReload={timeline.reload}
          />
        ) : activeView === 'tasks' ? (
          <TaskListView
            tasks={filteredTasks}
            allTags={tags}
            folders={folders}
            onCreateTag={createTag}
            onToggleComplete={tasks.toggleComplete}
            onUpdateTask={tasks.updateTask}
            onDeleteTask={tasks.deleteTask}
            onCreateTask={(data) => tasks.createTask(data)}
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
                onEmptyTrash={notes.emptyTrash}
                selectedIOCTypes={selectedIOCTypes}
                onIOCTypesChange={setSelectedIOCTypes}
                folders={folders}
              />
            </div>
            <div className={cn('flex-1 min-w-0 overflow-hidden', !selectedNote && 'hidden md:block')}>
              {selectedNote ? (
                <NoteEditor
                  note={selectedNote}
                  onUpdate={notes.updateNote}
                  onTrash={notes.trashNote}
                  onRestore={notes.restoreNote}
                  onTogglePin={notes.togglePin}
                  onToggleArchive={notes.toggleArchive}
                  allTags={tags}
                  folders={folders}
                  onCreateTag={createTag}
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
      />

      <BrowseShared
        open={browseSharedOpen}
        onClose={() => setBrowseSharedOpen(false)}
        onImportComplete={handleImportComplete}
      />
    </>
  );
}
