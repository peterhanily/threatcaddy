import type { Folder, InvestigationSummary } from '../types';
import { isAboveClsThreshold } from './classification';

/** The classification and ownership fields shared by investigation entities. */
export interface InvestigationVisibilityEntity {
  folderId?: string;
  clsLevel?: string;
  timelineId?: string;
  iocAnalysis?: { iocs: ReadonlyArray<{ clsLevel?: string }> };
}

export interface InvestigationVisibilityInput {
  folders: Folder[];
  remoteInvestigations: InvestigationSummary[];
  // Require every entity collection. Passing a previously filtered collection
  // would miss restrictions carried by archived or trashed children.
  notes: readonly InvestigationVisibilityEntity[];
  tasks: readonly InvestigationVisibilityEntity[];
  timelineEvents: readonly InvestigationVisibilityEntity[];
  whiteboards: readonly InvestigationVisibilityEntity[];
  standaloneIOCs: readonly InvestigationVisibilityEntity[];
  chatThreads: readonly InvestigationVisibilityEntity[];
  evidenceItems: readonly InvestigationVisibilityEntity[];
  maxLevel: string | null | undefined;
  effectiveLevels: string[];
  /** False until every local collection has loaded; prevents metadata flashes. */
  dataReady?: boolean;
}

export interface InvestigationVisibility {
  folders: Folder[];
  remoteInvestigations: InvestigationSummary[];
  visibleFolderIds: ReadonlySet<string>;
  hiddenFolderIds: ReadonlySet<string>;
  isEntityVisible: (entity: InvestigationVisibilityEntity) => boolean;
  isTimelineVisible: (timeline: { id: string }) => boolean;
}

/**
 * Build one screenshare policy for investigation metadata and its contents.
 * The caller must supply complete local collections, not just the active view.
 * This changes presentation only; it never modifies or declassifies stored data.
 */
export function buildInvestigationVisibility(input: InvestigationVisibilityInput): InvestigationVisibility {
  const { folders, remoteInvestigations, maxLevel, effectiveLevels } = input;
  if (!maxLevel) {
    return {
      folders,
      remoteInvestigations,
      visibleFolderIds: new Set(folders.map(folder => folder.id)),
      hiddenFolderIds: new Set(),
      isEntityVisible: () => true,
      isTimelineVisible: () => true,
    };
  }

  if (input.dataReady === false) {
    return {
      folders: [],
      remoteInvestigations: [],
      visibleFolderIds: new Set(),
      hiddenFolderIds: new Set([...folders.map(folder => folder.id), ...remoteInvestigations.map(remote => remote.folderId)]),
      isEntityVisible: () => false,
      isTimelineVisible: () => false,
    };
  }

  const hiddenFolderIds = new Set<string>();
  const hiddenTimelineIds = new Set<string>();
  const timelineFolderIds = new Map<string, Set<string>>();
  const isRestricted = (entity: InvestigationVisibilityEntity) => (
    isAboveClsThreshold(entity.clsLevel, maxLevel, effectiveLevels)
    || entity.iocAnalysis?.iocs.some(ioc => isAboveClsThreshold(ioc.clsLevel, maxLevel, effectiveLevels)) === true
  );

  for (const folder of folders) {
    if (isRestricted(folder)) hiddenFolderIds.add(folder.id);
    if (folder.timelineId) {
      const ids = timelineFolderIds.get(folder.timelineId) ?? new Set<string>();
      ids.add(folder.id);
      timelineFolderIds.set(folder.timelineId, ids);
    }
  }

  // Some imported timelines are related only through their events, not through
  // folder.timelineId. Include those relationships before computing visibility.
  for (const event of input.timelineEvents) {
    if (!event.timelineId) continue;
    if (isRestricted(event)) hiddenTimelineIds.add(event.timelineId);
    if (event.folderId) {
      const ids = timelineFolderIds.get(event.timelineId) ?? new Set<string>();
      ids.add(event.folderId);
      timelineFolderIds.set(event.timelineId, ids);
    }
  }

  // Remote metadata may be newer/more restrictive than the local copy. It can
  // restrict local visibility, but cannot prove that a remote copy is safe.
  for (const remote of remoteInvestigations) {
    if (isRestricted(remote.folder)) hiddenFolderIds.add(remote.folderId);
  }

  const linkedFolderIds = (entity: InvestigationVisibilityEntity): Set<string> => {
    const ids = new Set(entity.folderId ? [entity.folderId] : []);
    if (entity.timelineId) {
      for (const id of timelineFolderIds.get(entity.timelineId) ?? []) ids.add(id);
    }
    return ids;
  };

  const collections = [input.notes, input.tasks, input.timelineEvents, input.whiteboards,
    input.standaloneIOCs, input.chatThreads, input.evidenceItems];
  for (const entities of collections) {
    for (const entity of entities) {
      if (!isRestricted(entity)) continue;
      for (const folderId of linkedFolderIds(entity)) hiddenFolderIds.add(folderId);
    }
  }

  const visibleFolders = folders.filter(folder => !hiddenFolderIds.has(folder.id));
  const visibleFolderIds = new Set(visibleFolders.map(folder => folder.id));
  return {
    folders: visibleFolders,
    // Summary counts/classifications are not a complete child-level aggregate,
    // even when an investigation has a local copy. Do not display remote cards
    // or their server metadata until that completeness contract exists.
    remoteInvestigations: [],
    visibleFolderIds,
    hiddenFolderIds,
    isEntityVisible: entity => !isRestricted(entity)
      && (!entity.timelineId || !hiddenTimelineIds.has(entity.timelineId))
      && [...linkedFolderIds(entity)].every(folderId => visibleFolderIds.has(folderId)),
    isTimelineVisible: timeline => !hiddenTimelineIds.has(timeline.id)
      && [...(timelineFolderIds.get(timeline.id) ?? [])].every(folderId => visibleFolderIds.has(folderId)),
  };
}
