import { Plus, WifiOff, Loader2, Briefcase } from 'lucide-react';
import type { Folder, InvestigationSummary, InvestigationDataMode } from '../../types';
import { cn } from '../../lib/utils';
import { InvestigationCard } from './InvestigationCard';

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
}: InvestigationsHubProps) {
  // Partition local folders
  const pureLocalFolders = localFolders.filter((f) => !syncedFolderIds.has(f.id));
  const syncedLocalFolders = localFolders.filter((f) => syncedFolderIds.has(f.id));

  // Remote-only investigations (not synced locally)
  const remoteOnlyInvestigations = remoteInvestigations.filter((r) => !syncedFolderIds.has(r.folderId));

  // Build a lookup for remote data to merge with synced local folders
  const remoteByFolderId = new Map<string, InvestigationSummary>();
  for (const r of remoteInvestigations) {
    remoteByFolderId.set(r.folderId, r);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-bold text-text-primary">Investigations</h1>
          <button
            onClick={onCreateInvestigation}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-purple text-white hover:brightness-110 transition-all"
          >
            <Plus size={16} />
            New Investigation
          </button>
        </div>

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
                  entityCounts={{ notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 }}
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
                    entityCounts={remote?.entityCounts ?? { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 }}
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
                  />
                );
              })}
            </div>
          ) : (
            <EmptyState message="No synced investigations" />
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
                />
              ))}
            </div>
          ) : (
            <EmptyState message="No shared investigations" />
          )}
        </section>

        {/* Section 4: Intake Queue (placeholder) */}
        <section className="mb-8">
          <SectionHeading title="Intake Queue" />
          <div className={cn(
            'flex items-center justify-center py-10 rounded-lg',
            'border border-dashed border-border-subtle bg-bg-deep/30',
          )}>
            <div className="flex items-center gap-2 text-text-muted text-sm">
              {remoteLoading && <Loader2 size={14} className="animate-spin" />}
              <span>Coming soon</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
