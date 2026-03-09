import {
  FileText, ListChecks, Clock, Trash2, Briefcase,
  Archive, Settings as SettingsIcon,
  PanelLeftClose, PanelLeft, Github, Download, Chrome, PenTool, Activity, Network, Search, Shield,
  LayoutDashboard, MessageSquare, MessagesSquare, ChevronLeft,
} from 'lucide-react';
import type { Folder, Tag as TagType, Timeline, Whiteboard, ViewMode, InvestigationStatus } from '../../types';
import { cn } from '../../lib/utils';
import { NavItem, CollapsedIcon } from './SidebarHelpers';
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
  onRenameTag,
  onDeleteTag,
  investigationScopedCounts,
  chatCount,
}: SidebarProps) {
  // Derived state
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

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

  // View items for collapsed icon rail — top-level items always, investigation-scoped only when inside one
  const collapsedTopItems: { view: ViewMode; icon: typeof FileText; label: string; badge?: number; badgeColor?: string; dataTour?: string }[] = [
    { view: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { view: 'investigations', icon: Briefcase, label: 'Investigations' },
  ];

  const collapsedInvestigationItems: { view: ViewMode; icon: typeof FileText; label: string; badge?: number; badgeColor?: string; dataTour?: string }[] = [
    { view: 'notes', icon: FileText, label: 'Notes', badge: investigationScopedCounts ? investigationScopedCounts.notes : noteCounts.total, badgeColor: 'bg-accent-blue' },
    { view: 'tasks', icon: ListChecks, label: 'Tasks', badge: investigationScopedCounts ? investigationScopedCounts.tasks : taskCounts.total, badgeColor: 'bg-accent-amber', dataTour: 'tasks' },
    { view: 'timeline', icon: Clock, label: 'Timeline', badge: investigationScopedCounts ? investigationScopedCounts.events : timelineCounts?.total, badgeColor: 'bg-accent-green', dataTour: 'timeline' },
    { view: 'whiteboard', icon: PenTool, label: 'Whiteboards', badge: investigationScopedCounts ? investigationScopedCounts.whiteboards : whiteboardCount, dataTour: 'whiteboards' },
    { view: 'ioc-stats', icon: Search, label: 'IOCs', badge: investigationScopedCounts ? investigationScopedCounts.iocs : undefined, badgeColor: 'bg-accent-green' },
    { view: 'graph', icon: Network, label: 'Graph' },
    { view: 'activity', icon: Activity, label: 'Activity', dataTour: 'activity' },
  ];

  const collapsedBottomItems: { view: ViewMode; icon: typeof FileText; label: string; badge?: number; badgeColor?: string; dataTour?: string }[] = [
    { view: 'chat', icon: MessageSquare, label: 'CaddyAI', badge: chatCount },
    { view: 'caddyshack', icon: MessagesSquare, label: 'CaddyShack' },
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
        {/* Top expand button */}
        <div className="shrink-0 flex flex-col items-center py-1.5 border-b border-border-subtle w-full">
          <CollapsedIcon
            icon={PanelLeft}
            label="Expand sidebar"
            onClick={onToggleCollapsed}
          />
        </div>

        {/* Scrollable view icons */}
        <div className="flex-1 flex flex-col items-center py-2 gap-0.5 overflow-y-auto overflow-x-hidden w-full">
          {collapsedTopItems.map((item) => (
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

          <div className="w-6 h-px bg-border-subtle my-1" />
          {collapsedInvestigationItems.map((item) => (
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

          <div className="w-6 h-px bg-border-subtle my-1" />

          {collapsedBottomItems.map((item) => (
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

  // Status helpers for the investigation context header
  const selectedStatus = selectedFolder ? (selectedFolder.status || 'active') : 'active';
  const statusColor = selectedStatus === 'active'
    ? 'bg-accent-green'
    : selectedStatus === 'archived'
      ? 'bg-accent-amber'
      : 'bg-text-muted';
  const statusTextColor = selectedStatus === 'active'
    ? 'text-accent-green'
    : selectedStatus === 'archived'
      ? 'text-accent-amber'
      : 'text-text-muted';

  // --- Expanded: full sidebar ---
  return (
    <aside className="w-[260px] border-r border-border-subtle sidebar-glass flex flex-col h-full shrink-0 overflow-hidden" role="navigation" aria-label="Main navigation">
      {/* 1. HEADER */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">ThreatCaddy</span>
        <button onClick={onToggleCollapsed} className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors" aria-label="Collapse sidebar" title="Collapse sidebar">
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* 2. INVESTIGATION CONTEXT HEADER */}
      {selectedFolder && (
        <div className="px-3 py-2 border-b border-border-subtle">
          <button
            onClick={() => { onFolderSelect(undefined); onViewChange('investigations'); }}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary mb-1 transition-colors"
          >
            <ChevronLeft size={14} />
            All Investigations
          </button>
          <div className="flex items-center gap-2">
            {selectedFolder.color ? (
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selectedFolder.color }} />
            ) : (
              <div className={cn('w-2 h-2 rounded-full shrink-0', statusColor)} />
            )}
            <span className="text-sm font-medium text-text-primary truncate flex-1">{selectedFolder.name}</span>
            <span className={cn('text-[10px] font-medium uppercase tracking-wide', statusTextColor)}>
              {selectedStatus.charAt(0).toUpperCase() + selectedStatus.slice(1)}
            </span>
          </div>
        </div>
      )}

      {/* 3. NAVIGATION */}
      <nav data-tour="sidebar-nav" className="flex-1 overflow-y-auto px-2 pt-2 space-y-0.5" aria-label="Views">
        {/* Top-level items — always visible */}
        <div data-tour="dashboard">
          <NavItem
            icon={<LayoutDashboard size={16} />}
            label="Dashboard"
            active={activeView === 'dashboard' && !showTrash && !showArchive}
            onClick={() => nav(() => navToView('dashboard'))}
          />
        </div>
        <NavItem
          icon={<Briefcase size={16} />}
          label="Investigations"
          active={activeView === 'investigations' && !showTrash && !showArchive}
          onClick={() => nav(() => navToView('investigations'))}
        />

        {/* Entity views — always visible */}
        <div className="h-px bg-border-subtle mx-1 my-1.5" />

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

        <div className="h-1.5" />

        <NavItem
          icon={<Search size={16} />}
          label="IOCs"
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

        <div className="h-px bg-border-subtle mx-1 my-1.5" />

        {/* Bottom global items — always visible */}
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
        <div data-tour="caddyshack">
          <NavItem
            icon={<MessagesSquare size={16} />}
            label="CaddyShack"
            active={activeView === 'caddyshack'}
            onClick={() => nav(() => navToView('caddyshack'))}
          />
        </div>

        {/* CONTEXTUAL SUB-LISTS */}

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

        {/* TAGS */}
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

      {/* FOOTER */}
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
    </aside>
  );
}
