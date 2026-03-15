import { describe, it, expect, beforeEach } from 'vitest';
import { migrateIndexedDB } from '../lib/db-migration';

const OLD_DB_NAME = 'BrowserNotesDB';
const NEW_DB_NAME = 'ThreatCaddyDB';

// ── Raw IDB helpers (bypass Dexie) ──────────────────────────────────

function deleteDB(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // don't fail test on cleanup
  });
}

function createOldDB(data?: Record<string, unknown[]>): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Create old DB at version 12 (the version it would have been at before rename)
    const req = indexedDB.open(OLD_DB_NAME, 12);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Create the 8 stores that existed at v12
      db.createObjectStore('notes', { keyPath: 'id' });
      db.createObjectStore('tasks', { keyPath: 'id' });
      db.createObjectStore('folders', { keyPath: 'id' });
      db.createObjectStore('tags', { keyPath: 'id' });
      db.createObjectStore('timelineEvents', { keyPath: 'id' });
      db.createObjectStore('timelines', { keyPath: 'id' });
      db.createObjectStore('whiteboards', { keyPath: 'id' });
      db.createObjectStore('activityLog', { keyPath: 'id' });
    };
    req.onsuccess = async () => {
      const db = req.result;
      if (data) {
        for (const [store, rows] of Object.entries(data)) {
          if (rows.length > 0 && db.objectStoreNames.contains(store)) {
            await new Promise<void>((res, rej) => {
              const tx = db.transaction(store, 'readwrite');
              const s = tx.objectStore(store);
              for (const row of rows) s.put(row);
              tx.oncomplete = () => res();
              tx.onerror = () => rej(tx.error);
            });
          }
        }
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function openDBReadonly(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    let existed = true;
    req.onupgradeneeded = () => {
      existed = false;
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      req.result.close();
      if (!existed) indexedDB.deleteDatabase(name);
      resolve(existed);
    };
    req.onerror = () => resolve(false);
  });
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(async () => {
  await deleteDB(OLD_DB_NAME);
  await deleteDB(NEW_DB_NAME);
});

// ── Tests ───────────────────────────────────────────────────────────

describe('migrateIndexedDB', () => {
  it('does nothing when old DB does not exist', async () => {
    await migrateIndexedDB();

    // New DB should NOT have been created
    expect(await dbExists(NEW_DB_NAME)).toBe(false);
  });

  it('copies data from old DB to new DB', async () => {
    const note = { id: 'n1', title: 'Migrated Note', content: 'Hello', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 };
    const task = { id: 't1', title: 'Migrated Task', completed: false, priority: 'none', tags: [], status: 'todo', order: 0, createdAt: 1, updatedAt: 1 };
    const folder = { id: 'f1', name: 'Work', order: 0, createdAt: 1 };

    const oldDb = await createOldDB({
      notes: [note],
      tasks: [task],
      folders: [folder],
    });
    oldDb.close();

    await migrateIndexedDB();

    // New DB should exist with the data
    const newDb = await openDBReadonly(NEW_DB_NAME);
    const notes = await getAll(newDb, 'notes') as typeof note[];
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe('n1');
    expect(notes[0].title).toBe('Migrated Note');

    const tasks = await getAll(newDb, 'tasks') as typeof task[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('t1');

    const folders = await getAll(newDb, 'folders') as typeof folder[];
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('Work');

    newDb.close();
  });

  it('deletes old DB after migration', async () => {
    const oldDb = await createOldDB({ notes: [{ id: 'n1', title: 'A' }] });
    oldDb.close();

    await migrateIndexedDB();

    expect(await dbExists(OLD_DB_NAME)).toBe(false);
  });

  it('skips migration when new DB already exists', async () => {
    const note = { id: 'n1', title: 'Old' };
    const oldDb = await createOldDB({ notes: [note] });
    oldDb.close();

    // Pre-create the new DB (simulating it already exists)
    const newDbReq = indexedDB.open(NEW_DB_NAME, 1);
    await new Promise<void>((resolve) => {
      newDbReq.onupgradeneeded = () => {
        newDbReq.result.createObjectStore('notes', { keyPath: 'id' });
      };
      newDbReq.onsuccess = () => { newDbReq.result.close(); resolve(); };
    });

    await migrateIndexedDB();

    // New DB should still be empty (migration skipped)
    const newDb = await openDBReadonly(NEW_DB_NAME);
    const notes = await getAll(newDb, 'notes');
    expect(notes).toHaveLength(0);
    newDb.close();

    // Old DB should NOT have been deleted
    expect(await dbExists(OLD_DB_NAME)).toBe(true);
  });

  it('migrates all 8 tables from old DB', async () => {
    const data: Record<string, unknown[]> = {
      notes: [{ id: 'n1', title: 'N' }],
      tasks: [{ id: 't1', title: 'T' }],
      folders: [{ id: 'f1', name: 'F' }],
      tags: [{ id: 'tg1', name: 'tag' }],
      timelineEvents: [{ id: 'te1', title: 'TE' }],
      timelines: [{ id: 'tl1', name: 'TL' }],
      whiteboards: [{ id: 'wb1', name: 'WB' }],
      activityLog: [{ id: 'al1', detail: 'AL' }],
    };

    const oldDb = await createOldDB(data);
    oldDb.close();

    await migrateIndexedDB();

    const newDb = await openDBReadonly(NEW_DB_NAME);
    for (const table of Object.keys(data)) {
      const rows = await getAll(newDb, table);
      expect(rows).toHaveLength(1);
    }
    newDb.close();
  });

  it('handles empty tables gracefully', async () => {
    const oldDb = await createOldDB({});
    oldDb.close();

    await migrateIndexedDB();

    const newDb = await openDBReadonly(NEW_DB_NAME);
    const notes = await getAll(newDb, 'notes');
    expect(notes).toHaveLength(0);
    newDb.close();
  });

  it('migrates multiple rows per table', async () => {
    const notes = [
      { id: 'n1', title: 'First' },
      { id: 'n2', title: 'Second' },
      { id: 'n3', title: 'Third' },
    ];
    const oldDb = await createOldDB({ notes });
    oldDb.close();

    await migrateIndexedDB();

    const newDb = await openDBReadonly(NEW_DB_NAME);
    const migrated = await getAll(newDb, 'notes') as typeof notes;
    expect(migrated).toHaveLength(3);
    expect(migrated.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
    newDb.close();
  });

  it('creates proper indexes on the new DB', async () => {
    const oldDb = await createOldDB({ notes: [{ id: 'n1', title: 'Test', tags: ['a'] }] });
    oldDb.close();

    await migrateIndexedDB();

    const newDb = await openDBReadonly(NEW_DB_NAME);
    const tx = newDb.transaction('notes', 'readonly');
    const store = tx.objectStore('notes');

    // Verify some key indexes exist on the new DB (created at v21 schema)
    expect(store.indexNames.contains('folderId')).toBe(true);
    expect(store.indexNames.contains('tags')).toBe(true);
    expect(store.indexNames.contains('createdAt')).toBe(true);
    expect(store.indexNames.contains('updatedAt')).toBe(true);
    expect(store.indexNames.contains('createdBy')).toBe(true);

    tx.abort();
    newDb.close();
  });

  it('preserves data fidelity (complex objects)', async () => {
    const complexNote = {
      id: 'n1',
      title: 'Complex',
      content: 'Body with unicode: émojis 🎉',
      tags: ['alpha', 'beta'],
      pinned: true,
      archived: false,
      trashed: false,
      folderId: 'f1',
      sourceUrl: 'https://example.com',
      iocTypes: ['ipv4', 'domain'],
      createdAt: 1709251200000,
      updatedAt: 1709337600000,
    };

    const oldDb = await createOldDB({ notes: [complexNote] });
    oldDb.close();

    await migrateIndexedDB();

    const newDb = await openDBReadonly(NEW_DB_NAME);
    const notes = await getAll(newDb, 'notes') as typeof complexNote[];
    expect(notes[0]).toEqual(complexNote);
    newDb.close();
  });
});
