/** Transparent content encryption; identifiers and operational metadata remain queryable. */
import Dexie from 'dexie';
import type { DBCore, DBCoreTable, DBCoreCursor, DBCoreMutateRequest, DBCoreGetRequest, DBCoreGetManyRequest, DBCoreQueryRequest, DBCoreOpenCursorRequest } from 'dexie';
import { encryptField, decryptField } from './crypto';
import { getEncryptionMeta, setEncryptionMeta, clearEncryptionMeta, isEncryptionEnabled } from './encryptionStore';
import { suppressSyncInCurrentTransaction } from './sync-state';

export const ENCRYPTION_COVERAGE_VERSION = 2;

/**
 * Plaintext contract: IDs/references, tags, timestamps, status/type flags, ordering,
 * counters, authorship IDs/labels and sync revision/cursor metadata are not hidden.
 * Encryption protects content and its durable copies, not traffic/relationship
 * metadata or a running, unlocked browser. _syncMeta contains metadata only.
 */
export const ENCRYPTED_FIELDS: Record<string, string[]> = {
  notes: ['title', 'content', 'sourceUrl', 'sourceTitle', 'color', 'clsLevel', 'iocAnalysis', 'annotations', '__fileName', '__imageData', '__imageAnalysis', '__imageOcrText', '__extractionWarning'],
  tasks: ['title', 'description', 'clsLevel', 'iocAnalysis', 'comments', 'checklist', 'rejectionHistory'],
  folders: ['name', 'description', 'clsLevel', 'papLevel', 'closedReason', 'playbookExecution', 'agentPolicy'],
  timelineEvents: ['title', 'description', 'source', 'actor', 'rawData', 'clsLevel', 'iocAnalysis', 'assets', 'latitude', 'longitude', 'comments'],
  timelines: ['name', 'description'],
  whiteboards: ['name', 'elements', 'appState', 'files', 'clsLevel'],
  tags: ['name'],
  activityLog: ['detail', 'itemTitle'],
  chatThreads: ['title', 'messages', 'contextSummary', 'clsLevel'],
  standaloneIOCs: ['value', 'analystNotes', 'clsLevel', 'attribution', 'enrichment', 'comments', 'assigneeName'],
  evidenceItems: ['title', 'fileName', 'content', 'imageData', 'imageAnalysis', 'imageOcrText', 'extractionWarning', 'clsLevel'],
  installedIntegrations: ['name', 'config', 'lastError'],
  integrationRuns: ['log', 'error', 'displayResults', 'inputSummary', 'outputSummary'],
  integrationTemplates: ['name', 'description', 'configSchema', 'steps', 'outputs', 'sourceUrl', 'requiredDomains'],
  noteTemplates: ['name', 'description', 'content', 'clsLevel', 'productBaseline'],
  playbookTemplates: ['name', 'description', 'steps', 'defaultClsLevel', 'defaultPapLevel'],
  checkpoints: ['snapshot'],
  customSlashCommands: ['name', 'description', 'template'],
  agentActions: ['toolInput', 'toolBinding', 'rationale', 'resultSummary'],
  agentProfiles: ['name', 'description', 'systemPrompt', 'soul', 'policy'],
  agentDeployments: ['policyOverrides', 'lastHandoffReconciliation'],
  agentMeetings: ['agenda', 'structuredOutput'],
  _syncQueue: ['data'],
};

let sessionKey: CryptoKey | null = null;
let sessionKeyRawB64: string | null = null;
let sessionEnabledAt: number | null = null;
const plaintextTransactions = new WeakSet<object>();

export function setSessionKey(key: CryptoKey | null, rawBase64?: string): void {
  sessionKey = key;
  sessionEnabledAt = key ? getEncryptionMeta()?.enabledAt ?? null : null;
  if (rawBase64 !== undefined) sessionKeyRawB64 = rawBase64;
  if (key === null) sessionKeyRawB64 = null;
}

export function getSessionKey(): CryptoKey | null { return sessionKey; }
export function getSessionKeyRaw(): string | null { return sessionKeyRawB64; }

function activeKey(): CryptoKey | null {
  if (sessionKey && sessionEnabledAt !== null) {
    const metadata = getEncryptionMeta();
    if (!metadata && !isEncryptionEnabled()) setSessionKey(null);
    else if (metadata?.enabledAt !== sessionEnabledAt) throw new Error('Encryption settings changed. Unlock the workspace again.');
  }
  return sessionKey;
}

async function transformRow(tableName: string, row: Record<string, unknown>, key: CryptoKey, encrypt: boolean): Promise<Record<string, unknown>> {
  const result = { ...row };
  for (const field of ENCRYPTED_FIELDS[tableName] ?? []) {
    if (field in result) result[field] = await (encrypt ? encryptField : decryptField)(result[field], key);
  }
  return result;
}

function decryptedCursor(cursor: DBCoreCursor, tableName: string, key: CryptoKey): DBCoreCursor {
  let value: unknown;
  const wrapped: DBCoreCursor = {
    get trans() { return cursor.trans; },
    get key() { return cursor.key; },
    get primaryKey() { return cursor.primaryKey; },
    get value() { return value; },
    get done() { return cursor.done; },
    continue: nextKey => cursor.continue(nextKey),
    continuePrimaryKey: (nextKey, primaryKey) => cursor.continuePrimaryKey(nextKey, primaryKey),
    advance: count => cursor.advance(count),
    stop: result => cursor.stop(result),
    fail: error => cursor.fail(error),
    start(onNext) {
      // Hold the transaction across every asynchronous Web Crypto cursor read.
      return Dexie.waitFor(cursor.start(() => {
        void transformRow(tableName, cursor.value as Record<string, unknown>, key, false)
          .then(decrypted => { value = decrypted; onNext(); })
          .catch(error => cursor.fail(error));
      }));
    },
    next() {
      let first = true;
      return wrapped.start(() => {
        if (first) { first = false; cursor.continue(); }
        else cursor.stop();
      }).then(() => wrapped);
    },
  };
  return wrapped;
}

export function installEncryptionMiddleware(db: Dexie): void {
  db.use({
    stack: 'dbcore', name: 'encryption', level: 10,
    create(downlevelDatabase: DBCore): DBCore {
      return {
        ...downlevelDatabase,
        table(tableName: string): DBCoreTable {
          const downlevelTable = downlevelDatabase.table(tableName);
          if (!ENCRYPTED_FIELDS[tableName]) return downlevelTable;
          return {
            ...downlevelTable,
            async mutate(req: DBCoreMutateRequest) {
              const key = activeKey();
              if (!key && isEncryptionEnabled()) throw new Error('Workspace is locked. Unlock it before changing data.');
              if (getEncryptionMeta()?.transition === 'decrypting' && !plaintextTransactions.has(req.trans) && (req.trans as IDBTransaction).mode !== 'versionchange') {
                throw new Error('Encryption is being disabled. Finish preparing the workspace before changing data.');
              }
              if (!key || plaintextTransactions.has(req.trans) || (req.type !== 'add' && req.type !== 'put')) return downlevelTable.mutate(req);
              const values = await Dexie.waitFor(Promise.all((req.values ?? []).map(value => transformRow(tableName, value as Record<string, unknown>, key, true))));
              return downlevelTable.mutate({ ...req, values });
            },
            async get(req: DBCoreGetRequest) {
              const key = activeKey();
              const result = await downlevelTable.get(req);
              return !key || !result ? result : Dexie.waitFor(transformRow(tableName, result, key, false));
            },
            async getMany(req: DBCoreGetManyRequest) {
              const key = activeKey();
              const results = await downlevelTable.getMany(req);
              return !key ? results : Dexie.waitFor(Promise.all(results.map(row => row ? transformRow(tableName, row, key, false) : row)));
            },
            async query(req: DBCoreQueryRequest) {
              const key = activeKey();
              const result = await downlevelTable.query(req);
              if (!key || !req.values) return result;
              return { ...result, result: await Dexie.waitFor(Promise.all(result.result.map(row => row ? transformRow(tableName, row, key, false) : row))) };
            },
            async openCursor(req: DBCoreOpenCursorRequest) {
              const key = activeKey();
              const cursor = await downlevelTable.openCursor(req);
              return cursor && key && req.values ? decryptedCursor(cursor, tableName, key) : cursor;
            },
          };
        },
      };
    },
  });
}

type Progress = (progress: { current: number; total: number }) => void;

async function rewriteContent(db: Dexie, encrypt: boolean, onProgress?: Progress): Promise<void> {
  if (!activeKey()) throw new Error('Unlock the workspace before converting encryption.');
  const tables = db.tables.filter(table => ENCRYPTED_FIELDS[table.name]);
  await db.transaction('rw', tables, async transaction => {
    suppressSyncInCurrentTransaction();
    if (!encrypt) plaintextTransactions.add(transaction.idbtrans);
    let total = 0;
    let current = 0;
    for (const table of tables) total += await table.count();
    onProgress?.({ current, total });
    for (const table of tables) {
      // Process one table at a time; the transaction commits every table together.
      const rows = await table.toArray();
      for (const row of rows) {
        await table.put(row);
        onProgress?.({ current: ++current, total });
      }
    }
  });
}

/** Metadata retains the wrapped key before conversion and on any failure. */
export async function encryptAllExistingData(db: Dexie, onProgress?: Progress): Promise<void> {
  const metadata = getEncryptionMeta();
  if (metadata) setEncryptionMeta({ ...metadata, transition: 'encrypting' });
  await rewriteContent(db, true, onProgress);
  if (metadata) setEncryptionMeta({ ...metadata, coverageVersion: ENCRYPTION_COVERAGE_VERSION, transition: undefined });
}

export async function decryptAllExistingData(db: Dexie, onProgress?: Progress): Promise<void> {
  const metadata = getEncryptionMeta();
  if (metadata) setEncryptionMeta({ ...metadata, transition: 'decrypting' });
  await rewriteContent(db, false, onProgress);
  // If metadata removal fails, keep the key and transition so retry is safe.
  if (metadata) clearEncryptionMeta();
  setSessionKey(null);
}

/** Called before App mounts after passphrase unlock or cached-key restoration. */
export async function ensureEncryptionReady(db: Dexie, onProgress?: Progress): Promise<void> {
  const metadata = getEncryptionMeta();
  if (!metadata) {
    if (isEncryptionEnabled()) throw new Error('Encryption metadata could not be read. Restore it from a backup before opening this workspace.');
    return;
  }
  if (metadata.transition === 'decrypting') await decryptAllExistingData(db, onProgress);
  else if (metadata.transition || (metadata.coverageVersion ?? 1) < ENCRYPTION_COVERAGE_VERSION) await encryptAllExistingData(db, onProgress);
}
