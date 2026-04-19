import { useTranslation } from 'react-i18next';
import {
  FileText, ListChecks, Clock, Trash2, Briefcase,
  Archive, Settings as SettingsIcon,
  PanelLeftClose, PanelLeft, Github, Download, Chrome, PenTool, Activity, Network, Search, Shield,
  LayoutDashboard, MessageSquare, MessagesSquare, ChevronLeft, Bot,
} from 'lucide-react';
import type { Timeline, Whiteboard, ViewMode } from '../../types';
import { cn } from '../../lib/utils';
import { NavItem, CollapsedIcon } from './SidebarHelpers';
import { WhiteboardSubList } from './WhiteboardSubList';
import { TimelineSubList } from './TimelineSubList';
import { TagSubList } from './TagSubList';
import { useNavigation } from '../../contexts/NavigationContext';
import { useInvestigation } from '../../contexts/InvestigationContext';
import { useUIModals } from '../../contexts/UIModalContext';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  noteCounts: { total: number; trashed: number; archived: number };
  taskCounts: { todo: number; 'in-progress': number; done: number; total: number };
  timelineCounts?: { total: number; starred: number };
  timelines?: Timeline[];
  onCreateTimeline?: (name: string) => void;
  onDeleteTimeline?: (id: string) => void;
  onRenameTimeline?: (id: string, name: string) => void;
  timelineEventCounts?: Record<string, number>;
  whiteboards?: Whiteboard[];
  onCreateWhiteboard?: (name?: string) => Promise<Whiteboard>;
  onDeleteWhiteboard?: (id: string) => void;
  onRenameWhiteboard?: (id: string, name: string) => void;
  whiteboardCount?: number;
  onNavigate?: () => void;
  onRenameTag?: (id: string, name: string) => void;
  onDeleteTag?: (id: string) => void;
  investigationScopedCounts?: { notes: number; tasks: number; events: number; whiteboards: number; iocs: number } | null;
  chatCount?: number;
  agentStatus?: 'idle' | 'running' | 'waiting' | 'paused' | 'error';
  onToggleAgent?: () => void;
  serverConnected?: boolean;
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  noteCounts,
  taskCounts,
  timelineCounts,
  timelines = [],
  onCreateTimeline,
  onDeleteTimeline,
  onRenameTimeline,
  timelineEventCounts = {},
  whiteboards = [],
  onCreateWhiteboard,
  onDeleteWhiteboard,
  onRenameWhiteboard,
  whiteboardCount,
  onNavigate,
  onRenameTag,
  onDeleteTag,
  investigationScopedCounts,
  chatCount,
  agentStatus,
  onToggleAgent,
}: SidebarProps) {
  const { t } = useTranslation('common');

  // Context hooks
  const { activeView, selectedTimelineId, setSelectedTimelineId, selectedWhiteboardId, setSelectedWhiteboardId, navigateTo } = useNavigation();
  const { selectedFolderId, setSelectedFolderId, folders, tags, selectedTag, setSelectedTag, showTrash, setShowTrash, showArchive, setShowArchive, setEditingFolderId, agentPendingCount } = useInvestigation();
  const { openSettings } = useUIModals();

  // Derived state
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);
  const agentActionCount = agentPendingCount || undefined;

  const clearFilters = () => {
    setSelectedFolderId(undefined);
    setSelectedTag(undefined);
    setShowTrash(false);
    setShowArchive(false);
  };

  const navToView = (view: ViewMode) => {
    navigateTo(view);
    if (!selectedFolderId) clearFilters();
  };

  const nav = (fn: () => void) => {
    fn();
    onNavigate?.();
  };

  // View items for collapsed icon rail — top-level items always, investigation-scoped only when inside one
  const collapsedTopItems: { view: ViewMode; icon: typeof FileText; label: string; badge?: number; badgeColor?: string; dataTour?: string }[] = [
    { view: 'dashboard', icon: LayoutDashboard, label: t('sidebar.dashboard') },
    { view: 'investigations', icon: Briefcase, label: t('sidebar.investigations') },
  ];

  const collapsedInvestigationItems: { view: ViewMode; icon: typeof FileText; label: string; badge?: number; badgeColor?: string; dataTour?: string }[] = [
    { view: 'notes', icon: FileText, label: t('sidebar.notes'), badge: investigationScopedCounts ? investigationScopedCounts.notes : noteCounts.total, badgeColor: 'bg-accent-blue' },
    { view: 'tasks', icon: ListChecks, label: t('sidebar.tasks'), badge: investigationScopedCounts ? investigationScopedCounts.tasks : taskCounts.total, badgeColor: 'bg-accent-amber', dataTour: 'tasks' },
    { view: 'timeline', icon: Clock, label: t('sidebar.timeline'), badge: investigationScopedCounts ? investigationScopedCounts.events : timelineCounts?.total, badgeColor: 'bg-accent-green', dataTour: 'timeline' },
    { view: 'whiteboard', icon: PenTool, label: t('sidebar.whiteboards'), badge: investigationScopedCounts ? investigationScopedCounts.whiteboards : whiteboardCount, dataTour: 'whiteboards' },
    { view: 'ioc-stats', icon: Search, label: t('sidebar.iocs'), badge: investigationScopedCounts ? investigationScopedCounts.iocs : undefined, badgeColor: 'bg-accent-green' },
    { view: 'graph', icon: Network, label: t('sidebar.graph') },
    { view: 'activity', icon: Activity, label: t('sidebar.activity'), dataTour: 'activity' },
  ];

  const collapsedBottomItems: { view: ViewMode; icon: typeof FileText; label: string; badge?: number; badgeColor?: string; dataTour?: string }[] = [
    { view: 'chat', icon: MessageSquare, label: t('sidebar.caddyAI'), badge: chatCount },
    { view: 'caddyshack', icon: MessagesSquare, label: t('sidebar.caddyShack') },
    { view: 'agent', icon: Bot, label: t('sidebar.agentCaddy'), badge: agentActionCount, badgeColor: 'bg-accent-amber/15 text-accent-amber' },
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
            label={t('sidebar.expandSidebar')}
            onClick={onToggleCollapsed}
          />
        </div>

        {/* Scrollable view icons */}
        <div className="flex-1 flex flex-col items-center py-2 gap-1 overflow-y-auto overflow-x-hidden w-full">
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
        <div className="shrink-0 flex flex-col items-center py-1.5 gap-1 border-t border-border-subtle w-full">
          <CollapsedIcon
            icon={SettingsIcon}
            label={t('sidebar.settings')}
            onClick={() => nav(() => openSettings())}
          />
          <CollapsedIcon
            icon={Archive}
            label={t('sidebar.archive')}
            active={showArchive}
            badge={noteCounts.archived}
            onClick={() => nav(() => { setShowArchive(!showArchive); setShowTrash(false); setSelectedFolderId(undefined); setSelectedTag(undefined); })}
          />
          <CollapsedIcon
            icon={Trash2}
            label={t('sidebar.trash')}
            active={showTrash}
            badge={noteCounts.trashed}
            onClick={() => nav(() => { setShowTrash(!showTrash); setShowArchive(false); setSelectedFolderId(undefined); setSelectedTag(undefined); })}
          />
          <CollapsedIcon
            icon={PanelLeft}
            label={t('sidebar.expandSidebar')}
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
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('appName')}</span>
        <button onClick={onToggleCollapsed} className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors" aria-label={t('sidebar.collapseSidebar')} title={t('sidebar.collapseSidebar')}>
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* 2. INVESTIGATION CONTEXT HEADER */}
      {selectedFolder && (
        <div className="px-3 py-2 border-b border-border-subtle">
          <button
            onClick={() => { setSelectedFolderId(undefined); navigateTo('investigations'); }}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary mb-1 transition-colors"
          >
            <ChevronLeft size={14} />
            {t('sidebar.allInvestigations')}
          </button>
          {/* Clickable investigation card — opens settings */}
          <button
            onClick={() => setEditingFolderId(selectedFolder.id)}
            className="w-full text-start rounded-lg border border-border-subtle bg-bg-raised hover:border-border-medium hover:bg-bg-hover transition-colors p-2 group"
            title={t('sidebar.investigationSettings')}
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
              <span className="text-[10px] text-text-muted">{t('sidebar.agentCaddy')}</span>
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
              aria-label={selectedFolder.agentEnabled ? t('sidebar.disableAgent') : t('sidebar.enableAgent')}
              title={selectedFolder.agentEnabled ? t('sidebar.disableAgent') : t('sidebar.enableAgent')}
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
            label={t('sidebar.dashboard')}
            active={activeView === 'dashboard' && !showTrash && !showArchive}
            onClick={() => nav(() => navToView('dashboard'))}
          />
        </div>
        <NavItem
          icon={<Briefcase size={16} />}
          label={t('sidebar.investigations')}
          active={activeView === 'investigations' && !showTrash && !showArchive}
          onClick={() => nav(() => navToView('investigations'))}
        />

        {/* Entity views — always visible */}
        <div className="h-px bg-border-subtle mx-1 my-1.5" />

        <NavItem
          icon={<FileText size={16} />}
          label={t('sidebar.notes')}
          badge={investigationScopedCounts ? investigationScopedCounts.notes : noteCounts.total}
          badgeColor="bg-accent-blue/15 text-accent-blue"
          active={activeView === 'notes' && !showTrash && !showArchive}
          onClick={() => nav(() => navToView('notes'))}
          scopedColor={selectedFolder?.color || undefined}
        />
        <div data-tour="tasks">
          <NavItem
            icon={<ListChecks size={16} />}
            label={t('sidebar.tasks')}
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
            label={t('sidebar.timeline')}
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
            label={t('sidebar.whiteboards')}
            badge={investigationScopedCounts ? investigationScopedCounts.whiteboards : whiteboardCount}
            active={activeView === 'whiteboard'}
            onClick={() => nav(() => navToView('whiteboard'))}
            scopedColor={selectedFolder?.color || undefined}
          />
        </div>

        <div className="h-1.5" />

        <NavItem
          icon={<Search size={16} />}
          label={t('sidebar.iocs')}
          badge={investigationScopedCounts ? investigationScopedCounts.iocs : undefined}
          badgeColor="bg-accent-green/15 text-accent-green"
          active={activeView === 'ioc-stats'}
          onClick={() => nav(() => navToView('ioc-stats'))}
          scopedColor={selectedFolder?.color || undefined}
        />
        <NavItem
          icon={<Network size={16} />}
          label={t('sidebar.graph')}
          active={activeView === 'graph'}
          onClick={() => nav(() => navToView('graph'))}
        />
        <div data-tour="activity">
          <NavItem
            icon={<Activity size={16} />}
            label={t('sidebar.activity')}
            active={activeView === 'activity'}
            onClick={() => nav(() => navToView('activity'))}
          />
        </div>
        <div className="h-px bg-border-subtle mx-1 my-1.5" />

        {/* Bottom global items — always visible */}
        <div data-tour="chat">
          <NavItem
            icon={<MessageSquare size={16} />}
            label={t('sidebar.caddyAI')}
            badge={chatCount}
            badgeColor="bg-purple/15 text-purple"
            active={activeView === 'chat'}
            onClick={() => nav(() => navToView('chat'))}
          />
        </div>
        <div data-tour="caddyshack">
          <NavItem
            icon={<MessagesSquare size={16} />}
            label={t('sidebar.caddyShack')}
            active={activeView === 'caddyshack'}
            onClick={() => nav(() => navToView('caddyshack'))}
          />
        </div>
        <div data-tour="agent">
          <NavItem
            icon={<Bot size={16} />}
            label={t('sidebar.agentCaddy')}
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
            onWhiteboardSelect={setSelectedWhiteboardId}
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
            onTimelineSelect={setSelectedTimelineId}
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
          onTagSelect={setSelectedTag}
          onFolderSelect={setSelectedFolderId}
          onShowTrash={setShowTrash}
          onShowArchive={setShowArchive}
          onRenameTag={onRenameTag}
          onDeleteTag={onDeleteTag}
          onNavigate={onNavigate}
        />
      </nav>

      {/* FOOTER */}
      <div className="border-t border-border-subtle px-2 py-2 flex items-center gap-1">
        <button
          onClick={() => nav(() => openSettings())}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <SettingsIcon size={14} />
          <span>{t('sidebar.settings')}</span>
        </button>
        <div className="flex-1" />
        <button
          onClick={() => nav(() => { setShowArchive(!showArchive); setShowTrash(false); setSelectedFolderId(undefined); setSelectedTag(undefined); })}
          className={cn(
            'flex items-center gap-1 px-1.5 py-1 rounded-lg text-xs transition-colors',
            showArchive ? 'bg-bg-active text-purple' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
          )}
          title={t('sidebar.archive')}
          aria-label={t('sidebar.archive')}
        >
          <Archive size={14} />
          {noteCounts.archived > 0 && (
            <span className="font-mono text-[10px]">{noteCounts.archived}</span>
          )}
        </button>
        <button
          onClick={() => nav(() => { setShowTrash(!showTrash); setShowArchive(false); setSelectedFolderId(undefined); setSelectedTag(undefined); })}
          className={cn(
            'flex items-center gap-1 px-1.5 py-1 rounded-lg text-xs transition-colors',
            showTrash ? 'bg-bg-active text-purple' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
          )}
          title={t('sidebar.trash')}
          aria-label={t('sidebar.trash')}
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
          <span>{t('sidebar.github')}</span>
        </a>
        <a
          href="./threatcaddy-standalone.html"
          download
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Download size={16} />
          <span>{t('sidebar.downloadStandalone')}</span>
        </a>
        <a
          href="https://chromewebstore.google.com/detail/threatcaddy-%E2%80%94-quick-captu/lakelgngpkkaeinfdlnmifookbeeffbh"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Chrome size={16} />
          <span>{t('sidebar.chromeExtension')}</span>
        </a>
        <a
          href="https://threatcaddy.com/privacy.html"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Shield size={16} />
          <span>{t('sidebar.privacy')}</span>
        </a>
      </div>
    </nav>
  );
}
