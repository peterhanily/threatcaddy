import { useState } from 'react';
import {
  FileText, ListChecks, Clock, Trash2, Briefcase,
  Archive, ChevronDown, Plus, X, Settings as SettingsIcon,
  PanelLeftClose, PanelLeft, Github, Download, Chrome, PenTool, Activity, Network, Dices, Search, Shield, BookOpen,
  LayoutDashboard, MessageSquare, MessagesSquare, FolderOpen, FolderClosed,
} from 'lucide-react';
import type { Folder, Tag as TagType, Timeline, Whiteboard, ViewMode, InvestigationStatus } from '../../types';
import { Modal } from '../Common/Modal';
import { OperationNameGenerator } from '../Common/OperationNameGenerator';
import { InvestigationCard } from './InvestigationCard';
import { cn } from '../../lib/utils';
import { NavItem, InvestigationListItem, CollapsedIcon } from './SidebarHelpers';
import { WhiteboardSubList } from './WhiteboardSubList';
import { TimelineSubList } from './TimelineSubList';
import { TagSubList } from './TagSubList';

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
  onTrashFolderContents: (id: string) => void;
  onArchiveFolder: (id: string) => void;
  onUnarchiveFolder: (id: string) => void;
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
  investigationScopedCounts?: { notes: number; tasks: number; events: number; whiteboards: number; iocs: number } | null;
  chatCount?: number;
  serverConnected?: boolean;
  onNewFromPlaybook?: () => void;
}

type SegmentedFilter = 'all' | InvestigationStatus;

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
  onTrashFolderContents,
  onArchiveFolder,
  onUnarchiveFolder,
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
  // folderStatusFilter — managed internally via segmentedFilter state
  onFolderStatusFilterChange,
  investigationScopedCounts,
  chatCount,
  serverConnected,
  onNewFromPlaybook,
}: SidebarProps) {
  const [investigationsListOpen, setInvestigationsListOpen] = useState(true);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNameGenerator, setShowNameGenerator] = useState(false);

  const [segmentedFilter, setSegmentedFilter] = useState<SegmentedFilter>('all');

  // Derived state
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

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

  const navToView = (view: ViewMode) => {
    onViewChange(view);
    if (!selectedFolderId) clearFilters();
  };

  const nav = (fn: () => void) => {
    fn();
    onNavigate?.();
  };

  const handleSegmentedFilterChange = (filter: SegmentedFilter) => {
    setSegmentedFilter(filter);
    if (onFolderStatusFilterChange) {
      if (filter === 'all') {
        onFolderStatusFilterChange(['active', 'closed', 'archived']);
      } else {
        onFolderStatusFilterChange([filter]);
      }
    }
  };

  // Filtered folders for the investigation list
  const filteredFolders = folders.filter((f) => {
    if (segmentedFilter === 'all') return true;
    return (f.status || 'active') === segmentedFilter;
  });

  // View items for collapsed icon rail
  const collapsedViewItems: { view: ViewMode; icon: typeof FileText; label: string; badge?: number; badgeColor?: string; dataTour?: string }[] = [
    { view: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { view: 'notes', icon: FileText, label: 'Notes', badge: investigationScopedCounts ? investigationScopedCounts.notes : noteCounts.total, badgeColor: 'bg-accent-blue' },
    { view: 'tasks', icon: ListChecks, label: 'Tasks', badge: investigationScopedCounts ? investigationScopedCounts.tasks : taskCounts.total, badgeColor: 'bg-accent-amber', dataTour: 'tasks' },
    { view: 'timeline', icon: Clock, label: 'Timeline', badge: investigationScopedCounts ? investigationScopedCounts.events : timelineCounts?.total, badgeColor: 'bg-accent-green', dataTour: 'timeline' },
    { view: 'whiteboard', icon: PenTool, label: 'Whiteboards', badge: investigationScopedCounts ? investigationScopedCounts.whiteboards : whiteboardCount, dataTour: 'whiteboards' },
    { view: 'ioc-stats', icon: Search, label: 'IOC Stats', badge: investigationScopedCounts ? investigationScopedCounts.iocs : undefined, badgeColor: 'bg-accent-green' },
    { view: 'graph', icon: Network, label: 'Graph' },
    { view: 'activity', icon: Activity, label: 'Activity', dataTour: 'activity' },
    { view: 'caddyshack', icon: MessagesSquare, label: 'CaddyShack' },
    { view: 'chat', icon: MessageSquare, label: 'CaddyAI', badge: chatCount },
  ];

  // --- Collapsed: icon-only rail ---
  if (collapsed) {
    return (
      <aside
        className="w-12 border-r border-border-subtle sidebar-glass flex flex-col items-center h-full shrink-0 overflow-hidden"
        role="navigation"
        aria-label="Main navigation"
        data-tour="sidebar-nav"
      >
        {/* Scrollable view icons */}
        <div className="flex-1 flex flex-col items-center py-2 gap-0.5 overflow-y-auto overflow-x-hidden w-full">
          {collapsedViewItems.map((item) => (
            <CollapsedIcon
              key={item.view}
              icon={item.icon}
              label={item.label}
              active={activeView === item.view && !showTrash && !showArchive}
              badge={item.badge}
              onClick={() => nav(() => navToView(item.view))}
              dataTour={item.dataTour}
            />
          ))}
        </div>

        {/* Fixed footer — always visible */}
        <div className="shrink-0 flex flex-col items-center py-1.5 gap-0.5 border-t border-border-subtle w-full">
          <CollapsedIcon
            icon={SettingsIcon}
            label="Settings"
            onClick={() => nav(onOpenSettings)}
          />
          <CollapsedIcon
            icon={Archive}
            label="Archive"
            active={showArchive}
            badge={noteCounts.archived}
            onClick={() => nav(() => { onShowArchive(!showArchive); onShowTrash(false); onFolderSelect(undefined); onTagSelect(undefined); })}
          />
          <CollapsedIcon
            icon={Trash2}
            label="Trash"
            active={showTrash}
            badge={noteCounts.trashed}
            onClick={() => nav(() => { onShowTrash(!showTrash); onShowArchive(false); onFolderSelect(undefined); onTagSelect(undefined); })}
          />
          <CollapsedIcon
            icon={PanelLeft}
            label="Expand sidebar"
            onClick={onToggleCollapsed}
          />
        </div>
      </aside>
    );
  }

  // --- Expanded: full sidebar ---
  return (
    <aside className="w-[260px] border-r border-border-subtle sidebar-glass flex flex-col h-full shrink-0 overflow-hidden" role="navigation" aria-label="Main navigation">
      {/* 1. HEADER */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Investigations</span>
        <button onClick={onToggleCollapsed} className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors" aria-label="Collapse sidebar" title="Collapse sidebar">
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* 2. ALL INVESTIGATIONS TOGGLE */}
      <div className="px-2 pt-1.5">
        <button
          onClick={() => setInvestigationsListOpen(!investigationsListOpen)}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          aria-expanded={investigationsListOpen}
        >
          {investigationsListOpen ? <FolderOpen size={14} className="text-purple/70 shrink-0" /> : <FolderClosed size={14} className="text-text-muted shrink-0" />}
          <span>Investigations</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="px-1.5 py-px rounded-full bg-bg-deep text-[9px] font-mono text-text-muted">{folders.length}</span>
            <ChevronDown
              size={12}
              className="text-text-muted transition-transform duration-200"
              style={{ transform: investigationsListOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </span>
        </button>

        <div
          className="overflow-hidden transition-all duration-250 ease-in-out"
          style={{
            maxHeight: investigationsListOpen ? '400px' : '0px',
            opacity: investigationsListOpen ? 1 : 0,
          }}
        >
          {/* Segmented filter */}
          {onFolderStatusFilterChange && (
            <div className="flex gap-0.5 p-0.5 bg-bg-deep rounded-lg mb-1.5 mt-1">
              {(['all', 'active', 'closed', 'archived'] as SegmentedFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => handleSegmentedFilterChange(s)}
                  className={cn(
                    'flex-1 px-1 py-0.5 rounded text-[10px] font-medium transition-colors',
                    segmentedFilter === s
                      ? 'bg-bg-active text-text-primary'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          )}

          {/* Investigation list */}
          <div className="space-y-0.5 max-h-[300px] overflow-y-auto" data-tour="tags-folders">
            {/* "All Items" — click to deselect investigation */}
            <NavItem
              compact
              icon={<Briefcase size={14} />}
              label="View All"
              active={!selectedFolderId}
              onClick={() => nav(() => { onFolderSelect(undefined); onTagSelect(undefined); onShowTrash(false); onShowArchive(false); })}
            />
            {filteredFolders.map((folder) => (
              <div
                key={folder.id}
                className={cn(
                  'group relative rounded-lg transition-colors',
                  dragOverFolderId === folder.id && 'bg-purple/15',
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
                      className="flex-1 bg-bg-deep border border-border-medium rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-purple"
                    />
                  </div>
                ) : (
                  <InvestigationListItem
                    folder={folder}
                    active={selectedFolderId === folder.id}
                    synced={serverConnected && !folder.localOnly}
                    onClick={() => nav(() => {
                      if (selectedFolderId === folder.id) {
                        onFolderSelect(undefined);
                      } else {
                        onFolderSelect(folder.id);
                      }
                      onTagSelect(undefined); onShowTrash(false); onShowArchive(false);
                    })}
                    onDoubleClick={() => { setEditingFolder(folder.id); setEditFolderName(folder.name); }}
                    onInfo={onEditFolder ? () => onEditFolder(folder.id) : undefined}
                    onArchive={(folder.status || 'active') !== 'archived' ? () => onArchiveFolder(folder.id) : undefined}
                    onUnarchive={(folder.status || 'active') === 'archived' ? () => onUnarchiveFolder(folder.id) : undefined}
                    onDelete={() => setDeletingFolderId(folder.id)}
                  />
                )}
              </div>
            ))}
            {filteredFolders.length === 0 && (
              <p className="px-2 py-1 text-[10px] text-text-muted font-mono">No investigations</p>
            )}
          </div>
        </div>
      </div>

      {/* 3. NEW INVESTIGATION ROW */}
      <div className="px-2 pt-1.5">
        {showNewFolder ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); } }}
              placeholder="Investigation name"
              aria-label="New investigation name"
              className="flex-1 bg-bg-deep border border-border-medium rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-purple"
            />
            <button onClick={handleCreateFolder} className="text-purple hover:text-accent-hover" aria-label="Create investigation" title="Create">
              <Plus size={14} />
            </button>
            <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="text-text-muted hover:text-text-primary" aria-label="Cancel" title="Cancel">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowNewFolder(true)}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-purple text-white text-xs font-medium hover:brightness-110 transition-all"
            >
              <Plus size={14} />
              New
            </button>
            <button
              onClick={() => setShowNameGenerator(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
              title="Generate investigation name"
              aria-label="Generate investigation name"
            >
              <Dices size={14} />
            </button>
            {onNewFromPlaybook && (
              <button
                onClick={onNewFromPlaybook}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                title="New from playbook"
                aria-label="New investigation from playbook"
              >
                <BookOpen size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 4. ACTIVE INVESTIGATION CARD */}
      <div className="px-2 pt-2">
        {selectedFolder && onEditFolder ? (
          <InvestigationCard
            folder={selectedFolder}
            counts={{
              notes: investigationScopedCounts?.notes ?? 0,
              tasks: investigationScopedCounts?.tasks ?? 0,
              events: investigationScopedCounts?.events ?? 0,
              whiteboards: investigationScopedCounts?.whiteboards ?? 0,
              iocs: investigationScopedCounts?.iocs ?? 0,
            }}
            onEditFolder={onEditFolder}
            synced={serverConnected && !selectedFolder.localOnly}
          />
        ) : (
          <div className="font-mono text-[11px] text-text-muted px-1">
            Viewing all
          </div>
        )}
      </div>

      {/* 5. NAVIGATION */}
      <nav data-tour="sidebar-nav" className="flex-1 overflow-y-auto px-2 pt-2 space-y-0.5" aria-label="Views">
        <div data-tour="dashboard">
          <NavItem
            icon={<LayoutDashboard size={16} />}
            label="Dashboard"
            active={activeView === 'dashboard' && !showTrash && !showArchive}
            onClick={() => nav(() => navToView('dashboard'))}
          />
        </div>
        <NavItem
          icon={<FileText size={16} />}
          label="Notes"
          badge={investigationScopedCounts ? investigationScopedCounts.notes : noteCounts.total}
          badgeColor="bg-accent-blue/15 text-accent-blue"
          active={activeView === 'notes' && !showTrash && !showArchive}
          onClick={() => nav(() => navToView('notes'))}
        />
        <div data-tour="tasks">
          <NavItem
            icon={<ListChecks size={16} />}
            label="Tasks"
            badge={investigationScopedCounts ? investigationScopedCounts.tasks : taskCounts.total}
            badgeColor="bg-accent-amber/15 text-accent-amber"
            active={activeView === 'tasks'}
            onClick={() => nav(() => navToView('tasks'))}
          />
        </div>
        <div data-tour="timeline">
          <NavItem
            icon={<Clock size={16} />}
            label="Timeline"
            badge={investigationScopedCounts ? investigationScopedCounts.events : timelineCounts?.total}
            badgeColor="bg-accent-green/15 text-accent-green"
            active={activeView === 'timeline'}
            onClick={() => nav(() => navToView('timeline'))}
          />
        </div>
        <div data-tour="whiteboards">
          <NavItem
            icon={<PenTool size={16} />}
            label="Whiteboards"
            badge={investigationScopedCounts ? investigationScopedCounts.whiteboards : whiteboardCount}
            active={activeView === 'whiteboard'}
            onClick={() => nav(() => navToView('whiteboard'))}
          />
        </div>

        {/* 6px gap between Whiteboards and IOC Stats */}
        <div className="h-1.5" />

        <NavItem
          icon={<Search size={16} />}
          label="IOC Stats"
          badge={investigationScopedCounts ? investigationScopedCounts.iocs : undefined}
          badgeColor="bg-accent-green/15 text-accent-green"
          active={activeView === 'ioc-stats'}
          onClick={() => nav(() => navToView('ioc-stats'))}
        />
        <NavItem
          icon={<Network size={16} />}
          label="Graph"
          active={activeView === 'graph'}
          onClick={() => nav(() => navToView('graph'))}
        />
        <div data-tour="activity">
          <NavItem
            icon={<Activity size={16} />}
            label="Activity"
            active={activeView === 'activity'}
            onClick={() => nav(() => navToView('activity'))}
          />
        </div>
        <div data-tour="caddyshack">
          <NavItem
            icon={<MessagesSquare size={16} />}
            label="CaddyShack"
            active={activeView === 'caddyshack'}
            onClick={() => nav(() => navToView('caddyshack'))}
          />
        </div>
        <div data-tour="chat">
          <NavItem
            icon={<MessageSquare size={16} />}
            label="CaddyAI"
            badge={chatCount}
            badgeColor="bg-purple/15 text-purple"
            active={activeView === 'chat'}
            onClick={() => nav(() => navToView('chat'))}
          />
        </div>

        {/* 6. CONTEXTUAL SUB-LISTS */}

        {/* Whiteboards — only in whiteboard view */}
        {activeView === 'whiteboard' && (
          <WhiteboardSubList
            whiteboards={whiteboards}
            selectedWhiteboardId={selectedWhiteboardId}
            onWhiteboardSelect={onWhiteboardSelect}
            onCreateWhiteboard={onCreateWhiteboard}
            onDeleteWhiteboard={onDeleteWhiteboard}
            onRenameWhiteboard={onRenameWhiteboard}
            onNavigate={onNavigate}
          />
        )}

        {/* Timelines — only in timeline view */}
        {activeView === 'timeline' && (
          <TimelineSubList
            timelines={timelines}
            selectedTimelineId={selectedTimelineId}
            timelineCounts={timelineCounts}
            timelineEventCounts={timelineEventCounts}
            onTimelineSelect={onTimelineSelect}
            onCreateTimeline={onCreateTimeline}
            onDeleteTimeline={onDeleteTimeline}
            onRenameTimeline={onRenameTimeline}
            onNavigate={onNavigate}
          />
        )}

        {/* 7. TAGS */}
        <TagSubList
          tags={tags}
          selectedTag={selectedTag}
          onTagSelect={onTagSelect}
          onFolderSelect={onFolderSelect}
          onShowTrash={onShowTrash}
          onShowArchive={onShowArchive}
          onRenameTag={onRenameTag}
          onDeleteTag={onDeleteTag}
          onNavigate={onNavigate}
        />
      </nav>

      {/* 8. FOOTER */}
      <div className="border-t border-border-subtle px-2 py-2 flex items-center gap-1">
        <button
          onClick={() => nav(onOpenSettings)}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <SettingsIcon size={14} />
          <span>Settings</span>
        </button>
        <div className="flex-1" />
        <button
          onClick={() => nav(() => { onShowArchive(!showArchive); onShowTrash(false); onFolderSelect(undefined); onTagSelect(undefined); })}
          className={cn(
            'flex items-center gap-1 px-1.5 py-1 rounded-lg text-xs transition-colors',
            showArchive ? 'bg-bg-active text-purple' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
          )}
          title="Archive"
          aria-label="Archive"
        >
          <Archive size={14} />
          {noteCounts.archived > 0 && (
            <span className="font-mono text-[10px]">{noteCounts.archived}</span>
          )}
        </button>
        <button
          onClick={() => nav(() => { onShowTrash(!showTrash); onShowArchive(false); onFolderSelect(undefined); onTagSelect(undefined); })}
          className={cn(
            'flex items-center gap-1 px-1.5 py-1 rounded-lg text-xs transition-colors',
            showTrash ? 'bg-bg-active text-purple' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
          )}
          title="Trash"
          aria-label="Trash"
        >
          <Trash2 size={14} />
          {noteCounts.trashed > 0 && (
            <span className="font-mono text-[10px]">{noteCounts.trashed}</span>
          )}
        </button>
      </div>

      {/* Mobile-only links */}
      <div className="md:hidden border-t border-border-subtle px-2 py-2 space-y-0.5">
        <a
          href="https://github.com/peterhanily/threatcaddy"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Github size={16} />
          <span>GitHub</span>
        </a>
        <a
          href="./threatcaddy-standalone.html"
          download
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Download size={16} />
          <span>Download Standalone</span>
        </a>
        <a
          href="https://github.com/peterhanily/threatcaddy/tree/main/extension#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Chrome size={16} />
          <span>Extension</span>
        </a>
        <a
          href="https://threatcaddy.com/privacy.html"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Shield size={16} />
          <span>Privacy</span>
        </a>
      </div>

      {/* Dialogs */}
      <Modal
        open={deletingFolderId !== null}
        onClose={() => setDeletingFolderId(null)}
        title="Delete Investigation"
      >
        <p className="text-sm text-text-secondary mb-4">What should happen to the items inside this investigation?</p>
        <div className="space-y-2">
          <button
            className="w-full text-left px-4 py-3 rounded-lg bg-bg-raised hover:bg-bg-hover transition-colors"
            onClick={() => { if (deletingFolderId) { onDeleteFolder(deletingFolderId); setDeletingFolderId(null); } }}
          >
            <div className="text-sm font-medium text-text-primary">Remove folder only</div>
            <div className="text-xs text-text-secondary mt-0.5">Items move back to All Items</div>
          </button>
          <button
            className="w-full text-left px-4 py-3 rounded-lg bg-red-600/15 hover:bg-red-600/25 transition-colors"
            onClick={() => { if (deletingFolderId) { onTrashFolderContents(deletingFolderId); setDeletingFolderId(null); } }}
          >
            <div className="text-sm font-medium text-red-400">Trash all items</div>
            <div className="text-xs text-red-400/70 mt-0.5">Items go to trash (auto-deleted after 30 days)</div>
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
            onClick={() => setDeletingFolderId(null)}
          >
            Cancel
          </button>
        </div>
      </Modal>

      <OperationNameGenerator
        open={showNameGenerator}
        onClose={() => setShowNameGenerator(false)}
        onCreateInvestigation={(name) => { onCreateFolder(name); setShowNameGenerator(false); }}
      />
    </aside>
  );
}

