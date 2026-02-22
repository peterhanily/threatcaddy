import { useState, useCallback, useMemo, useEffect } from 'react';
import { AppLayout } from './components/Layout/AppLayout';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { NoteList } from './components/Notes/NoteList';
import { NoteEditor } from './components/Notes/NoteEditor';
import { TaskListView } from './components/Tasks/TaskList';
import { QuickCapture } from './components/Clips/QuickCapture';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { useNotes } from './hooks/useNotes';
import { useTasks } from './hooks/useTasks';
import { useFolders } from './hooks/useFolders';
import { useTags } from './hooks/useTags';
import { useSettings } from './hooks/useSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import type { ViewMode, SortOption, EditorMode, Note, TaskViewMode } from './types';
import { FileText } from 'lucide-react';
import { cn } from './lib/utils';
import { exportJSON, importJSON, downloadFile } from './lib/export';
import { ConfirmDialog } from './components/Common/ConfirmDialog';

export default function App() {
  const { settings, updateSettings, toggleTheme } = useSettings();
  const notes = useNotes();
  const tasks = useTasks();
  const { folders, createFolder, findOrCreateFolder, updateFolder, deleteFolder } = useFolders();
  const { tags, createTag } = useTags();

  // UI state
  const [activeView, setActiveView] = useState<ViewMode>(settings.defaultView);
  const [selectedNoteId, setSelectedNoteId] = useState<string>();
  const [selectedFolderId, setSelectedFolderId] = useState<string>();
  const [selectedTag, setSelectedTag] = useState<string>();
  const [showTrash, setShowTrash] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchFocusRequested, setSearchFocusRequested] = useState(false);
  const [sort, setSort] = useState<SortOption>('updatedAt');
  const [editorMode, setEditorMode] = useState<EditorMode>(settings.editorMode);
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>(settings.taskViewMode);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);

  // Debounce search for filtering performance
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  // Listen for clip imports from the Chrome extension via postMessage
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (event.data?.type !== 'BROWSERNOTES_IMPORT_CLIPS') return;
      const clips = event.data.clips;
      if (!Array.isArray(clips) || clips.length === 0) return;

      try {
        const clipsFolder = await findOrCreateFolder('Clips');
        for (const clip of clips) {
          await notes.createNote({
            title: clip.title || clip.content?.substring(0, 80) || 'Clip',
            content: clip.content || '',
            folderId: clipsFolder.id,
            sourceUrl: clip.sourceUrl,
            sourceTitle: clip.sourceTitle,
            createdAt: clip.createdAt || Date.now(),
          });
        }
        setActiveView('notes');
        setSelectedFolderId(clipsFolder.id);
      } catch (error) {
        console.error('Failed to import clips:', error);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [findOrCreateFolder, notes.createNote]);

  // Filtered notes
  const filteredNotes = useMemo(
    () =>
      notes.getFilteredNotes({
        folderId: selectedFolderId,
        tag: selectedTag,
        showTrashed: showTrash,
        showArchived: showArchive,
        search: debouncedSearch,
        sort,
      }),
    [notes.getFilteredNotes, selectedFolderId, selectedTag, showTrash, showArchive, debouncedSearch, sort]
  );

  // Filtered tasks
  const filteredTasks = useMemo(
    () =>
      tasks.getFilteredTasks({
        folderId: selectedFolderId,
        tag: selectedTag,
        search: debouncedSearch,
      }),
    [tasks.getFilteredTasks, selectedFolderId, selectedTag, debouncedSearch]
  );

  // Selected note
  const selectedNote = useMemo(
    () => notes.notes.find((n) => n.id === selectedNoteId),
    [notes.notes, selectedNoteId]
  );

  // Note counts
  const noteCounts = useMemo(() => ({
    total: notes.notes.filter((n) => !n.trashed && !n.archived).length,
    trashed: notes.notes.filter((n) => n.trashed).length,
    archived: notes.notes.filter((n) => n.archived && !n.trashed).length,
  }), [notes.notes]);

  // Handlers
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
  }, [notes.reload, tasks.reload]);

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
  }, [pendingImportFile, notes.reload, tasks.reload]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNewNote: handleNewNote,
    onNewTask: handleNewTask,
    onSearch: () => setSearchFocusRequested(true),
    onSave: handleQuickSave,
    onTogglePreview: handleToggleEditorMode,
    onEscape: () => {
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

  return (
    <>
      <AppLayout
        header={
          <Header
            search={search}
            onSearchChange={setSearch}
            searchFocusRequested={searchFocusRequested}
            onSearchFocusHandled={() => setSearchFocusRequested(false)}
            theme={settings.theme}
            onToggleTheme={toggleTheme}
            onNewNote={() => setShowQuickCapture(true)}
            onNewTask={handleNewTask}
            onToggleSidebar={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
            onMobileMenuToggle={() => setMobileSidebarOpen((prev) => !prev)}
            sidebarCollapsed={settings.sidebarCollapsed}
            onQuickSave={handleQuickSave}
            onQuickLoad={handleQuickLoad}
          />
        }
        sidebar={
          <Sidebar
            activeView={activeView}
            onViewChange={(v) => { setActiveView(v); setShowSettings(false); }}
            folders={folders}
            tags={tags}
            selectedFolderId={selectedFolderId}
            onFolderSelect={setSelectedFolderId}
            selectedTag={selectedTag}
            onTagSelect={setSelectedTag}
            showTrash={showTrash}
            onShowTrash={setShowTrash}
            showArchive={showArchive}
            onShowArchive={setShowArchive}
            onCreateFolder={(name) => createFolder(name)}
            onDeleteFolder={deleteFolder}
            onRenameFolder={(id, name) => updateFolder(id, { name })}
            onOpenSettings={() => { setShowSettings(true); }}
            collapsed={settings.sidebarCollapsed}
            onToggleCollapsed={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
            noteCounts={noteCounts}
            taskCounts={tasks.taskCounts}
            onNavigate={() => setSelectedNoteId(undefined)}
          />
        }
      >
        {showSettings ? (
          <SettingsPanel
            settings={settings}
            onUpdateSettings={updateSettings}
            notes={notes.notes}
            onImportComplete={handleImportComplete}
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
          /* Notes & Clips view — responsive: list OR editor on mobile */
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
                  onCreateTag={createTag}
                  editorMode={editorMode}
                  onEditorModeChange={setEditorMode}
                  onBack={() => setSelectedNoteId(undefined)}
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
      </AppLayout>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileSidebarOpen(false)} />
          <div className="relative h-full w-60 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Sidebar
              activeView={activeView}
              onViewChange={(v) => { setActiveView(v); setShowSettings(false); }}
              folders={folders}
              tags={tags}
              selectedFolderId={selectedFolderId}
              onFolderSelect={setSelectedFolderId}
              selectedTag={selectedTag}
              onTagSelect={setSelectedTag}
              showTrash={showTrash}
              onShowTrash={setShowTrash}
              showArchive={showArchive}
              onShowArchive={setShowArchive}
              onCreateFolder={(name) => createFolder(name)}
              onDeleteFolder={deleteFolder}
              onRenameFolder={(id, name) => updateFolder(id, { name })}
              onOpenSettings={() => { setShowSettings(true); }}
              collapsed={false}
              onToggleCollapsed={() => setMobileSidebarOpen(false)}
              noteCounts={noteCounts}
              taskCounts={tasks.taskCounts}
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
    </>
  );
}
