/**
 * Background image storage using a dedicated IndexedDB object store.
 * Keeps large blobs out of localStorage (which has ~5 MB limit).
 */

const DB_NAME = 'ThreatCaddyThemeAssets';
const STORE_NAME = 'assets';
const BG_KEY = 'background-image';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save a background image blob. */
export async function saveBgImage(blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, BG_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Load the stored background image as an object URL. Returns null if none set. */
export async function loadBgImage(): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(BG_KEY);
      req.onsuccess = () => {
        db.close();
        const blob = req.result as Blob | undefined;
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return null;
  }
}

/** Remove the stored background image. */
export async function removeBgImage(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(BG_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
