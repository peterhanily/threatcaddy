import React, { useState } from 'react';
import {
  FileText, ListChecks, Clock, Briefcase, Tag, Trash2,
  Archive, ChevronDown, ChevronRight, Plus, X, Settings as SettingsIcon,
  PanelLeftClose, Github, Download, Chrome, PenTool, Activity, Network, ShieldCheck, Info,
} from 'lucide-react';
import type { Folder, Tag as TagType, Timeline, Whiteboard, ViewMode, InvestigationStatus } from '../../types';
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
  whiteboards?: Whiteboard[];
  selectedWhiteboardId?: string;
  onWhiteboardSelect?: (id: string) => void;
  onCreateWhiteboard?: (name?: string) => Promise<Whiteboard>;
  onDeleteWhiteboard?: (id: string) => void;
  onRenameWhiteboard?: (id: string, name: string) => void;
  whiteboardCount?: number;
  onNavigate?: () => void;
  onMoveNoteToFolder?: (noteId: string, folderId: string) => void;
  onRenameTag?: (id: string, name: string) => void;
  onDeleteTag?: (id: string) => void;
  onEditFolder?: (id: string) => void;
  folderStatusFilter?: InvestigationStatus[];
  onFolderStatusFilterChange?: (filter: InvestigationStatus[]) => void;
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
  whiteboards = [],
  selectedWhiteboardId,
  onWhiteboardSelect,
  onCreateWhiteboard,
  onDeleteWhiteboard,
  onRenameWhiteboard,
  whiteboardCount,
  onNavigate,
  onMoveNoteToFolder,
  onRenameTag,
  onDeleteTag,
  onEditFolder,
  folderStatusFilter = ['active'],
  onFolderStatusFilterChange,
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

  const [whiteboardsOpen, setWhiteboardsOpen] = useState(true);
  const [newWhiteboardName, setNewWhiteboardName] = useState('');
  const [showNewWhiteboard, setShowNewWhiteboard] = useState(false);
  const [editingWhiteboard, setEditingWhiteboard] = useState<string | null>(null);
  const [editWhiteboardName, setEditWhiteboardName] = useState('');
  const [deletingWhiteboardId, setDeletingWhiteboardId] = useState<string | null>(null);

  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);

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

  const handleCreateWhiteboard = () => {
    if (newWhiteboardName.trim() && onCreateWhiteboard) {
      onCreateWhiteboard(newWhiteboardName.trim());
      setNewWhiteboardName('');
      setShowNewWhiteboard(false);
    }
  };

  const handleRenameWhiteboard = (id: string) => {
    if (editWhiteboardName.trim() && onRenameWhiteboard) {
      onRenameWhiteboard(id, editWhiteboardName.trim());
      setEditingWhiteboard(null);
    }
  };

  const handleRenameTag = (id: string) => {
    if (editTagName.trim() && onRenameTag) {
      onRenameTag(id, editTagName.trim());
      setEditingTag(null);
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

      <nav data-tour="sidebar-nav" className="flex-1 overflow-y-auto p-2 space-y-1" aria-label="Views">
        {/* Views */}
        <SidebarItem
          icon={<FileText size={18} />}
          label="Notes"
          count={noteCounts.total}
          active={activeView === 'notes' && !showTrash && !showArchive}
          onClick={() => nav(() => { onViewChange('notes'); clearFilters(); })}
        />
        <div data-tour="tasks">
          <SidebarItem
            icon={<ListChecks size={18} />}
            label="Tasks"
            count={taskCounts.total}
            active={activeView === 'tasks'}
            onClick={() => nav(() => { onViewChange('tasks'); clearFilters(); })}
          />
        </div>
        <div data-tour="timeline">
          <SidebarItem
            icon={<Clock size={18} />}
            label="Timeline"
            count={timelineCounts?.total}
            active={activeView === 'timeline'}
            onClick={() => nav(() => { onViewChange('timeline'); clearFilters(); })}
          />
        </div>
        <SidebarItem
          icon={<Network size={18} />}
          label="Graph"
          active={activeView === 'graph'}
          onClick={() => nav(() => { onViewChange('graph'); clearFilters(); })}
        />
        <SidebarItem
          icon={<ShieldCheck size={18} />}
          label="IOC Stats"
          active={activeView === 'ioc-stats'}
          onClick={() => nav(() => { onViewChange('ioc-stats'); clearFilters(); })}
        />
        <div data-tour="whiteboards">
          <SidebarItem
            icon={<PenTool size={18} />}
            label="Whiteboards"
            count={whiteboardCount}
            active={activeView === 'whiteboard'}
            onClick={() => nav(() => { onViewChange('whiteboard'); clearFilters(); })}
          />
        </div>
        <SidebarItem
          icon={<Activity size={18} />}
          label="Activity"
          active={activeView === 'activity'}
          onClick={() => nav(() => { onViewChange('activity'); clearFilters(); })}
        />
        {/* Whiteboards — only in whiteboard view */}
        {activeView === 'whiteboard' && (
          <div className="pt-2">
            <button
              onClick={() => setWhiteboardsOpen(!whiteboardsOpen)}
              className="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
              aria-expanded={whiteboardsOpen}
            >
              {whiteboardsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Whiteboards
              <button
                onClick={(e) => { e.stopPropagation(); setShowNewWhiteboard(true); }}
                className="ml-auto p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
                aria-label="Create whiteboard"
                title="Create whiteboard"
              >
                <Plus size={14} />
              </button>
            </button>

            {whiteboardsOpen && (
              <div className="mt-1 space-y-0.5">
                {showNewWhiteboard && (
                  <div className="flex items-center gap-1 px-2">
                    <input
                      autoFocus
                      value={newWhiteboardName}
                      onChange={(e) => setNewWhiteboardName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateWhiteboard(); if (e.key === 'Escape') setShowNewWhiteboard(false); }}
                      placeholder="Whiteboard name"
                      aria-label="New whiteboard name"
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                    />
                    <button onClick={handleCreateWhiteboard} className="text-accent hover:text-accent-hover" aria-label="Confirm create whiteboard" title="Create whiteboard">
                      <Plus size={14} />
                    </button>
                    <button onClick={() => setShowNewWhiteboard(false)} className="text-gray-500 hover:text-gray-300" aria-label="Cancel" title="Cancel">
                      <X size={14} />
                    </button>
                  </div>
                )}
                {whiteboards.map((wb) => (
                  <div key={wb.id} className="group relative">
                    {editingWhiteboard === wb.id ? (
                      <div className="flex items-center gap-1 px-2">
                        <input
                          autoFocus
                          value={editWhiteboardName}
                          onChange={(e) => setEditWhiteboardName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenameWhiteboard(wb.id); if (e.key === 'Escape') setEditingWhiteboard(null); }}
                          aria-label="Rename whiteboard"
                          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                        />
                      </div>
                    ) : (
                      <SidebarItem
                        compact
                        icon={<PenTool size={14} />}
                        label={wb.name}
                        active={selectedWhiteboardId === wb.id}
                        onClick={() => nav(() => { onWhiteboardSelect?.(wb.id); })}
                        onDoubleClick={() => { setEditingWhiteboard(wb.id); setEditWhiteboardName(wb.name); }}
                        actions={
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingWhiteboardId(wb.id); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-red-400"
                            aria-label={`Delete whiteboard ${wb.name}`}
                            title="Delete whiteboard"
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
        )}
        {/* Timelines — only in timeline view */}
        {activeView === 'timeline' && (
          <div className="pt-2">
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
                  compact
                  icon={<Clock size={14} />}
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
                        compact
                        icon={<Clock size={14} style={{ color: tl.color }} />}
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
        <div data-tour="tags-folders" className="pt-2">
          <button
            onClick={() => setFoldersOpen(!foldersOpen)}
            className="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
            aria-expanded={foldersOpen}
          >
            {foldersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Investigations
            <button
              onClick={(e) => { e.stopPropagation(); setShowNewFolder(true); }}
              className="ml-auto p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
              aria-label="Create investigation"
              title="Create investigation"
            >
              <Plus size={14} />
            </button>
          </button>

          {foldersOpen && (
            <div className="mt-1 space-y-0.5">
              {/* Status filter chips */}
              {onFolderStatusFilterChange && (
                <div className="flex gap-1 px-2 pb-1">
                  {(['active', 'closed', 'archived'] as InvestigationStatus[]).map((s) => {
                    const count = folders.filter((f) => (f.status || 'active') === s).length;
                    const isActive = folderStatusFilter.includes(s);
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          const next = isActive
                            ? folderStatusFilter.filter((x) => x !== s)
                            : [...folderStatusFilter, s];
                          onFolderStatusFilterChange(next.length > 0 ? next : ['active']);
                        }}
                        className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                          isActive ? 'bg-accent/20 text-accent' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                        )}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
              {showNewFolder && (
                <div className="flex items-center gap-1 px-2">
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setShowNewFolder(false); }}
                    placeholder="Investigation name"
                    aria-label="New investigation name"
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                  />
                  <button onClick={handleCreateFolder} className="text-accent hover:text-accent-hover" aria-label="Confirm create investigation" title="Create investigation">
                    <Plus size={14} />
                  </button>
                  <button onClick={() => setShowNewFolder(false)} className="text-gray-500 hover:text-gray-300" aria-label="Cancel" title="Cancel">
                    <X size={14} />
                  </button>
                </div>
              )}
              {folders
                .filter((f) => folderStatusFilter.includes(f.status || 'active'))
                .map((folder) => (
                <div
                  key={folder.id}
                  className={cn(
                    'group relative rounded-lg transition-colors',
                    dragOverFolderId === folder.id && 'bg-accent/15',
                    (folder.status === 'closed' || folder.status === 'archived') && 'opacity-60'
                  )}
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
                        aria-label="Rename investigation"
                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                      />
                    </div>
                  ) : (
                    <SidebarItem
                      compact
                      icon={<Briefcase size={14} style={{ color: folder.color }} />}
                      label={folder.name}
                      active={selectedFolderId === folder.id}
                      onClick={() => nav(() => { onFolderSelect(folder.id); onTagSelect(undefined); onShowTrash(false); onShowArchive(false); })}
                      onDoubleClick={() => { setEditingFolder(folder.id); setEditFolderName(folder.name); }}
                      actions={
                        <>
                          {onEditFolder && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onEditFolder(folder.id); }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-gray-300"
                              aria-label={`Edit investigation ${folder.name}`}
                              title="Edit investigation"
                            >
                              <Info size={12} />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingFolderId(folder.id); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-red-400"
                            aria-label={`Delete investigation ${folder.name}`}
                            title="Delete investigation"
                          >
                            <X size={12} />
                          </button>
                        </>
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="pt-2">
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
                <div key={tag.id} className="group relative">
                  {editingTag === tag.id ? (
                    <div className="flex items-center gap-1 px-2">
                      <input
                        autoFocus
                        value={editTagName}
                        onChange={(e) => setEditTagName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRenameTag(tag.id); if (e.key === 'Escape') setEditingTag(null); }}
                        aria-label="Rename tag"
                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                      />
                    </div>
                  ) : (
                    <SidebarItem
                      compact
                      icon={<Tag size={12} style={{ color: tag.color }} />}
                      label={`#${tag.name}`}
                      active={selectedTag === tag.name}
                      onClick={() => nav(() => { onTagSelect(tag.name); onFolderSelect(undefined); onShowTrash(false); onShowArchive(false); })}
                      onDoubleClick={() => { setEditingTag(tag.id); setEditTagName(tag.name); }}
                      actions={
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeletingTagId(tag.id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-red-400"
                          aria-label={`Delete tag ${tag.name}`}
                          title="Delete tag"
                        >
                          <X size={12} />
                        </button>
                      }
                    />
                  )}
                </div>
              ))}
              {tags.length === 0 && (
                <p className="px-4 py-1 text-xs text-gray-600">No tags yet</p>
              )}
            </div>
          )}
        </div>

        {/* Special */}
        <div className="pt-2 space-y-0.5">
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
          icon={<SettingsIcon size={16} />}
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
        title="Delete Investigation"
        message="This investigation will be deleted. Notes, tasks, and other items inside it will be moved to &quot;All Items&quot;."
        confirmLabel="Delete Investigation"
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

      <ConfirmDialog
        open={deletingWhiteboardId !== null}
        onClose={() => setDeletingWhiteboardId(null)}
        onConfirm={() => { if (deletingWhiteboardId) { onDeleteWhiteboard?.(deletingWhiteboardId); setDeletingWhiteboardId(null); } }}
        title="Delete Whiteboard"
        message="This whiteboard will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Whiteboard"
        danger
      />

      <ConfirmDialog
        open={deletingTagId !== null}
        onClose={() => setDeletingTagId(null)}
        onConfirm={() => { if (deletingTagId) { onDeleteTag?.(deletingTagId); setDeletingTagId(null); } }}
        title="Delete Tag"
        message="This tag will be removed from all notes, tasks, timeline events, and whiteboards."
        confirmLabel="Delete Tag"
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
  compact,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'flex items-center w-full rounded-lg transition-colors group',
        compact ? 'gap-1.5 px-2 py-0.5 text-xs' : 'gap-2 px-3 py-1.5 text-sm',
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
