import { useState, useCallback } from 'react';
import { LayoutDashboard, FolderOpen, Activity, Sun, Moon, Monitor, Shield } from 'lucide-react';
import type { Folder, Note, Task, TimelineEvent, Whiteboard, StandaloneIOC, ActivityLogEntry } from '../../types';
import { cn } from '../../lib/utils';
import { ExecMetricsBar } from './ExecMetricsBar';
import { ExecInvestigationList } from './ExecInvestigationList';
import { ExecInvestigationDetail } from './ExecInvestigationDetail';
import { ExecActivityFeed } from './ExecActivityFeed';

type ExecNav = 'overview' | 'investigations' | 'activity';

interface ExecDashboardProps {
  folders: Folder[];
  allNotes: Note[];
  allTasks: Task[];
  allEvents: TimelineEvent[];
  allWhiteboards: Whiteboard[];
  allIOCs: StandaloneIOC[];
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
  activityEntries,
  theme,
  onToggleTheme,
  onSwitchToAnalystMode,
}: ExecDashboardProps) {
  const [nav, setNav] = useState<ExecNav>('overview');
  const [detailFolderId, setDetailFolderId] = useState<string | null>(null);

  const detailFolder = detailFolderId ? folders.find((f) => f.id === detailFolderId) : null;

  const handleSelectInvestigation = useCallback((id: string) => {
    setDetailFolderId(id);
  }, []);

  const handleBackFromDetail = useCallback(() => {
    setDetailFolderId(null);
  }, []);

  const handleOpenAnalystMode = useCallback(() => {
    onSwitchToAnalystMode(detailFolderId ?? undefined);
  }, [detailFolderId, onSwitchToAnalystMode]);

  const activeFolders = folders.filter((f) => (f.status || 'active') === 'active');

  const tabs: { key: ExecNav; label: string; icon: typeof LayoutDashboard }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'investigations', label: 'Cases', icon: FolderOpen },
    { key: 'activity', label: 'Activity', icon: Activity },
  ];

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
        {detailFolder ? (
          <ExecInvestigationDetail
            folder={detailFolder}
            allNotes={allNotes}
            allTasks={allTasks}
            allEvents={allEvents}
            allWhiteboards={allWhiteboards}
            allIOCs={allIOCs}
            activityEntries={activityEntries}
            onBack={handleBackFromDetail}
            onOpenAnalystMode={handleOpenAnalystMode}
          />
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

      {/* Bottom tab bar */}
      {!detailFolder && (
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
    </div>
  );
}
