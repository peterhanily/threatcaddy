/**
 * IndexedDB migration from BrowserNotesDB → ThreatCaddyDB.
 * Must run before src/db.ts is imported so Dexie opens the new DB name.
 */

const OLD_DB_NAME = 'BrowserNotesDB';
const NEW_DB_NAME = 'ThreatCaddyDB';

const TABLE_NAMES = [
  'notes', 'tasks', 'folders', 'tags',
  'timelineEvents', 'timelines', 'whiteboards', 'activityLog',
] as const;

// Version 12 schema (matches src/db.ts)
const SCHEMA: Record<string, string> = {
  notes: 'id, title, folderId, pinned, archived, trashed, createdAt, updatedAt, *tags, *iocTypes',
  tasks: 'id, title, folderId, status, priority, completed, order, createdAt, updatedAt, *tags, *iocTypes',
  folders: 'id, name, order',
  tags: 'id, name',
  timelineEvents: 'id, timestamp, eventType, source, starred, folderId, timelineId, createdAt, updatedAt, *tags, *iocTypes',
  timelines: 'id, name, order, createdAt',
  whiteboards: 'id, name, folderId, order, createdAt, updatedAt, *tags',
  activityLog: 'id, category, action, timestamp',
};

function dbExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    let existed = true;
    req.onupgradeneeded = () => {
      // If onupgradeneeded fires, the DB didn't exist before
      existed = false;
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      req.result.close();
      if (!existed) {
        // Clean up the DB we accidentally created
        indexedDB.deleteDatabase(name);
      }
      resolve(existed);
    };
    req.onerror = () => resolve(false);
  });
}

function openDB(name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const table of TABLE_NAMES) {
        if (!db.objectStoreNames.contains(table)) {
          const keyPath = SCHEMA[table].split(',')[0].trim();
          const store = db.createObjectStore(table, { keyPath });
          // Create indexes from schema
          const parts = SCHEMA[table].split(',').slice(1).map(s => s.trim());
          for (const part of parts) {
            if (part.startsWith('*')) {
              const indexName = part.slice(1);
              if (!store.indexNames.contains(indexName)) {
                store.createIndex(indexName, indexName, { multiEntry: true });
              }
            } else if (part && !store.indexNames.contains(part)) {
              store.createIndex(part, part);
            }
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllFromStore(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putAllToStore(db: IDBDatabase, storeName: string, rows: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (rows.length === 0) { resolve(); return; }
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const row of rows) {
      store.put(row);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function migrateIndexedDB(): Promise<void> {
  try {
    const oldExists = await dbExists(OLD_DB_NAME);
    if (!oldExists) return;

    const newExists = await dbExists(NEW_DB_NAME);
    if (newExists) return; // New DB already exists, skip migration

    // Open old DB at version 12 (current schema)
    const oldDb = await openDB(OLD_DB_NAME, 12);
    const newDb = await openDB(NEW_DB_NAME, 12);

    // Copy all rows from each table
    for (const table of TABLE_NAMES) {
      if (oldDb.objectStoreNames.contains(table)) {
        const rows = await getAllFromStore(oldDb, table);
        if (rows.length > 0) {
          await putAllToStore(newDb, table, rows);
        }
      }
    }

    oldDb.close();
    newDb.close();

    // Delete old DB
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(OLD_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('IndexedDB migration failed:', err);
    // Don't block app startup — old data may still be accessible
  }
}
