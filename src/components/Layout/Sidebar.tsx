import React, { useState } from 'react';
import {
  FileText, ListChecks, Clock, FolderOpen, Tag, Trash2,
  Archive, ChevronDown, ChevronRight, Plus, X, Settings,
  PanelLeftClose, Github, Download, Chrome,
} from 'lucide-react';
import type { Folder, Tag as TagType, Timeline, ViewMode } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { cn } from '../../lib/utils';

interface SidebarProps {
  activeView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  folders: Folder[];
  tags: TagType[];
  selectedFolderId?: string;
  onFolderSelect: (id?: string) => void;
  selectedTag?: string;
  onTagSelect: (name?: string) => void;
  showTrash: boolean;
  onShowTrash: (show: boolean) => void;
  showArchive: boolean;
  onShowArchive: (show: boolean) => void;
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  noteCounts: { total: number; trashed: number; archived: number };
  taskCounts: { todo: number; 'in-progress': number; done: number; total: number };
  timelineCounts?: { total: number; starred: number };
  timelines?: Timeline[];
  selectedTimelineId?: string;
  onTimelineSelect?: (id?: string) => void;
  onCreateTimeline?: (name: string) => void;
  onDeleteTimeline?: (id: string) => void;
  onRenameTimeline?: (id: string, name: string) => void;
  timelineEventCounts?: Record<string, number>;
  onNavigate?: () => void;
  onMoveNoteToFolder?: (noteId: string, folderId: string) => void;
}

export function Sidebar({
  activeView,
  onViewChange,
  folders,
  tags,
  selectedFolderId,
  onFolderSelect,
  selectedTag,
  onTagSelect,
  showTrash,
  onShowTrash,
  showArchive,
  onShowArchive,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onOpenSettings,
  collapsed,
  onToggleCollapsed,
  noteCounts,
  taskCounts,
  timelineCounts,
  timelines = [],
  selectedTimelineId,
  onTimelineSelect,
  onCreateTimeline,
  onDeleteTimeline,
  onRenameTimeline,
  timelineEventCounts = {},
  onNavigate,
  onMoveNoteToFolder,
}: SidebarProps) {
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const [timelinesOpen, setTimelinesOpen] = useState(true);
  const [newTimelineName, setNewTimelineName] = useState('');
  const [showNewTimeline, setShowNewTimeline] = useState(false);
  const [editingTimeline, setEditingTimeline] = useState<string | null>(null);
  const [editTimelineName, setEditTimelineName] = useState('');
  const [deletingTimelineId, setDeletingTimelineId] = useState<string | null>(null);

  if (collapsed) return null;

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName('');
      setShowNewFolder(false);
    }
  };

  const handleRenameFolder = (id: string) => {
    if (editFolderName.trim()) {
      onRenameFolder(id, editFolderName.trim());
      setEditingFolder(null);
    }
  };

  const handleCreateTimeline = () => {
    if (newTimelineName.trim() && onCreateTimeline) {
      onCreateTimeline(newTimelineName.trim());
      setNewTimelineName('');
      setShowNewTimeline(false);
    }
  };

  const handleRenameTimeline = (id: string) => {
    if (editTimelineName.trim() && onRenameTimeline) {
      onRenameTimeline(id, editTimelineName.trim());
      setEditingTimeline(null);
    }
  };

  const clearFilters = () => {
    onFolderSelect(undefined);
    onTagSelect(undefined);
    onShowTrash(false);
    onShowArchive(false);
  };

  const nav = (fn: () => void) => {
    fn();
    onNavigate?.();
  };

  return (
    <aside className="w-60 border-r border-gray-800 sidebar-glass flex flex-col h-full shrink-0 overflow-hidden" role="navigation" aria-label="Main navigation">
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <span className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Navigate</span>
        <button onClick={onToggleCollapsed} className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300" aria-label="Collapse sidebar" title="Collapse sidebar">
          <PanelLeftClose size={16} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1" aria-label="Views">
        {/* Views */}
        <SidebarItem
          icon={<FileText size={18} />}
          label="Notes"
          count={noteCounts.total}
          active={activeView === 'notes' && !showTrash && !showArchive && !selectedFolderId && !selectedTag}
          onClick={() => nav(() => { onViewChange('notes'); clearFilters(); })}
        />
        <SidebarItem
          icon={<ListChecks size={18} />}
          label="Tasks"
          count={taskCounts.total}
          active={activeView === 'tasks' && !selectedFolderId && !selectedTag}
          onClick={() => nav(() => { onViewChange('tasks'); clearFilters(); })}
        />
        <SidebarItem
          icon={<Clock size={18} />}
          label="Timeline"
          count={timelineCounts?.total}
          active={activeView === 'timeline' && !selectedFolderId && !selectedTag}
          onClick={() => nav(() => { onViewChange('timeline'); clearFilters(); })}
        />
        {/* Timelines — only in timeline view */}
        {activeView === 'timeline' && (
          <div className="pt-3">
            <button
              onClick={() => setTimelinesOpen(!timelinesOpen)}
              className="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
              aria-expanded={timelinesOpen}
            >
              {timelinesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Timelines
              <button
                onClick={(e) => { e.stopPropagation(); setShowNewTimeline(true); }}
                className="ml-auto p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
                aria-label="Create timeline"
                title="Create timeline"
              >
                <Plus size={14} />
              </button>
            </button>

            {timelinesOpen && (
              <div className="mt-1 space-y-0.5">
                {showNewTimeline && (
                  <div className="flex items-center gap-1 px-2">
                    <input
                      autoFocus
                      value={newTimelineName}
                      onChange={(e) => setNewTimelineName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTimeline(); if (e.key === 'Escape') setShowNewTimeline(false); }}
                      placeholder="Timeline name"
                      aria-label="New timeline name"
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                    />
                    <button onClick={handleCreateTimeline} className="text-accent hover:text-accent-hover" aria-label="Confirm create timeline" title="Create timeline">
                      <Plus size={14} />
                    </button>
                    <button onClick={() => setShowNewTimeline(false)} className="text-gray-500 hover:text-gray-300" aria-label="Cancel" title="Cancel">
                      <X size={14} />
                    </button>
                  </div>
                )}
                <SidebarItem
                  icon={<Clock size={16} />}
                  label="All Events"
                  count={timelineCounts?.total}
                  active={!selectedTimelineId}
                  onClick={() => nav(() => { onTimelineSelect?.(undefined); })}
                />
                {timelines.map((tl) => (
                  <div key={tl.id} className="group relative">
                    {editingTimeline === tl.id ? (
                      <div className="flex items-center gap-1 px-2">
                        <input
                          autoFocus
                          value={editTimelineName}
                          onChange={(e) => setEditTimelineName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenameTimeline(tl.id); if (e.key === 'Escape') setEditingTimeline(null); }}
                          aria-label="Rename timeline"
                          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                        />
                      </div>
                    ) : (
                      <SidebarItem
                        icon={<Clock size={16} style={{ color: tl.color }} />}
                        label={tl.name}
                        count={timelineEventCounts[tl.id] || 0}
                        active={selectedTimelineId === tl.id}
                        onClick={() => nav(() => { onTimelineSelect?.(tl.id); })}
                        onDoubleClick={() => { setEditingTimeline(tl.id); setEditTimelineName(tl.name); }}
                        actions={
                          timelines.length > 1 ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeletingTimelineId(tl.id); }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-red-400"
                              aria-label={`Delete timeline ${tl.name}`}
                              title="Delete timeline"
                            >
                              <X size={12} />
                            </button>
                          ) : undefined
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Folders */}
        <div className="pt-3">
          <button
            onClick={() => setFoldersOpen(!foldersOpen)}
            className="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
            aria-expanded={foldersOpen}
          >
            {foldersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Folders
            <button
              onClick={(e) => { e.stopPropagation(); setShowNewFolder(true); }}
              className="ml-auto p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
              aria-label="Create folder"
              title="Create folder"
            >
              <Plus size={14} />
            </button>
          </button>

          {foldersOpen && (
            <div className="mt-1 space-y-0.5">
              {showNewFolder && (
                <div className="flex items-center gap-1 px-2">
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setShowNewFolder(false); }}
                    placeholder="Folder name"
                    aria-label="New folder name"
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                  />
                  <button onClick={handleCreateFolder} className="text-accent hover:text-accent-hover" aria-label="Confirm create folder" title="Create folder">
                    <Plus size={14} />
                  </button>
                  <button onClick={() => setShowNewFolder(false)} className="text-gray-500 hover:text-gray-300" aria-label="Cancel" title="Cancel">
                    <X size={14} />
                  </button>
                </div>
              )}
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className={cn('group relative rounded-lg transition-colors', dragOverFolderId === folder.id && 'bg-accent/15')}
                  onDragOver={(e) => { e.preventDefault(); setDragOverFolderId(folder.id); }}
                  onDragLeave={() => setDragOverFolderId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverFolderId(null);
                    const noteId = e.dataTransfer.getData('text/plain');
                    if (noteId && onMoveNoteToFolder) onMoveNoteToFolder(noteId, folder.id);
                  }}
                >
                  {editingFolder === folder.id ? (
                    <div className="flex items-center gap-1 px-2">
                      <input
                        autoFocus
                        value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(folder.id); if (e.key === 'Escape') setEditingFolder(null); }}
                        aria-label="Rename folder"
                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                      />
                    </div>
                  ) : (
                    <SidebarItem
                      icon={<FolderOpen size={16} style={{ color: folder.color }} />}
                      label={folder.name}
                      active={selectedFolderId === folder.id}
                      onClick={() => nav(() => { onFolderSelect(folder.id); onTagSelect(undefined); onShowTrash(false); onShowArchive(false); })}
                      onDoubleClick={() => { setEditingFolder(folder.id); setEditFolderName(folder.name); }}
                      actions={
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeletingFolderId(folder.id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-red-400"
                          aria-label={`Delete folder ${folder.name}`}
                          title="Delete folder"
                        >
                          <X size={12} />
                        </button>
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="pt-3">
          <button
            onClick={() => setTagsOpen(!tagsOpen)}
            className="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
            aria-expanded={tagsOpen}
          >
            {tagsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Tags
          </button>

          {tagsOpen && (
            <div className="mt-1 space-y-0.5">
              {tags.map((tag) => (
                <SidebarItem
                  key={tag.id}
                  icon={<Tag size={14} style={{ color: tag.color }} />}
                  label={`#${tag.name}`}
                  active={selectedTag === tag.name}
                  onClick={() => nav(() => { onTagSelect(tag.name); onFolderSelect(undefined); onShowTrash(false); onShowArchive(false); })}
                />
              ))}
              {tags.length === 0 && (
                <p className="px-4 py-1 text-xs text-gray-600">No tags yet</p>
              )}
            </div>
          )}
        </div>

        {/* Special */}
        <div className="pt-3 space-y-0.5">
          <SidebarItem
            icon={<Archive size={16} />}
            label="Archive"
            count={noteCounts.archived}
            active={showArchive}
            onClick={() => nav(() => { onShowArchive(!showArchive); onShowTrash(false); onFolderSelect(undefined); onTagSelect(undefined); onViewChange('notes'); })}
          />
          <SidebarItem
            icon={<Trash2 size={16} />}
            label="Trash"
            count={noteCounts.trashed}
            active={showTrash}
            onClick={() => nav(() => { onShowTrash(!showTrash); onShowArchive(false); onFolderSelect(undefined); onTagSelect(undefined); onViewChange('notes'); })}
          />
        </div>
      </nav>

      <div className="border-t border-gray-800 p-2 space-y-0.5">
        <SidebarItem
          icon={<Settings size={16} />}
          label="Settings"
          onClick={() => nav(onOpenSettings)}
        />

        {/* Links — visible on mobile (md:hidden) since header hides them on mobile */}
        <div className="md:hidden pt-2 space-y-0.5">
          <a
            href="https://github.com/peterhanily/browsernotes"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
          >
            <Github size={16} />
            <span>GitHub</span>
          </a>
          <a
            href="./browsernotes-standalone.html"
            download
            className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
          >
            <Download size={16} />
            <span>Download Standalone</span>
          </a>
          <a
            href="https://github.com/peterhanily/browsernotes/tree/main/extension#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
          >
            <Chrome size={16} />
            <span>Extension</span>
          </a>
        </div>
      </div>

      <ConfirmDialog
        open={deletingFolderId !== null}
        onClose={() => setDeletingFolderId(null)}
        onConfirm={() => { if (deletingFolderId) onDeleteFolder(deletingFolderId); }}
        title="Delete Folder"
        message="This folder will be deleted. Notes and tasks inside it will be moved to &quot;All Items&quot;."
        confirmLabel="Delete Folder"
        danger
      />

      <ConfirmDialog
        open={deletingTimelineId !== null}
        onClose={() => setDeletingTimelineId(null)}
        onConfirm={() => { if (deletingTimelineId) { onDeleteTimeline?.(deletingTimelineId); setDeletingTimelineId(null); } }}
        title="Delete Timeline"
        message="This timeline and all its events will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Timeline"
        danger
      />
    </aside>
  );
}

const SidebarItem = React.memo(function SidebarItem({
  icon,
  label,
  count,
  active,
  onClick,
  onDoubleClick,
  actions,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm transition-colors group',
        active
          ? 'bg-accent/15 text-accent'
          : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
      )}
    >
      {icon}
      <span className="truncate flex-1 text-left">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-gray-500 tabular-nums">{count}</span>
      )}
      {actions}
    </button>
  );
});
