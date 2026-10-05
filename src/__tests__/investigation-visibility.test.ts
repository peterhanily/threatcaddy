import { describe, expect, it } from 'vitest';
import type { Folder, InvestigationSummary } from '../types';
import { DEFAULT_CLS_LEVELS } from '../types';
import {
  buildInvestigationVisibility,
  type InvestigationVisibilityInput,
} from '../lib/investigation-visibility';

const folder = (id: string, clsLevel?: string): Folder => ({
  id, name: id, order: 0, createdAt: 0, clsLevel,
});

const remote = (folderId: string, clsLevel?: string): InvestigationSummary => ({
  folderId, role: 'owner', joinedAt: '', memberCount: 1,
  folder: { name: folderId, status: 'active', createdAt: '', updatedAt: '', clsLevel },
  entityCounts: { notes: 0, tasks: 0, events: 0, iocs: 0, whiteboards: 0, chats: 0 },
});

const input = (overrides: Partial<InvestigationVisibilityInput> = {}): InvestigationVisibilityInput => ({
  folders: [folder('public', 'TLP:CLEAR'), folder('investigation', 'TLP:GREEN')],
  remoteInvestigations: [], notes: [], tasks: [], timelineEvents: [], whiteboards: [],
  standaloneIOCs: [], chatThreads: [], evidenceItems: [],
  maxLevel: 'TLP:GREEN', effectiveLevels: DEFAULT_CLS_LEVELS,
  ...overrides,
});

const childCollections = [
  'notes', 'tasks', 'timelineEvents', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'evidenceItems',
] as const;

describe('buildInvestigationVisibility', () => {
  it.each([undefined, null, ''])('preserves existing behavior when screenshare is off (%s)', maxLevel => {
    const source = input({
      folders: [folder('restricted', 'TLP:RED')],
      remoteInvestigations: [remote('remote-only', 'TLP:RED')],
      notes: [{ folderId: 'restricted', clsLevel: 'UNKNOWN' }],
      maxLevel,
    });
    const result = buildInvestigationVisibility(source);
    expect(result.folders).toBe(source.folders);
    expect(result.remoteInvestigations).toBe(source.remoteInvestigations);
    expect(result.hiddenFolderIds.size).toBe(0);
    expect(result.isEntityVisible({ folderId: 'missing', clsLevel: 'UNKNOWN' })).toBe(true);
    expect(result.isTimelineVisible({ id: 'any-timeline' })).toBe(true);
  });

  it('hides a folder by its own classification even when empty', () => {
    const result = buildInvestigationVisibility(input({
      folders: [folder('public'), folder('restricted', 'TLP:RED')],
    }));
    expect(result.folders.map(item => item.id)).toEqual(['public']);
    expect(result.hiddenFolderIds.has('restricted')).toBe(true);
    expect(result.isEntityVisible({ folderId: 'restricted' })).toBe(false);
  });

  it.each(childCollections)('inherits restrictions from %s and hides otherwise public siblings', collection => {
    const result = buildInvestigationVisibility(input({
      [collection]: [{ folderId: 'investigation', clsLevel: 'TLP:RED' }],
    }));
    expect(result.folders.map(item => item.id)).toEqual(['public']);
    expect(result.isEntityVisible({ folderId: 'investigation', clsLevel: 'TLP:CLEAR' })).toBe(false);
    expect(result.isEntityVisible({ folderId: 'public', clsLevel: 'TLP:GREEN' })).toBe(true);
  });

  it.each(childCollections)('inherits unknown classification restrictions from %s', collection => {
    const result = buildInvestigationVisibility(input({
      [collection]: [{ folderId: 'investigation', clsLevel: 'CUSTOM:UNKNOWN' }],
    }));
    expect(result.visibleFolderIds.has('investigation')).toBe(false);
  });

  it('includes archived and trashed entities when deciding folder visibility', () => {
    const notes = [{ folderId: 'investigation', clsLevel: 'TLP:RED', archived: true, trashed: true }];
    expect(buildInvestigationVisibility(input({ notes })).visibleFolderIds.has('investigation')).toBe(false);
  });

  it('includes classifications of embedded IOCs', () => {
    const notes = [{ folderId: 'investigation', iocAnalysis: { iocs: [{ clsLevel: 'TLP:RED' }] } }];
    const result = buildInvestigationVisibility(input({ notes }));
    expect(result.visibleFolderIds.has('investigation')).toBe(false);
    expect(result.isEntityVisible({ iocAnalysis: { iocs: [{ clsLevel: 'UNKNOWN' }] } })).toBe(false);
  });

  it('preserves unclassified entities without folders, but hides restricted or orphaned entities', () => {
    const result = buildInvestigationVisibility(input());
    expect(result.isEntityVisible({})).toBe(true);
    expect(result.isEntityVisible({ clsLevel: 'TLP:GREEN' })).toBe(true);
    expect(result.isEntityVisible({ clsLevel: 'TLP:RED' })).toBe(false);
    expect(result.isEntityVisible({ folderId: 'missing' })).toBe(false);
  });

  it('uses the configured custom hierarchy without converting labels to TLP', () => {
    const result = buildInvestigationVisibility(input({
      folders: [folder('public', 'PUBLIC'), folder('internal', 'INTERNAL'), folder('secret', 'SECRET'), folder('unknown', 'TLP:CLEAR')],
      maxLevel: 'INTERNAL', effectiveLevels: ['PUBLIC', 'INTERNAL', 'SECRET'],
    }));
    expect(result.folders.map(item => item.id)).toEqual(['public', 'internal']);
  });

  it('fails closed for classified folders when the threshold is unknown', () => {
    const result = buildInvestigationVisibility(input({ maxLevel: 'UNKNOWN' }));
    expect(result.folders).toEqual([]);
  });

  it('hides remote-only summaries regardless of classification or summary counts', () => {
    const result = buildInvestigationVisibility(input({
      remoteInvestigations: [remote('empty-remote'), remote('public-remote', 'TLP:CLEAR')],
    }));
    expect(result.remoteInvestigations).toEqual([]);
    expect(result.isEntityVisible({ folderId: 'public-remote' })).toBe(false);
  });

  it('hides paired remote metadata without hiding a safe complete local copy', () => {
    const result = buildInvestigationVisibility(input({
      remoteInvestigations: [remote('investigation', 'TLP:CLEAR')],
    }));
    expect(result.remoteInvestigations).toEqual([]);
    expect(result.visibleFolderIds.has('investigation')).toBe(true);
  });

  it('honors stricter remote metadata for a matching local investigation', () => {
    const result = buildInvestigationVisibility(input({
      remoteInvestigations: [remote('investigation', 'TLP:RED')],
    }));
    expect(result.visibleFolderIds.has('investigation')).toBe(false);
    expect(result.isEntityVisible({ folderId: 'investigation' })).toBe(false);
  });

  it('never lets public remote metadata weaken local restrictions', () => {
    const result = buildInvestigationVisibility(input({
      folders: [folder('investigation', 'TLP:RED')],
      remoteInvestigations: [remote('investigation', 'TLP:CLEAR')],
    }));
    expect(result.visibleFolderIds.has('investigation')).toBe(false);
  });

  it('inherits restrictions through timeline ownership when an event lacks a folder ID', () => {
    const result = buildInvestigationVisibility(input({
      folders: [folder('public'), { ...folder('investigation'), timelineId: 'timeline' }],
      timelineEvents: [{ timelineId: 'timeline', clsLevel: 'TLP:RED' }],
    }));
    expect(result.folders.map(item => item.id)).toEqual(['public']);
    expect(result.isEntityVisible({ timelineId: 'timeline' })).toBe(false);
    expect(result.isEntityVisible({ timelineId: 'unassigned-timeline' })).toBe(true);
  });

  it('honors both folder and timeline ownership when they differ', () => {
    const result = buildInvestigationVisibility(input({
      folders: [{ ...folder('public'), timelineId: 'shared' }, folder('investigation')],
      timelineEvents: [{ folderId: 'investigation', timelineId: 'shared', clsLevel: 'TLP:RED' }],
    }));
    expect(result.folders).toEqual([]);
  });

  it('does not mutate source collections or their entities', () => {
    const source = input({ notes: [{ folderId: 'investigation', clsLevel: 'TLP:RED' }] });
    const original = structuredClone(source);
    buildInvestigationVisibility(source);
    expect(source).toEqual(original);
  });

  it('hides all metadata and contents until every collection is loaded', () => {
    const result = buildInvestigationVisibility(input({ dataReady: false }));
    expect(result.folders).toEqual([]);
    expect(result.remoteInvestigations).toEqual([]);
    expect([...result.visibleFolderIds]).toEqual([]);
    expect(result.hiddenFolderIds.has('public')).toBe(true);
    expect(result.isEntityVisible({})).toBe(false);
    expect(result.isTimelineVisible({ id: 'timeline' })).toBe(false);
  });

  it('does not change normal browsing while collections are loading', () => {
    const source = input({ dataReady: false, maxLevel: undefined });
    const result = buildInvestigationVisibility(source);
    expect(result.folders).toBe(source.folders);
    expect(result.isEntityVisible({ clsLevel: 'TLP:RED' })).toBe(true);
    expect(result.isTimelineVisible({ id: 'timeline' })).toBe(true);
  });

  it('hides timelines belonging to restricted folders', () => {
    const result = buildInvestigationVisibility(input({
      folders: [{ ...folder('restricted', 'TLP:RED'), timelineId: 'timeline' }],
    }));
    expect(result.isTimelineVisible({ id: 'timeline' })).toBe(false);
    expect(result.isTimelineVisible({ id: 'unassigned' })).toBe(true);
  });

  it('recognizes timeline ownership through events when folder metadata has no link', () => {
    const result = buildInvestigationVisibility(input({
      folders: [folder('restricted', 'TLP:RED')],
      timelineEvents: [{ folderId: 'restricted', timelineId: 'timeline' }],
    }));
    expect(result.isTimelineVisible({ id: 'timeline' })).toBe(false);
    expect(result.isEntityVisible({ timelineId: 'timeline' })).toBe(false);
  });

  it('hides timelines containing restricted unfiled events', () => {
    const result = buildInvestigationVisibility(input({
      timelineEvents: [{ timelineId: 'timeline', clsLevel: 'TLP:RED' }],
    }));
    expect(result.isTimelineVisible({ id: 'timeline' })).toBe(false);
    expect(result.isEntityVisible({ timelineId: 'timeline' })).toBe(false);
    expect(result.folders).toHaveLength(2);
  });
});
