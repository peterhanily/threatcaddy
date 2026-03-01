import { useState, useCallback, useMemo } from 'react';
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
  | { screen: 'iocList'; folderId: string };

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
        default: return null;
      }
    });
  }, []);

  const handleOpenAnalystMode = useCallback(() => {
    const folderId = drillDown?.folderId;
    onSwitchToAnalystMode(folderId ?? undefined);
  }, [drillDown, onSwitchToAnalystMode]);

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
      tags: allTags,
    };
    setSharePayload({ v: 1, s: 'investigation', t: Date.now(), d: bundle });
  }, [drillDown, folders, allNotes, allTasks, allEvents, allTimelines, allWhiteboards, allIOCs, allTags]);

  const activeFolders = folders.filter((f) => (f.status || 'active') === 'active');

  const drillFolder = useMemo(
    () => drillDown ? folders.find((f) => f.id === drillDown.folderId) : null,
    [drillDown, folders],
  );
  const drillFolderName = drillFolder?.name ?? 'Investigation';

  const tabs: { key: ExecNav; label: string; icon: typeof LayoutDashboard }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'investigations', label: 'Cases', icon: FolderOpen },
    { key: 'activity', label: 'Activity', icon: Activity },
  ];

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
            mode="notes"
            folderId={drillDown.folderId}
            folderName={drillFolderName}
            allNotes={allNotes}
            allTasks={allTasks}
            allEvents={allEvents}
            allWhiteboards={allWhiteboards}
            allIOCs={allIOCs}
            onBack={handleBack}
            onSelectNote={(id) => setDrillDown({ screen: 'noteDetail', folderId: drillDown.folderId, noteId: id })}
          />
        );

      case 'noteDetail': {
        const note = allNotes.find((n) => n.id === drillDown.noteId);
        return note ? (
          <ExecNoteView note={note} allNotes={allNotes} onBack={handleBack} />
        ) : null;
      }

      case 'taskList':
        return (
          <ExecEntityList
            mode="tasks"
            folderId={drillDown.folderId}
            folderName={drillFolderName}
            allNotes={allNotes}
            allTasks={allTasks}
            allEvents={allEvents}
            allWhiteboards={allWhiteboards}
            allIOCs={allIOCs}
            onBack={handleBack}
            onSelectTask={(id) => setDrillDown({ screen: 'taskDetail', folderId: drillDown.folderId, taskId: id })}
          />
        );

      case 'taskDetail': {
        const task = allTasks.find((t) => t.id === drillDown.taskId);
        return task ? <ExecTaskView task={task} onBack={handleBack} /> : null;
      }

      case 'eventList':
        return (
          <ExecEntityList
            mode="events"
            folderId={drillDown.folderId}
            folderName={drillFolderName}
            allNotes={allNotes}
            allTasks={allTasks}
            allEvents={allEvents}
            allWhiteboards={allWhiteboards}
            allIOCs={allIOCs}
            onBack={handleBack}
            onSelectEvent={(id) => setDrillDown({ screen: 'eventDetail', folderId: drillDown.folderId, eventId: id })}
          />
        );

      case 'eventDetail': {
        const event = allEvents.find((e) => e.id === drillDown.eventId);
        return event ? <ExecEventView event={event} onBack={handleBack} /> : null;
      }

      case 'whiteboardList':
        return (
          <ExecEntityList
            mode="whiteboards"
            folderId={drillDown.folderId}
            folderName={drillFolderName}
            allNotes={allNotes}
            allTasks={allTasks}
            allEvents={allEvents}
            allWhiteboards={allWhiteboards}
            allIOCs={allIOCs}
            onBack={handleBack}
            onSwitchToAnalystMode={handleOpenAnalystMode}
          />
        );

      case 'iocList':
        return (
          <ExecEntityList
            mode="iocs"
            folderId={drillDown.folderId}
            folderName={drillFolderName}
            allNotes={allNotes}
            allTasks={allTasks}
            allEvents={allEvents}
            allWhiteboards={allWhiteboards}
            allIOCs={allIOCs}
            onBack={handleBack}
          />
        );

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

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {drillDown ? (
          renderDrillDown()
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
