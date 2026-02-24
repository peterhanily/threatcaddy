import Dexie, { type EntityTable } from 'dexie';
import type { Note, Task, Folder, Tag, TimelineEvent, Timeline } from './types';

const db = new Dexie('BrowserNotesDB') as Dexie & {
  notes: EntityTable<Note, 'id'>;
  tasks: EntityTable<Task, 'id'>;
  folders: EntityTable<Folder, 'id'>;
  tags: EntityTable<Tag, 'id'>;
  timelineEvents: EntityTable<TimelineEvent, 'id'>;
  timelines: EntityTable<Timeline, 'id'>;
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

export { db };
