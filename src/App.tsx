import { useState, useCallback, useMemo } from 'react';
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

export default function App() {
  const { settings, updateSettings, toggleTheme } = useSettings();
  const notes = useNotes();
  const tasks = useTasks();
  const { folders, createFolder, updateFolder, deleteFolder } = useFolders();
  const { tags, createTag } = useTags();

  // UI state
  const [activeView, setActiveView] = useState<ViewMode>(settings.defaultView);
  const [selectedNoteId, setSelectedNoteId] = useState<string>();
  const [selectedFolderId, setSelectedFolderId] = useState<string>();
  const [selectedTag, setSelectedTag] = useState<string>();
  const [showTrash, setShowTrash] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [search, setSearch] = useState('');
  const [searchFocusRequested, setSearchFocusRequested] = useState(false);
  const [sort, setSort] = useState<SortOption>('updatedAt');
  const [editorMode, setEditorMode] = useState<EditorMode>(settings.editorMode);
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>(settings.taskViewMode);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Filtered notes
  const filteredNotes = useMemo(
    () =>
      notes.getFilteredNotes({
        folderId: selectedFolderId,
        tag: selectedTag,
        showTrashed: showTrash,
        showArchived: showArchive,
        search,
        sort,
      }),
    [notes.getFilteredNotes, selectedFolderId, selectedTag, showTrash, showArchive, search, sort]
  );

  // Filtered tasks
  const filteredTasks = useMemo(
    () =>
      tasks.getFilteredTasks({
        folderId: selectedFolderId,
        tag: selectedTag,
        search,
      }),
    [tasks.getFilteredTasks, selectedFolderId, selectedTag, search]
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

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNewNote: handleNewNote,
    onNewTask: handleNewTask,
    onSearch: () => setSearchFocusRequested(true),
    onSave: () => {/* auto-saves, show feedback */},
    onTogglePreview: handleToggleEditorMode,
    onEscape: () => {
      setShowQuickCapture(false);
      setShowSettings(false);
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
            sidebarCollapsed={settings.sidebarCollapsed}
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
          /* Notes & Clips view */
          <div className="flex flex-1 overflow-hidden">
            <NoteList
              notes={filteredNotes}
              selectedId={selectedNoteId}
              onSelect={setSelectedNoteId}
              sort={sort}
              onSortChange={setSort}
              title={listTitle}
            />
            <div className="flex-1 overflow-hidden">
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

      <QuickCapture
        open={showQuickCapture}
        onClose={() => setShowQuickCapture(false)}
        onCapture={handleQuickCapture}
      />
    </>
  );
}
