import Dexie, { type EntityTable } from 'dexie';
import type { Note, Task, Folder, Tag } from './types';

const db = new Dexie('BrowserNotesDB') as Dexie & {
  notes: EntityTable<Note, 'id'>;
  tasks: EntityTable<Task, 'id'>;
  folders: EntityTable<Folder, 'id'>;
  tags: EntityTable<Tag, 'id'>;
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

export { db };
