/**
 * Dexie DBCore middleware that transparently encrypts/decrypts designated fields.
 *
 * - On mutate (add/put): encrypts fields before passing to core
 * - On get/getMany/query: decrypts fields after core returns rows
 * - No-op when sessionKey is null (encryption disabled or not yet unlocked)
 * - encryptField is idempotent (skips already-encrypted envelopes) so that
 *   Collection.modify() works correctly even without cursor-level decryption.
 */

import Dexie from 'dexie';
import type { DBCore, DBCoreTable, DBCoreMutateRequest, DBCoreGetRequest, DBCoreGetManyRequest, DBCoreQueryRequest } from 'dexie';
import { encryptField, decryptField } from './crypto';

// Fields to encrypt per table. Everything NOT listed stays plaintext (queryable).
export const ENCRYPTED_FIELDS: Record<string, string[]> = {
  notes: ['title', 'content', 'sourceUrl', 'sourceTitle', 'color', 'clsLevel', 'iocAnalysis'],
  tasks: ['title', 'description', 'clsLevel', 'iocAnalysis', 'comments'],
  folders: ['name', 'description', 'clsLevel', 'papLevel'],
  timelineEvents: ['title', 'description', 'source', 'actor', 'rawData', 'clsLevel', 'iocAnalysis'],
  timelines: ['name', 'description'],
  whiteboards: ['name', 'elements', 'appState'],
  tags: ['name'],
  activityLog: ['detail', 'itemTitle'],
  chatThreads: ['title', 'messages'],
};

// ── Session key (in-memory only, lost on tab close) ──────────────────

let sessionKey: CryptoKey | null = null;
let sessionKeyRawB64: string | null = null; // raw key bytes for re-caching

export function setSessionKey(key: CryptoKey | null, rawBase64?: string): void {
  sessionKey = key;
  if (rawBase64 !== undefined) sessionKeyRawB64 = rawBase64;
  if (key === null) sessionKeyRawB64 = null;
}

export function getSessionKey(): CryptoKey | null {
  return sessionKey;
}

export function getSessionKeyRaw(): string | null {
  return sessionKeyRawB64;
}

// ── Row-level encrypt / decrypt ──────────────────────────────────────

async function encryptRow(tableName: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!sessionKey || !row) return row;
  const fields = ENCRYPTED_FIELDS[tableName];
  if (!fields) return row;

  const encrypted = { ...row };
  for (const field of fields) {
    if (field in encrypted) {
      encrypted[field] = await encryptField(encrypted[field], sessionKey);
    }
  }
  return encrypted;
}

async function decryptRow(tableName: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!sessionKey || !row) return row;
  const fields = ENCRYPTED_FIELDS[tableName];
  if (!fields) return row;

  const decrypted = { ...row };
  for (const field of fields) {
    if (field in decrypted) {
      decrypted[field] = await decryptField(decrypted[field], sessionKey) as unknown;
    }
  }
  return decrypted;
}

// ── Middleware installation ───────────────────────────────────────────

export function installEncryptionMiddleware(db: Dexie): void {
  db.use({
    stack: 'dbcore',
    name: 'encryption',
    create(downlevelDatabase: DBCore): DBCore {
      return {
        ...downlevelDatabase,
        table(tableName: string): DBCoreTable {
          const downlevelTable = downlevelDatabase.table(tableName);
          const fields = ENCRYPTED_FIELDS[tableName];
          if (!fields) return downlevelTable; // no encrypted fields → passthrough

          return {
            ...downlevelTable,

            async mutate(req: DBCoreMutateRequest) {
              if (!sessionKey || (req.type !== 'add' && req.type !== 'put')) {
                return downlevelTable.mutate(req);
              }
              // Dexie.waitFor() keeps the IDB transaction alive while we
              // await Web Crypto (which returns native Promises outside Dexie's
              // zone and would otherwise cause TransactionInactiveError).
              const encryptedValues = await Dexie.waitFor(
                Promise.all(
                  (req.values ?? []).map((v) => encryptRow(tableName, v as Record<string, unknown>)),
                ),
              );
              return downlevelTable.mutate({ ...req, values: encryptedValues });
            },

            async get(req: DBCoreGetRequest) {
              const result = await downlevelTable.get(req);
              if (!sessionKey || !result) return result;
              return decryptRow(tableName, result as Record<string, unknown>);
            },

            async getMany(req: DBCoreGetManyRequest) {
              const results = await downlevelTable.getMany(req);
              if (!sessionKey) return results;
              return Promise.all(
                results.map((r) => (r ? decryptRow(tableName, r as Record<string, unknown>) : r)),
              );
            },

            async query(req: DBCoreQueryRequest) {
              const result = await downlevelTable.query(req);
              if (!sessionKey || !req.values) return result;
              const decryptedRows = await Promise.all(
                result.result.map((r: unknown) =>
                  r ? decryptRow(tableName, r as Record<string, unknown>) : r,
                ),
              );
              return { ...result, result: decryptedRows };
            },
          };
        },
      };
    },
  });
}

// ── Bulk encrypt / decrypt (for enable / disable) ────────────────────

export async function encryptAllExistingData(
  db: Dexie,
  onProgress?: (p: { current: number; total: number }) => void,
): Promise<void> {
  const tableNames = Object.keys(ENCRYPTED_FIELDS);
  let total = 0;
  let current = 0;

  for (const name of tableNames) {
    total += await db.table(name).count();
  }
  onProgress?.({ current: 0, total });

  for (const name of tableNames) {
    // toArray() goes through middleware query → decryptField returns plaintext as-is
    const rows = await db.table(name).toArray();
    for (const row of rows) {
      // put() goes through middleware mutate → encrypts fields
      await db.table(name).put(row);
      current++;
      onProgress?.({ current, total });
    }
  }
}

export async function decryptAllExistingData(
  db: Dexie,
  onProgress?: (p: { current: number; total: number }) => void,
): Promise<void> {
  const tableNames = Object.keys(ENCRYPTED_FIELDS);
  let total = 0;
  let current = 0;

  for (const name of tableNames) {
    total += await db.table(name).count();
  }
  onProgress?.({ current: 0, total });

  // Phase 1: read all data (decrypted by middleware)
  const allData: Record<string, unknown[]> = {};
  for (const name of tableNames) {
    allData[name] = await db.table(name).toArray();
  }

  // Phase 2: clear session key so writes go through as plaintext
  setSessionKey(null);

  // Phase 3: write back plaintext
  for (const name of tableNames) {
    for (const row of allData[name]) {
      await db.table(name).put(row);
      current++;
      onProgress?.({ current, total });
    }
  }
}
