import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, WifiOff, Briefcase, Search } from 'lucide-react';
import type { Folder, InvestigationSummary, InvestigationDataMode, Note, Task, TimelineEvent, Whiteboard, StandaloneIOC, ChatThread } from '../../types';
import { cn } from '../../lib/utils';
import { InvestigationCard } from './InvestigationCard';
import { SupervisorSummary } from '../Agent/SupervisorSummary';

const ZERO_COUNTS = { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 };

export interface InvestigationsHubProps {
  localFolders: Folder[];
  remoteInvestigations: InvestigationSummary[];
  syncedFolderIds: Set<string>;
  serverConnected: boolean;
  localLoading: boolean;
  remoteLoading: boolean;
  onOpenInvestigation: (folderId: string, mode: InvestigationDataMode) => void;
  onSyncLocally: (folderId: string) => void;
  onUnsync: (folderId: string) => void;
  onCreateInvestigation: () => void;
  onEditInvestigation?: (folderId: string) => void;
  onArchiveInvestigation?: (folderId: string) => void;
  onUnarchiveInvestigation?: (folderId: string) => void;
  onDeleteInvestigation?: (folderId: string) => void;
  allNotes?: Note[];
  allTasks?: Task[];
  allEvents?: TimelineEvent[];
  allWhiteboards?: Whiteboard[];
  allIOCs?: StandaloneIOC[];
  allChats?: ChatThread[];
  syncingFolderId?: string | null;
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-raised p-3 animate-pulse">
      <div className="h-4 bg-bg-deep rounded w-3/4 mb-3" />
      <div className="grid grid-cols-3 gap-1 mb-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 bg-bg-deep/50 rounded-md" />
        ))}
      </div>
      <div className="flex gap-2">
        <div className="h-4 bg-bg-deep rounded w-14" />
        <div className="h-4 bg-bg-deep rounded w-10" />
      </div>
    </div>
  );
}

function EmptyState({ message, showCreate, onCreate }: { message: string; showCreate?: boolean; onCreate?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-text-muted">
      <Briefcase size={28} className="mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
      {showCreate && onCreate && (
        <button
          onClick={onCreate}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple text-white hover:brightness-110 transition-all"
        >
          <Plus size={14} />
          Create Investigation
        </button>
      )}
    </div>
  );
}

function SectionHeading({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{title}</h3>
      {count != null && (
        <span className="px-1.5 py-px rounded-full bg-bg-deep text-[9px] font-mono text-text-muted">
          {count}
        </span>
      )}
    </div>
  );
}

function DisconnectedBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border-subtle bg-bg-deep/50 text-text-muted text-xs mb-3">
      <WifiOff size={14} />
      <span>Server disconnected — remote investigations unavailable</span>
    </div>
  );
}

export function InvestigationsHub({
  localFolders,
  remoteInvestigations,
  syncedFolderIds,
  serverConnected,
  localLoading,
  remoteLoading,
  onOpenInvestigation,
  onSyncLocally,
  onUnsync,
  onCreateInvestigation,
  onEditInvestigation,
  onArchiveInvestigation,
  onUnarchiveInvestigation,
  onDeleteInvestigation,
  allNotes,
  allTasks,
  allEvents,
  allWhiteboards,
  allIOCs,
  allChats,
  syncingFolderId,
}: InvestigationsHubProps) {
  const { t } = useTranslation('investigations');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed' | 'archived'>('all');

  const matchesSearch = (name: string) => {
    if (!searchQuery.trim()) return true;
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const matchesStatus = (status?: string) => {
    if (statusFilter === 'all') return true;
    return (status || 'active') === statusFilter;
  };

  // Partition local folders
  const pureLocalFolders = localFolders.filter((f) => !syncedFolderIds.has(f.id) && f.status !== 'archived' && matchesSearch(f.name) && matchesStatus(f.status));
  const archivedLocalFolders = localFolders.filter((f) => !syncedFolderIds.has(f.id) && f.status === 'archived' && matchesSearch(f.name) && matchesStatus(f.status));
  const syncedLocalFolders = localFolders.filter((f) => syncedFolderIds.has(f.id) && f.status !== 'archived' && matchesSearch(f.name) && matchesStatus(f.status));

  // Compute entity counts for local folders
  const localCountsMap = useMemo(() => {
    const map = new Map<string, { notes: number; tasks: number; iocs: number; events: number; whiteboards: number; chats: number }>();
    for (const f of localFolders) map.set(f.id, { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 });
    for (const n of (allNotes ?? [])) { if (!n.trashed && !n.archived && n.folderId) { const c = map.get(n.folderId); if (c) c.notes++; } }
    for (const t of (allTasks ?? [])) { if (!t.trashed && !t.archived && t.folderId) { const c = map.get(t.folderId); if (c) c.tasks++; } }
    for (const e of (allEvents ?? [])) { if (!e.trashed && !e.archived && e.folderId) { const c = map.get(e.folderId); if (c) c.events++; } }
    for (const w of (allWhiteboards ?? [])) { if (!w.trashed && !w.archived && w.folderId) { const c = map.get(w.folderId); if (c) c.whiteboards++; } }
    for (const i of (allIOCs ?? [])) { if (!i.trashed && !i.archived && i.folderId) { const c = map.get(i.folderId); if (c) c.iocs++; } }
    for (const ch of (allChats ?? [])) { if (!ch.trashed && !ch.archived && ch.folderId) { const c = map.get(ch.folderId); if (c) c.chats++; } }
    return map;
  }, [localFolders, allNotes, allTasks, allEvents, allWhiteboards, allIOCs, allChats]);

  // Remote-only investigations (not synced locally)
  const remoteOnlyInvestigations = remoteInvestigations.filter((r) => !syncedFolderIds.has(r.folderId) && matchesSearch(r.folder.name) && matchesStatus(r.folder.status));

  // Build a lookup for remote data to merge with synced local folders
  const remoteByFolderId = new Map<string, InvestigationSummary>();
  for (const r of remoteInvestigations) {
    remoteByFolderId.set(r.folderId, r);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-text-primary">{t('hub.title')}</h1>
          <button
            onClick={onCreateInvestigation}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-purple text-white hover:brightness-110 transition-all"
          >
            <Plus size={16} />
            {t('hub.newInvestigation')}
          </button>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex items-center gap-3 mb-8">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder={t('hub.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border-subtle bg-bg-deep text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-purple/50"
            />
          </div>
          <div className="flex items-center gap-1">
            {(['all', 'active', 'closed', 'archived'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  statusFilter === s
                    ? 'bg-purple/20 text-purple'
                    : 'text-text-muted hover:bg-bg-deep hover:text-text-secondary'
                )}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Supervisor summary */}
        <SupervisorSummary onOpenSupervisor={(folderId) => onOpenInvestigation(folderId, 'local')} />

        {/* Section 1: My Investigations (purely local) */}
        <section className="mb-8">
          <SectionHeading title="My Investigations" count={pureLocalFolders.length} />
          {localLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : pureLocalFolders.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pureLocalFolders.map((f) => (
                <InvestigationCard
                  key={f.id}
                  folderId={f.id}
                  name={f.name}
                  status={(f.status || 'active') as 'active' | 'closed' | 'archived'}
                  color={f.color}
                  icon={f.icon}
                  description={f.description}
                  clsLevel={f.clsLevel}
                  entityCounts={localCountsMap.get(f.id) ?? ZERO_COUNTS}
                  dataMode="local"
                  updatedAt={f.updatedAt ?? f.createdAt}
                  onOpen={(id) => onOpenInvestigation(id, 'local')}
                  onSettings={onEditInvestigation}
                  onArchive={onArchiveInvestigation}
                  onUnarchive={onUnarchiveInvestigation}
                  onDelete={onDeleteInvestigation}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              message="No local investigations"
              showCreate
              onCreate={onCreateInvestigation}
            />
          )}
        </section>

        {/* Section: Archived (local-only) */}
        {archivedLocalFolders.length > 0 && (
          <section className="mb-8">
            <SectionHeading title="Archived" count={archivedLocalFolders.length} />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {archivedLocalFolders.map((f) => (
                <InvestigationCard
                  key={f.id}
                  folderId={f.id}
                  name={f.name}
                  status="archived"
                  color={f.color}
                  icon={f.icon}
                  description={f.description}
                  clsLevel={f.clsLevel}
                  entityCounts={localCountsMap.get(f.id) ?? ZERO_COUNTS}
                  dataMode="local"
                  updatedAt={f.updatedAt ?? f.createdAt}
                  onOpen={(id) => onOpenInvestigation(id, 'local')}
                  onSettings={onEditInvestigation ? (id) => onEditInvestigation(id) : undefined}
                  onUnarchive={onUnarchiveInvestigation}
                  onDelete={onDeleteInvestigation}
                />
              ))}
            </div>
          </section>
        )}

        {/* Section 2: Synced Investigations */}
        <section className="mb-8">
          <SectionHeading title="Synced Investigations" count={syncedLocalFolders.length} />
          {localLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SkeletonCard />
            </div>
          ) : syncedLocalFolders.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {syncedLocalFolders.map((f) => {
                const remote = remoteByFolderId.get(f.id);
                return (
                  <InvestigationCard
                    key={f.id}
                    folderId={f.id}
                    name={f.name}
                    status={(f.status || 'active') as 'active' | 'closed' | 'archived'}
                    color={f.color}
                    icon={f.icon}
                    description={f.description}
                    clsLevel={f.clsLevel}
                    entityCounts={remote?.entityCounts ?? localCountsMap.get(f.id) ?? ZERO_COUNTS}
                    memberCount={remote?.memberCount}
                    role={remote?.role}
                    dataMode="synced"
                    updatedAt={f.updatedAt ?? f.createdAt}
                    onOpen={(id) => onOpenInvestigation(id, 'synced')}
                    onUnsync={onUnsync}
                    onSettings={onEditInvestigation}
                    onArchive={onArchiveInvestigation}
                    onUnarchive={onUnarchiveInvestigation}
                    onDelete={onDeleteInvestigation}
                    syncing={syncingFolderId === f.id}
                  />
                );
              })}
            </div>
          ) : (
            <EmptyState message="No synced investigations — sync a remote investigation to work offline" />
          )}
        </section>

        {/* Section 3: Shared With Me (remote only) */}
        <section className="mb-8">
          <SectionHeading title="Shared With Me" count={serverConnected ? remoteOnlyInvestigations.length : undefined} />
          {!serverConnected ? (
            <DisconnectedBanner />
          ) : remoteLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : remoteOnlyInvestigations.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {remoteOnlyInvestigations.map((r) => (
                <InvestigationCard
                  key={r.folderId}
                  folderId={r.folderId}
                  name={r.folder.name}
                  status={(r.folder.status || 'active') as 'active' | 'closed' | 'archived'}
                  color={r.folder.color}
                  icon={r.folder.icon}
                  description={r.folder.description}
                  clsLevel={r.folder.clsLevel}
                  entityCounts={r.entityCounts}
                  memberCount={r.memberCount}
                  role={r.role}
                  dataMode="remote"
                  updatedAt={r.folder.updatedAt}
                  onOpen={(id) => onOpenInvestigation(id, 'remote')}
                  onSync={onSyncLocally}
                  onSettings={onEditInvestigation}
                  syncing={syncingFolderId === r.folderId}
                />
              ))}
            </div>
          ) : (
            <EmptyState message="No shared investigations — ask a team member to invite you" />
          )}
        </section>



      </div>
    </div>
  );
}
