import {
  FileText, ListChecks, Clock, Trash2, Briefcase,
  Archive, Settings as SettingsIcon,
  PanelLeftClose, PanelLeft, Github, Download, Chrome, PenTool, Activity, Network, Search, Shield,
  LayoutDashboard, MessageSquare, MessagesSquare, ChevronLeft, Bot,
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
  agentActionCount?: number;
  agentStatus?: 'idle' | 'running' | 'waiting' | 'paused' | 'error';
  onToggleAgent?: () => void;
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
  onEditFolder,
  investigationScopedCounts,
  chatCount,
  agentActionCount,
  agentStatus,
  onToggleAgent,
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
    { view: 'agent', icon: Bot, label: 'AgentCaddy', badge: agentActionCount, badgeColor: 'bg-accent-amber/15 text-accent-amber' },
  ];

  // --- Collapsed: icon-only rail ---
  if (collapsed) {
    return (
      <nav
        className="w-12 border-r border-border-subtle sidebar-glass flex flex-col items-center h-full shrink-0 overflow-hidden"
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
      </nav>
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
    <nav className="w-[260px] border-r border-border-subtle sidebar-glass flex flex-col h-full shrink-0 overflow-hidden" aria-label="Main navigation">
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
          {/* Clickable investigation card — opens settings */}
          <button
            onClick={() => onEditFolder?.(selectedFolder.id)}
            className="w-full text-left rounded-lg border border-border-subtle bg-bg-raised hover:border-border-medium hover:bg-bg-hover transition-colors p-2 group"
            title="Investigation settings"
          >
            {selectedFolder.color && (
              <div className="h-0.5 rounded-full mb-1.5 -mx-0.5" style={{ backgroundColor: selectedFolder.color }} />
            )}
            <div className="flex items-center gap-2">
              {!selectedFolder.color && (
                <div className={cn('w-2 h-2 rounded-full shrink-0', statusColor)} />
              )}
              <span className="text-sm font-medium text-text-primary truncate flex-1">{selectedFolder.name}</span>
              <SettingsIcon size={12} className="text-text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0" />
            </div>
            {investigationScopedCounts && (
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-muted">
                <span className="flex items-center gap-1"><FileText size={10} className="text-accent-blue" />{investigationScopedCounts.notes}</span>
                <span className="flex items-center gap-1"><ListChecks size={10} className="text-accent-amber" />{investigationScopedCounts.tasks}</span>
                <span className="flex items-center gap-1"><Clock size={10} className="text-accent-green" />{investigationScopedCounts.events}</span>
                <span className="flex items-center gap-1"><Search size={10} className="text-accent-green" />{investigationScopedCounts.iocs}</span>
              </div>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className={cn('text-[10px] font-medium uppercase tracking-wide', statusTextColor)}>
                {selectedStatus.charAt(0).toUpperCase() + selectedStatus.slice(1)}
              </span>
            </div>
          </button>
          {/* Agent toggle + status */}
          <div className="flex items-center justify-between mt-1.5 px-0.5">
            <div className="flex items-center gap-1.5">
              <Bot size={12} className={selectedFolder.agentEnabled ? 'text-accent-blue' : 'text-text-muted'} />
              <span className="text-[10px] text-text-muted">AgentCaddy</span>
              {agentStatus && agentStatus !== 'idle' && (
                <span className={cn(
                  'text-[9px] px-1 py-px rounded',
                  agentStatus === 'running' && 'bg-accent-blue/10 text-accent-blue',
                  agentStatus === 'waiting' && 'bg-accent-amber/10 text-accent-amber',
                  agentStatus === 'error' && 'bg-red-400/10 text-red-400',
                  agentStatus === 'paused' && 'bg-surface-raised text-text-muted',
                )}>
                  {agentStatus}
                </span>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleAgent?.(); }}
              className={cn(
                'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
                selectedFolder.agentEnabled ? 'bg-accent-blue' : 'bg-gray-600',
              )}
              role="switch"
              aria-checked={!!selectedFolder.agentEnabled}
              aria-label={selectedFolder.agentEnabled ? 'Disable agent for this investigation' : 'Enable agent for this investigation'}
              title={selectedFolder.agentEnabled ? 'Disable agent' : 'Enable agent'}
            >
              <span className={cn(
                'inline-block h-3 w-3 rounded-full bg-white transition-transform',
                selectedFolder.agentEnabled ? 'translate-x-[13px]' : 'translate-x-[2px]',
              )} />
            </button>
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
          scopedColor={selectedFolder?.color || undefined}
        />
        <div data-tour="tasks">
          <NavItem
            icon={<ListChecks size={16} />}
            label="Tasks"
            badge={investigationScopedCounts ? investigationScopedCounts.tasks : taskCounts.total}
            badgeColor="bg-accent-amber/15 text-accent-amber"
            active={activeView === 'tasks'}
            onClick={() => nav(() => navToView('tasks'))}
            scopedColor={selectedFolder?.color || undefined}
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
            scopedColor={selectedFolder?.color || undefined}
          />
        </div>
        <div data-tour="whiteboards">
          <NavItem
            icon={<PenTool size={16} />}
            label="Whiteboards"
            badge={investigationScopedCounts ? investigationScopedCounts.whiteboards : whiteboardCount}
            active={activeView === 'whiteboard'}
            onClick={() => nav(() => navToView('whiteboard'))}
            scopedColor={selectedFolder?.color || undefined}
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
          scopedColor={selectedFolder?.color || undefined}
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
        <div data-tour="agent">
          <NavItem
            icon={<Bot size={16} />}
            label="AgentCaddy"
            badge={agentActionCount}
            badgeColor="bg-accent-amber/15 text-accent-amber"
            active={activeView === 'agent'}
            onClick={() => nav(() => navToView('agent'))}
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
          href="https://chromewebstore.google.com/detail/threatcaddy-%E2%80%94-quick-captu/lakelgngpkkaeinfdlnmifookbeeffbh"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Chrome size={16} />
          <span>Chrome Extension</span>
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
    </nav>
  );
}
