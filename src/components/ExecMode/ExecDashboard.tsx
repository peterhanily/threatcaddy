import { useState, useCallback, useMemo, useEffect } from 'react';
import { LayoutDashboard, FolderOpen, Activity, Sun, Moon, Monitor, Shield } from 'lucide-react';
import type { Folder, Note, Task, TimelineEvent, Timeline, Whiteboard, StandaloneIOC, Tag, ActivityLogEntry } from '../../types';
import { cn } from '../../lib/utils';
import { ExecMetricsBar } from './ExecMetricsBar';
import { ExecInvestigationList } from './ExecInvestigationList';
import { ExecInvestigationDetail } from './ExecInvestigationDetail';
import { ExecActivityFeed } from './ExecActivityFeed';
import { ExecEntityList } from './ExecEntityList';
import { ExecNoteView } from './ExecNoteView';
import { ExecTaskView } from './ExecTaskView';
import { ExecEventView } from './ExecEventView';
import { ExecIOCView } from './ExecIOCView';
import { ExecBreadcrumb, type BreadcrumbSegment } from './ExecBreadcrumb';
import { ExecEntityNav } from './ExecEntityNav';
import { ExecSearchBar } from './ExecSearchBar';
import { ShareDialog } from './ShareDialog';
import type { SharePayload, InvestigationBundle } from '../../lib/share';

type ExecNav = 'overview' | 'investigations' | 'activity';

type ExecDrillDown =
  | null
  | { screen: 'investigation'; folderId: string }
  | { screen: 'noteList'; folderId: string }
  | { screen: 'noteDetail'; folderId: string; noteId: string }
  | { screen: 'taskList'; folderId: string }
  | { screen: 'taskDetail'; folderId: string; taskId: string }
  | { screen: 'eventList'; folderId: string }
  | { screen: 'eventDetail'; folderId: string; eventId: string }
  | { screen: 'whiteboardList'; folderId: string }
  | { screen: 'iocList'; folderId: string }
  | { screen: 'iocDetail'; folderId: string; iocId: string };

interface ExecDashboardProps {
  folders: Folder[];
  allNotes: Note[];
  allTasks: Task[];
  allEvents: TimelineEvent[];
  allWhiteboards: Whiteboard[];
  allIOCs: StandaloneIOC[];
  allTimelines: Timeline[];
  allTags: Tag[];
  activityEntries: ActivityLogEntry[];
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSwitchToAnalystMode: (folderId?: string) => void;
}

export function ExecDashboard({
  folders,
  allNotes,
  allTasks,
  allEvents,
  allWhiteboards,
  allIOCs,
  allTimelines,
  allTags,
  activityEntries,
  theme,
  onToggleTheme,
  onSwitchToAnalystMode,
}: ExecDashboardProps) {
  const [nav, setNav] = useState<ExecNav>('overview');
  const [drillDown, setDrillDown] = useState<ExecDrillDown>(null);
  const [sharePayload, setSharePayload] = useState<SharePayload | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Clear search when navigation changes
  useEffect(() => { setSearchQuery(''); }, [drillDown, nav]);

  const handleSelectInvestigation = useCallback((id: string) => {
    setDrillDown({ screen: 'investigation', folderId: id });
  }, []);

  const handleBack = useCallback(() => {
    setDrillDown((prev) => {
      if (!prev) return null;
      switch (prev.screen) {
        case 'investigation': return null;
        case 'noteList':
        case 'taskList':
        case 'eventList':
        case 'whiteboardList':
        case 'iocList':
          return { screen: 'investigation', folderId: prev.folderId };
        case 'noteDetail':
          return { screen: 'noteList', folderId: prev.folderId };
        case 'taskDetail':
          return { screen: 'taskList', folderId: prev.folderId };
        case 'eventDetail':
          return { screen: 'eventList', folderId: prev.folderId };
        case 'iocDetail':
          return { screen: 'iocList', folderId: prev.folderId };
        default: return null;
      }
    });
  }, []);

  const handleOpenAnalystMode = useCallback(() => {
    const folderId = drillDown?.folderId;
    onSwitchToAnalystMode(folderId ?? undefined);
  }, [drillDown, onSwitchToAnalystMode]);

  // Share handlers
  const handleShareInvestigation = useCallback(() => {
    if (!drillDown) return;
    const folderId = drillDown.folderId;
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const bundle: InvestigationBundle = {
      folder,
      notes: allNotes.filter((n) => n.folderId === folderId && !n.trashed),
      tasks: allTasks.filter((t) => t.folderId === folderId && !t.trashed),
      events: allEvents.filter((e) => e.folderId === folderId && !e.trashed),
      timelines: allTimelines.filter((tl) => {
        const f = folders.find((fo) => fo.id === folderId);
        return f?.timelineId === tl.id;
      }),
      whiteboards: allWhiteboards.filter((w) => w.folderId === folderId && !w.trashed),
      iocs: allIOCs.filter((i) => i.folderId === folderId && !i.trashed),
      chatThreads: [],
      tags: allTags,
    };
    setSharePayload({ v: 1, s: 'investigation', t: Date.now(), d: bundle });
  }, [drillDown, folders, allNotes, allTasks, allEvents, allTimelines, allWhiteboards, allIOCs, allTags]);

  const handleShareNote = useCallback((noteId: string) => {
    const note = allNotes.find((n) => n.id === noteId);
    if (note) setSharePayload({ v: 1, s: 'note', t: Date.now(), d: note });
  }, [allNotes]);

  const handleShareTask = useCallback((taskId: string) => {
    const task = allTasks.find((t) => t.id === taskId);
    if (task) setSharePayload({ v: 1, s: 'task', t: Date.now(), d: task });
  }, [allTasks]);

  const handleShareEvent = useCallback((eventId: string) => {
    const event = allEvents.find((e) => e.id === eventId);
    if (event) setSharePayload({ v: 1, s: 'event', t: Date.now(), d: event });
  }, [allEvents]);

  const handleShareIOC = useCallback((iocId: string) => {
    const ioc = allIOCs.find((i) => i.id === iocId);
    if (ioc) setSharePayload({ v: 1, s: 'ioc', t: Date.now(), d: ioc });
  }, [allIOCs]);

  const activeFolders = folders.filter((f) => (f.status || 'active') === 'active');

  const drillFolder = useMemo(
    () => drillDown ? folders.find((f) => f.id === drillDown.folderId) : null,
    [drillDown, folders],
  );
  const drillFolderName = drillFolder?.name ?? 'Investigation';

  // Entity counts for the current investigation
  const drillEntityCounts = useMemo(() => {
    if (!drillDown) return { notes: 0, tasks: 0, events: 0, whiteboards: 0, iocs: 0 };
    const fid = drillDown.folderId;
    return {
      notes: allNotes.filter((n) => n.folderId === fid && !n.trashed).length,
      tasks: allTasks.filter((t) => t.folderId === fid && !t.trashed).length,
      events: allEvents.filter((e) => e.folderId === fid && !e.trashed).length,
      whiteboards: allWhiteboards.filter((w) => w.folderId === fid && !w.trashed).length,
      iocs: allIOCs.filter((i) => i.folderId === fid && !i.trashed).length,
    };
  }, [drillDown, allNotes, allTasks, allEvents, allWhiteboards, allIOCs]);

  // Active entity tab derived from current drill-down screen
  const activeEntityTab = useMemo(() => {
    if (!drillDown) return undefined;
    const map: Record<string, 'notes' | 'tasks' | 'events' | 'whiteboards' | 'iocs'> = {
      noteList: 'notes', noteDetail: 'notes',
      taskList: 'tasks', taskDetail: 'tasks',
      eventList: 'events', eventDetail: 'events',
      whiteboardList: 'whiteboards',
      iocList: 'iocs', iocDetail: 'iocs',
    };
    return map[drillDown.screen];
  }, [drillDown]);

  const handleEntityNavTap = useCallback((tab: 'notes' | 'tasks' | 'events' | 'whiteboards' | 'iocs') => {
    if (!drillDown) return;
    const fid = drillDown.folderId;
    const screenMap = {
      notes: 'noteList' as const,
      tasks: 'taskList' as const,
      events: 'eventList' as const,
      whiteboards: 'whiteboardList' as const,
      iocs: 'iocList' as const,
    };
    setDrillDown({ screen: screenMap[tab], folderId: fid });
  }, [drillDown]);

  // Breadcrumb segments computed from drill-down state
  const breadcrumbs = useMemo((): BreadcrumbSegment[] => {
    if (!drillDown) return [];
    const casesRoot: BreadcrumbSegment = { label: 'Investigations', onTap: () => { setDrillDown(null); setNav('investigations'); } };
    const invDetail: BreadcrumbSegment = { label: drillFolderName, onTap: () => setDrillDown({ screen: 'investigation', folderId: drillDown.folderId }) };

    switch (drillDown.screen) {
      case 'investigation':
        return [casesRoot, { label: drillFolderName }];
      case 'noteList':
        return [casesRoot, invDetail, { label: 'Notes' }];
      case 'taskList':
        return [casesRoot, invDetail, { label: 'Tasks' }];
      case 'eventList':
        return [casesRoot, invDetail, { label: 'Events' }];
      case 'whiteboardList':
        return [casesRoot, invDetail, { label: 'Whiteboards' }];
      case 'iocList':
        return [casesRoot, invDetail, { label: 'IOCs' }];
      case 'noteDetail': {
        const note = allNotes.find((n) => n.id === drillDown.noteId);
        return [casesRoot, invDetail,
          { label: 'Notes', onTap: () => setDrillDown({ screen: 'noteList', folderId: drillDown.folderId }) },
          { label: note?.title || 'Note' }];
      }
      case 'taskDetail': {
        const task = allTasks.find((t) => t.id === drillDown.taskId);
        return [casesRoot, invDetail,
          { label: 'Tasks', onTap: () => setDrillDown({ screen: 'taskList', folderId: drillDown.folderId }) },
          { label: task?.title || 'Task' }];
      }
      case 'eventDetail': {
        const event = allEvents.find((e) => e.id === drillDown.eventId);
        return [casesRoot, invDetail,
          { label: 'Events', onTap: () => setDrillDown({ screen: 'eventList', folderId: drillDown.folderId }) },
          { label: event?.title || 'Event' }];
      }
      case 'iocDetail': {
        const ioc = allIOCs.find((i) => i.id === drillDown.iocId);
        return [casesRoot, invDetail,
          { label: 'IOCs', onTap: () => setDrillDown({ screen: 'iocList', folderId: drillDown.folderId }) },
          { label: ioc?.value || 'IOC' }];
      }
      default: return [];
    }
  }, [drillDown, drillFolderName, allNotes, allTasks, allEvents, allIOCs]);

  // Show search bar on list views and investigations tab
  const showSearch = nav === 'investigations' || (drillDown && [
    'noteList', 'taskList', 'eventList', 'whiteboardList', 'iocList',
  ].includes(drillDown.screen));

  const tabs: { key: ExecNav; label: string; icon: typeof LayoutDashboard }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'investigations', label: 'Cases', icon: FolderOpen },
    { key: 'activity', label: 'Activity', icon: Activity },
  ];

  // Helper: compute sorted entity list and nav handler for detail views
  const notesList = useMemo(() => drillDown
    ? allNotes.filter((n) => n.folderId === drillDown.folderId && !n.trashed).sort((a, b) => b.updatedAt - a.updatedAt)
    : [], [allNotes, drillDown]);
  const tasksList = useMemo(() => drillDown
    ? allTasks.filter((t) => t.folderId === drillDown.folderId && !t.trashed).sort((a, b) => a.order - b.order)
    : [], [allTasks, drillDown]);
  const eventsList = useMemo(() => drillDown
    ? allEvents.filter((e) => e.folderId === drillDown.folderId && !e.trashed).sort((a, b) => a.timestamp - b.timestamp)
    : [], [allEvents, drillDown]);
  const iocsList = useMemo(() => drillDown
    ? allIOCs.filter((i) => i.folderId === drillDown.folderId && !i.trashed).sort((a, b) => b.createdAt - a.createdAt)
    : [], [allIOCs, drillDown]);

  // Render drill-down content
  const renderDrillDown = () => {
    if (!drillDown) return null;

    switch (drillDown.screen) {
      case 'investigation':
        return drillFolder ? (
          <ExecInvestigationDetail
            folder={drillFolder}
            allNotes={allNotes}
            allTasks={allTasks}
            allEvents={allEvents}
            allWhiteboards={allWhiteboards}
            allIOCs={allIOCs}
            activityEntries={activityEntries}
            onBack={handleBack}
            onOpenAnalystMode={handleOpenAnalystMode}
            onTapNotes={() => setDrillDown({ screen: 'noteList', folderId: drillDown.folderId })}
            onTapTasks={() => setDrillDown({ screen: 'taskList', folderId: drillDown.folderId })}
            onTapEvents={() => setDrillDown({ screen: 'eventList', folderId: drillDown.folderId })}
            onTapWhiteboards={() => setDrillDown({ screen: 'whiteboardList', folderId: drillDown.folderId })}
            onTapIOCs={() => setDrillDown({ screen: 'iocList', folderId: drillDown.folderId })}
            onShare={handleShareInvestigation}
          />
        ) : null;

      case 'noteList':
        return (
          <ExecEntityList
            mode="notes" folderId={drillDown.folderId} folderName={drillFolderName}
            allNotes={allNotes} allTasks={allTasks} allEvents={allEvents} allWhiteboards={allWhiteboards} allIOCs={allIOCs}
            onBack={handleBack} filterText={searchQuery}
            onSelectNote={(id) => setDrillDown({ screen: 'noteDetail', folderId: drillDown.folderId, noteId: id })}
          />
        );

      case 'noteDetail': {
        const note = allNotes.find((n) => n.id === drillDown.noteId);
        const idx = notesList.findIndex((n) => n.id === drillDown.noteId);
        const handleNav = (dir: 'prev' | 'next') => {
          const i = dir === 'prev' ? idx - 1 : idx + 1;
          if (i >= 0 && i < notesList.length) setDrillDown({ screen: 'noteDetail', folderId: drillDown.folderId, noteId: notesList[i].id });
        };
        return note ? (
          <ExecNoteView note={note} allNotes={allNotes} onBack={handleBack} onShare={() => handleShareNote(note.id)}
            currentIndex={idx} totalCount={notesList.length} onNavigate={handleNav} />
        ) : null;
      }

      case 'taskList':
        return (
          <ExecEntityList
            mode="tasks" folderId={drillDown.folderId} folderName={drillFolderName}
            allNotes={allNotes} allTasks={allTasks} allEvents={allEvents} allWhiteboards={allWhiteboards} allIOCs={allIOCs}
            onBack={handleBack} filterText={searchQuery}
            onSelectTask={(id) => setDrillDown({ screen: 'taskDetail', folderId: drillDown.folderId, taskId: id })}
          />
        );

      case 'taskDetail': {
        const task = allTasks.find((t) => t.id === drillDown.taskId);
        const idx = tasksList.findIndex((t) => t.id === drillDown.taskId);
        const handleNav = (dir: 'prev' | 'next') => {
          const i = dir === 'prev' ? idx - 1 : idx + 1;
          if (i >= 0 && i < tasksList.length) setDrillDown({ screen: 'taskDetail', folderId: drillDown.folderId, taskId: tasksList[i].id });
        };
        return task ? (
          <ExecTaskView task={task} onBack={handleBack} onShare={() => handleShareTask(task.id)}
            currentIndex={idx} totalCount={tasksList.length} onNavigate={handleNav} />
        ) : null;
      }

      case 'eventList':
        return (
          <ExecEntityList
            mode="events" folderId={drillDown.folderId} folderName={drillFolderName}
            allNotes={allNotes} allTasks={allTasks} allEvents={allEvents} allWhiteboards={allWhiteboards} allIOCs={allIOCs}
            onBack={handleBack} filterText={searchQuery}
            onSelectEvent={(id) => setDrillDown({ screen: 'eventDetail', folderId: drillDown.folderId, eventId: id })}
          />
        );

      case 'eventDetail': {
        const event = allEvents.find((e) => e.id === drillDown.eventId);
        const idx = eventsList.findIndex((e) => e.id === drillDown.eventId);
        const handleNav = (dir: 'prev' | 'next') => {
          const i = dir === 'prev' ? idx - 1 : idx + 1;
          if (i >= 0 && i < eventsList.length) setDrillDown({ screen: 'eventDetail', folderId: drillDown.folderId, eventId: eventsList[i].id });
        };
        return event ? (
          <ExecEventView event={event} onBack={handleBack} onShare={() => handleShareEvent(event.id)}
            currentIndex={idx} totalCount={eventsList.length} onNavigate={handleNav} />
        ) : null;
      }

      case 'whiteboardList':
        return (
          <ExecEntityList
            mode="whiteboards" folderId={drillDown.folderId} folderName={drillFolderName}
            allNotes={allNotes} allTasks={allTasks} allEvents={allEvents} allWhiteboards={allWhiteboards} allIOCs={allIOCs}
            onBack={handleBack} filterText={searchQuery} onSwitchToAnalystMode={handleOpenAnalystMode}
          />
        );

      case 'iocList':
        return (
          <ExecEntityList
            mode="iocs" folderId={drillDown.folderId} folderName={drillFolderName}
            allNotes={allNotes} allTasks={allTasks} allEvents={allEvents} allWhiteboards={allWhiteboards} allIOCs={allIOCs}
            onBack={handleBack} filterText={searchQuery}
            onSelectIOC={(id) => setDrillDown({ screen: 'iocDetail', folderId: drillDown.folderId, iocId: id })}
          />
        );

      case 'iocDetail': {
        const ioc = allIOCs.find((i) => i.id === drillDown.iocId);
        const idx = iocsList.findIndex((i) => i.id === drillDown.iocId);
        const handleNav = (dir: 'prev' | 'next') => {
          const i = dir === 'prev' ? idx - 1 : idx + 1;
          if (i >= 0 && i < iocsList.length) setDrillDown({ screen: 'iocDetail', folderId: drillDown.folderId, iocId: iocsList[i].id });
        };
        return ioc ? (
          <ExecIOCView ioc={ioc} allIOCs={allIOCs} onBack={handleBack} onShare={() => handleShareIOC(ioc.id)}
            currentIndex={idx} totalCount={iocsList.length} onNavigate={handleNav} />
        ) : null;
      }

      default: return null;
    }
  };

  return (
    <div className={cn('h-screen flex flex-col bg-bg-deep', theme)}>
      {/* Gradient top accent */}
      <div className="h-0.5 bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 shrink-0" />

      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-surface border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-2.5">
          <Shield size={18} className="text-accent" />
          <span className="font-bold text-text-primary text-sm">ThreatCaddy</span>
          <span className="text-[10px] font-semibold tracking-widest text-accent bg-accent/10 px-1.5 py-0.5 rounded">
            EXEC
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onToggleTheme} className="p-2 rounded-lg text-text-muted active:bg-bg-hover">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            onClick={() => onSwitchToAnalystMode()}
            className="p-2 rounded-lg text-text-muted active:bg-bg-hover"
            title="Switch to Analyst Mode"
          >
            <Monitor size={16} />
          </button>
        </div>
      </div>

      {/* Entity nav bar — persistent when inside an investigation */}
      {drillDown && (
        <ExecEntityNav counts={drillEntityCounts} activeTab={activeEntityTab} onTap={handleEntityNavTap} />
      )}

      {/* Search bar — shown on list views */}
      {showSearch && (
        <div className="px-4 pt-3 pb-1 bg-bg-deep shrink-0">
          <ExecSearchBar value={searchQuery} onChange={setSearchQuery} />
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {drillDown ? (
          <div className="flex flex-col gap-3">
            <ExecBreadcrumb segments={breadcrumbs} />
            {renderDrillDown()}
          </div>
        ) : nav === 'overview' ? (
          <div className="flex flex-col gap-5">
            <ExecMetricsBar
              folders={folders}
              allNotes={allNotes}
              allTasks={allTasks}
              allEvents={allEvents}
              allIOCs={allIOCs}
            />

            {/* Active investigations preview */}
            {activeFolders.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-text-primary">Active Investigations</h2>
                  <button
                    onClick={() => { setNav('investigations'); }}
                    className="text-xs text-accent font-medium"
                  >
                    View all
                  </button>
                </div>
                <ExecInvestigationList
                  folders={activeFolders.slice(0, 5)}
                  allNotes={allNotes}
                  allTasks={allTasks}
                  allEvents={allEvents}
                  allWhiteboards={allWhiteboards}
                  allIOCs={allIOCs}
                  onSelect={handleSelectInvestigation}
                />
              </div>
            )}

            {/* Recent activity preview */}
            {activityEntries.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-text-primary">Recent Activity</h2>
                  <button
                    onClick={() => { setNav('activity'); }}
                    className="text-xs text-accent font-medium"
                  >
                    View all
                  </button>
                </div>
                <ExecActivityFeed entries={activityEntries} limit={10} />
              </div>
            )}
          </div>
        ) : nav === 'investigations' ? (
          <div>
            <h2 className="text-lg font-bold text-text-primary mb-4">Investigations</h2>
            <ExecInvestigationList
              folders={folders}
              allNotes={allNotes}
              allTasks={allTasks}
              allEvents={allEvents}
              allWhiteboards={allWhiteboards}
              allIOCs={allIOCs}
              onSelect={handleSelectInvestigation}
              filterText={searchQuery}
            />
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-bold text-text-primary mb-4">Activity</h2>
            <ExecActivityFeed entries={activityEntries} limit={50} />
          </div>
        )}
      </div>

      {/* Bottom tab bar — hide when drilled in */}
      {!drillDown && (
        <div className="flex items-center justify-around bg-bg-surface border-t border-border-subtle py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setNav(tab.key)}
              className={cn(
                'flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors min-w-[64px]',
                nav === tab.key
                  ? 'text-accent'
                  : 'text-text-muted active:text-text-secondary',
              )}
            >
              <tab.icon size={20} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Share dialog */}
      <ShareDialog
        open={sharePayload !== null}
        onClose={() => setSharePayload(null)}
        payload={sharePayload}
      />
    </div>
  );
}
