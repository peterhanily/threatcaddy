/**
 * Data collection for backup payloads — follows export.ts patterns.
 */

import { db } from '../db';
import type { BackupPayload } from './backup-crypto';

// Helper: get a Dexie table by name, returning an untyped handle for dynamic access
/* eslint-disable @typescript-eslint/no-explicit-any */
function getTable(name: string): any {
  return (db as any)[name];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function buildFullBackupPayload(
  scope: 'all' | 'investigation' | 'entity',
  scopeId?: string,
): Promise<BackupPayload> {
  const data: BackupPayload['data'] = {};

  if (scope === 'all') {
    const [notes, tasks, folders, tags, timelineEvents, timelines, whiteboards, standaloneIOCs, chatThreads, agentActions, agentProfiles, agentDeployments, agentMeetings, noteTemplates, playbookTemplates, integrationTemplates, installedIntegrations, customSlashCommands] =
      await Promise.all([
        db.notes.toArray(),
        db.tasks.toArray(),
        db.folders.toArray(),
        db.tags.toArray(),
        db.timelineEvents.toArray(),
        db.timelines.toArray(),
        db.whiteboards.toArray(),
        db.standaloneIOCs.toArray(),
        db.chatThreads.toArray(),
        db.agentActions.toArray(),
        db.agentProfiles.toArray(),
        db.agentDeployments.toArray(),
        db.agentMeetings.toArray(),
        db.noteTemplates.toArray(),
        db.playbookTemplates.toArray(),
        db.integrationTemplates.toArray(),
        db.installedIntegrations.toArray(),
        db.customSlashCommands.toArray(),
      ]);
    Object.assign(data, { notes, tasks, folders, tags, timelineEvents, timelines, whiteboards, standaloneIOCs, chatThreads, agentActions, agentProfiles, agentDeployments, agentMeetings, noteTemplates, playbookTemplates, integrationTemplates, installedIntegrations, customSlashCommands });
  } else if (scope === 'investigation') {
    if (!scopeId) throw new Error('scopeId required for investigation scope');
    const [folder, notes, tasks, allTags, events, allTimelines, whiteboards, iocs, chats, agentActions, agentDeployments, agentMeetings] = await Promise.all([
      db.folders.get(scopeId),
      db.notes.where('folderId').equals(scopeId).toArray(),
      db.tasks.where('folderId').equals(scopeId).toArray(),
      db.tags.toArray(),
      db.timelineEvents.where('folderId').equals(scopeId).toArray(),
      db.timelines.toArray(),
      db.whiteboards.where('folderId').equals(scopeId).toArray(),
      db.standaloneIOCs.where('folderId').equals(scopeId).toArray(),
      db.chatThreads.where('folderId').equals(scopeId).toArray(),
      db.agentActions.where('investigationId').equals(scopeId).toArray(),
      db.agentDeployments.where('investigationId').equals(scopeId).toArray(),
      db.agentMeetings.where('investigationId').equals(scopeId).toArray(),
    ]);
    if (!folder) throw new Error('Investigation not found');

    // Collect used tag names
    const usedTagNames = new Set<string>();
    for (const n of notes) n.tags.forEach((t: string) => usedTagNames.add(t));
    for (const t of tasks) t.tags.forEach((tg: string) => usedTagNames.add(tg));
    for (const e of events) e.tags.forEach((tg: string) => usedTagNames.add(tg));
    for (const w of whiteboards) w.tags.forEach((tg: string) => usedTagNames.add(tg));
    if (folder.tags) folder.tags.forEach((t: string) => usedTagNames.add(t));
    const tags = allTags.filter((t) => usedTagNames.has(t.name));

    // Include linked timelines
    const timelineIds = new Set(events.map((e) => e.timelineId));
    if (folder.timelineId) timelineIds.add(folder.timelineId);
    const timelines = allTimelines.filter((t) => timelineIds.has(t.id));

    Object.assign(data, {
      notes, tasks, folders: [folder], tags, timelineEvents: events, timelines, whiteboards,
      standaloneIOCs: iocs, chatThreads: chats, agentActions, agentDeployments, agentMeetings,
    });
  } else if (scope === 'entity') {
    if (!scopeId) throw new Error('scopeId required for entity scope');
    const [tableName, entityId] = scopeId.split(':');
    if (!tableName || !entityId) throw new Error('scopeId must be "tableName:entityId"');
    const table = getTable(tableName);
    if (!table) throw new Error(`Unknown table: ${tableName}`);
    const entity = await table.get(entityId);
    if (!entity) throw new Error(`Entity not found: ${scopeId}`);
    data[tableName as keyof BackupPayload['data']] = [entity];
  }

  return {
    version: 1,
    type: 'full',
    scope,
    scopeId,
    createdAt: Date.now(),
    data,
  };
}

export async function buildDifferentialPayload(
  scope: 'all' | 'investigation' | 'entity',
  lastBackupAt: number,
  parentBackupId: string,
  scopeId?: string,
): Promise<BackupPayload> {
  const data: BackupPayload['data'] = {};
  const deletedIds: Record<string, string[]> = {};

  const tableNames = ['notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'agentActions', 'agentProfiles', 'agentDeployments', 'agentMeetings', 'noteTemplates', 'playbookTemplates', 'integrationTemplates', 'installedIntegrations', 'customSlashCommands'] as const;

  for (const tableName of tableNames) {
    const table = getTable(tableName);
    const collection = table.where('updatedAt').above(lastBackupAt);

    // For investigation scope, further filter by folderId where applicable
    if (scope === 'investigation' && scopeId) {
      const all: Array<{ id: string; folderId?: string }> = await collection.toArray();
      const filtered = all.filter((item) => {
        if ('folderId' in item) return item.folderId === scopeId;
        return true; // tags, timelines don't have folderId — include if updated
      });
      data[tableName as keyof BackupPayload['data']] = filtered as unknown[];
    } else {
      data[tableName as keyof BackupPayload['data']] = await collection.toArray();
    }

    // Collect trashed entity IDs as tombstones
    const trashed: Array<{ id: string; trashed?: boolean; folderId?: string }> = await table.filter(
      (item: { trashed?: boolean; folderId?: string }) => {
        if (!item.trashed) return false;
        if (scope === 'investigation' && scopeId && 'folderId' in item) {
          return item.folderId === scopeId;
        }
        return scope === 'all';
      },
    ).toArray();

    if (trashed.length > 0) {
      deletedIds[tableName] = trashed.map((item) => item.id);
    }
  }

  return {
    version: 1,
    type: 'differential',
    scope,
    scopeId,
    parentBackupId,
    createdAt: Date.now(),
    lastBackupAt,
    data,
    deletedIds: Object.keys(deletedIds).length > 0 ? deletedIds : undefined,
  };
}

export function countPayloadEntities(payload: BackupPayload): number {
  let count = 0;
  const data = payload.data;
  if (data.notes) count += data.notes.length;
  if (data.tasks) count += data.tasks.length;
  if (data.folders) count += data.folders.length;
  if (data.tags) count += data.tags.length;
  if (data.timelineEvents) count += data.timelineEvents.length;
  if (data.timelines) count += data.timelines.length;
  if (data.whiteboards) count += data.whiteboards.length;
  if (data.standaloneIOCs) count += data.standaloneIOCs.length;
  if (data.chatThreads) count += data.chatThreads.length;
  if (data.agentActions) count += data.agentActions.length;
  if (data.agentProfiles) count += data.agentProfiles.length;
  if (data.agentDeployments) count += data.agentDeployments.length;
  if (data.agentMeetings) count += data.agentMeetings.length;
  if (data.noteTemplates) count += data.noteTemplates.length;
  if (data.playbookTemplates) count += data.playbookTemplates.length;
  if (data.integrationTemplates) count += data.integrationTemplates.length;
  if (data.installedIntegrations) count += data.installedIntegrations.length;
  if (data.customSlashCommands) count += data.customSlashCommands.length;
  return count;
}
