import { useState } from 'react';
import {
  FileText, ListChecks, Paperclip, FolderOpen, Tag, Trash2,
  Archive, ChevronDown, ChevronRight, Plus, X, Settings,
  PanelLeftClose,
} from 'lucide-react';
import type { Folder, Tag as TagType, ViewMode } from '../../types';
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
}: SidebarProps) {
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');

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

  const clearFilters = () => {
    onFolderSelect(undefined);
    onTagSelect(undefined);
    onShowTrash(false);
    onShowArchive(false);
  };

  return (
    <aside className="w-60 border-r border-gray-800 sidebar-glass flex flex-col h-full shrink-0 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <span className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Navigate</span>
        <button onClick={onToggleCollapsed} className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300">
          <PanelLeftClose size={16} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Views */}
        <SidebarItem
          icon={<FileText size={18} />}
          label="Notes"
          count={noteCounts.total}
          active={activeView === 'notes' && !showTrash && !showArchive && !selectedFolderId && !selectedTag}
          onClick={() => { onViewChange('notes'); clearFilters(); }}
        />
        <SidebarItem
          icon={<ListChecks size={18} />}
          label="Tasks"
          count={taskCounts.total}
          active={activeView === 'tasks' && !selectedFolderId && !selectedTag}
          onClick={() => { onViewChange('tasks'); clearFilters(); }}
        />
        <SidebarItem
          icon={<Paperclip size={18} />}
          label="Clips"
          active={activeView === 'clips'}
          onClick={() => { onViewChange('clips'); clearFilters(); }}
        />

        {/* Folders */}
        <div className="pt-3">
          <button
            onClick={() => setFoldersOpen(!foldersOpen)}
            className="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
          >
            {foldersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Folders
            <button
              onClick={(e) => { e.stopPropagation(); setShowNewFolder(true); }}
              className="ml-auto p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
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
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                  />
                  <button onClick={handleCreateFolder} className="text-accent hover:text-accent-hover">
                    <Plus size={14} />
                  </button>
                  <button onClick={() => setShowNewFolder(false)} className="text-gray-500 hover:text-gray-300">
                    <X size={14} />
                  </button>
                </div>
              )}
              {folders.map((folder) => (
                <div key={folder.id} className="group relative">
                  {editingFolder === folder.id ? (
                    <div className="flex items-center gap-1 px-2">
                      <input
                        autoFocus
                        value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(folder.id); if (e.key === 'Escape') setEditingFolder(null); }}
                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                      />
                    </div>
                  ) : (
                    <SidebarItem
                      icon={<FolderOpen size={16} style={{ color: folder.color }} />}
                      label={folder.name}
                      active={selectedFolderId === folder.id}
                      onClick={() => { onFolderSelect(folder.id); onTagSelect(undefined); onShowTrash(false); onShowArchive(false); }}
                      onDoubleClick={() => { setEditingFolder(folder.id); setEditFolderName(folder.name); }}
                      actions={
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-red-400"
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
                  onClick={() => { onTagSelect(tag.name); onFolderSelect(undefined); onShowTrash(false); onShowArchive(false); }}
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
            onClick={() => { onShowArchive(!showArchive); onShowTrash(false); onFolderSelect(undefined); onTagSelect(undefined); onViewChange('notes'); }}
          />
          <SidebarItem
            icon={<Trash2 size={16} />}
            label="Trash"
            count={noteCounts.trashed}
            active={showTrash}
            onClick={() => { onShowTrash(!showTrash); onShowArchive(false); onFolderSelect(undefined); onTagSelect(undefined); onViewChange('notes'); }}
          />
        </div>
      </nav>

      <div className="border-t border-gray-800 p-2">
        <SidebarItem
          icon={<Settings size={16} />}
          label="Settings"
          onClick={onOpenSettings}
        />
      </div>
    </aside>
  );
}

function SidebarItem({
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
}
