import Dexie, { type EntityTable } from 'dexie';
import type { Note, Task, Folder, Tag, TimelineEvent, Timeline, Whiteboard, ActivityLogEntry, StandaloneIOC, ChatThread, NoteTemplate, PlaybookTemplate } from './types';
import type { IntegrationTemplate, InstalledIntegration, IntegrationRun } from './types/integration-types';
import { installEncryptionMiddleware } from './lib/encryptionMiddleware';

const db = new Dexie('ThreatCaddyDB') as Dexie & {
  notes: EntityTable<Note, 'id'>;
  tasks: EntityTable<Task, 'id'>;
  folders: EntityTable<Folder, 'id'>;
  tags: EntityTable<Tag, 'id'>;
  timelineEvents: EntityTable<TimelineEvent, 'id'>;
  timelines: EntityTable<Timeline, 'id'>;
  whiteboards: EntityTable<Whiteboard, 'id'>;
  activityLog: EntityTable<ActivityLogEntry, 'id'>;
  standaloneIOCs: EntityTable<StandaloneIOC, 'id'>;
  chatThreads: EntityTable<ChatThread, 'id'>;
  noteTemplates: EntityTable<NoteTemplate, 'id'>;
  playbookTemplates: EntityTable<PlaybookTemplate, 'id'>;
  integrationTemplates: EntityTable<IntegrationTemplate, 'id'>;
  installedIntegrations: EntityTable<InstalledIntegration, 'id'>;
  integrationRuns: EntityTable<IntegrationRun, 'id'>;
};

db.version(1).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags',
  tasks: 'id, title, folderId, status, priority, completed, order, createdAt, updatedAt, *tags',
  folders: 'id, name, order',
  tags: 'id, name',
});

db.version(2).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags, *iocTypes',
}).upgrade((tx) => {
  return tx.table('notes').toCollection().modify((note) => {
    if (!note.iocTypes) {
      note.iocTypes = [];
    }
  });
});

db.version(3).stores({
  tasks: 'id, title, folderId, status, priority, completed, order, createdAt, updatedAt, *tags, *iocTypes',
}).upgrade((tx) => {
  return tx.table('tasks').toCollection().modify((task) => {
    if (!task.iocTypes) task.iocTypes = [];
  });
});

db.version(4).stores({
  timelineEvents: 'id, timestamp, eventType, source, starred, folderId, createdAt, updatedAt, *tags',
});

db.version(5).stores({
  timelines: 'id, name, order, createdAt',
  timelineEvents: 'id, timestamp, eventType, source, starred, folderId, timelineId, createdAt, updatedAt, *tags',
}).upgrade(async (tx) => {
  const { nanoid } = await import('nanoid');
  const defaultId = nanoid();
  const now = Date.now();
  await tx.table('timelines').add({
    id: defaultId,
    name: 'Default',
    order: 0,
    createdAt: now,
    updatedAt: now,
  });
  await tx.table('timelineEvents').toCollection().modify((event: Record<string, unknown>) => {
    if (!event.timelineId) {
      event.timelineId = defaultId;
    }
  });
});

db.version(6).stores({
  whiteboards: 'id, name, folderId, order, createdAt, updatedAt, *tags',
});

db.version(7).stores({
  activityLog: 'id, category, action, timestamp',
});

db.version(8).stores({
  timelineEvents: 'id, timestamp, eventType, source, starred, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes',
}).upgrade((tx) => {
  return tx.table('timelineEvents').toCollection().modify((event) => {
    if (!event.iocTypes) event.iocTypes = [];
  });
});

// Version 9: entity linking fields (optional arrays, no index changes needed)
db.version(9).stores({});

// Version 10: clsLevel on notes, tasks, timeline events (optional, not indexed)
db.version(10).stores({});

// Version 11: Investigation metadata fields on folders (all optional, no index changes)
db.version(11).stores({});

// Version 12: Geolocation fields on timeline events (optional, not indexed)
db.version(12).stores({});

// Version 13: trash/archive for tasks, timeline events, whiteboards
db.version(13).stores({
  tasks: 'id, title, folderId, status, priority, completed, trashed, archived, order, createdAt, updatedAt, *tags, *iocTypes',
  timelineEvents: 'id, timestamp, eventType, source, starred, trashed, archived, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes',
  whiteboards: 'id, name, folderId, trashed, archived, order, createdAt, updatedAt, *tags',
}).upgrade(tx => {
  tx.table('tasks').toCollection().modify(t => { if (t.trashed === undefined) { t.trashed = false; t.archived = false; } });
  tx.table('timelineEvents').toCollection().modify(e => { if (e.trashed === undefined) { e.trashed = false; e.archived = false; } });
  tx.table('whiteboards').toCollection().modify(w => { if (w.trashed === undefined) { w.trashed = false; w.archived = false; } });
});

// Version 14: standalone IOCs table
db.version(14).stores({
  standaloneIOCs: 'id, type, value, folderId, trashed, archived, createdAt, updatedAt, *tags',
});

// Version 15: Chat threads table
db.version(15).stores({
  chatThreads: 'id, title, folderId, trashed, archived, createdAt, updatedAt, *tags',
});

// Version 16: Team server sync support — createdBy indexes + sync tables
db.version(16).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags, *iocTypes, createdBy',
  tasks: 'id, title, folderId, status, priority, completed, trashed, archived, order, createdAt, updatedAt, *tags, *iocTypes, createdBy',
  folders: 'id, name, order, createdBy',
  tags: 'id, name, createdBy',
  timelineEvents: 'id, timestamp, eventType, source, starred, trashed, archived, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes, createdBy',
  timelines: 'id, name, order, createdAt, createdBy',
  whiteboards: 'id, name, folderId, trashed, archived, order, createdAt, updatedAt, *tags, createdBy',
  standaloneIOCs: 'id, type, value, folderId, trashed, archived, createdAt, updatedAt, *tags, createdBy',
  chatThreads: 'id, title, folderId, trashed, archived, createdAt, updatedAt, *tags, createdBy',
  _syncQueue: '++seq, table, entityId, op',
  _syncMeta: 'key',
});

// Version 17: Task assignees
db.version(17).stores({
  tasks: 'id, title, folderId, status, priority, completed, trashed, archived, order, createdAt, updatedAt, *tags, *iocTypes, createdBy, assigneeId',
});

// Version 18: Note templates and playbook templates
db.version(18).stores({
  noteTemplates: 'id, name, category, source, createdAt, updatedAt',
  playbookTemplates: 'id, name, investigationType, source, createdAt, updatedAt',
});

// Version 19: Integration platform tables
db.version(19).stores({
  integrationTemplates: 'id, name, category, source, createdAt, updatedAt',
  installedIntegrations: 'id, templateId, enabled, createdAt, updatedAt',
  integrationRuns: 'id, integrationId, templateId, status, createdAt',
});

// Version 20: Composite indexes for common query patterns (performance)
db.version(20).stores({
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags, *iocTypes, createdBy, [folderId+updatedAt]',
  tasks: 'id, title, folderId, status, priority, completed, trashed, archived, order, createdAt, updatedAt, *tags, *iocTypes, createdBy, assigneeId, [folderId+status], [folderId+updatedAt]',
  timelineEvents: 'id, timestamp, eventType, source, starred, trashed, archived, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes, createdBy, [folderId+timestamp]',
});

// Encryption-at-rest middleware (transparent to all CRUD hooks)
installEncryptionMiddleware(db);

export { db };
