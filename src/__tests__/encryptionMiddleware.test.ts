/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock crypto with synchronous encrypt/decrypt to avoid fake-indexeddb
// transaction expiration (native Web Crypto Promises break Dexie's PSD zones).
vi.mock('../lib/crypto', async () => {
  const actual = await vi.importActual<typeof import('../lib/crypto')>('../lib/crypto');
  return {
    ...actual,
    // Synchronous mock: wraps value in an envelope using btoa (no Web Crypto)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    encryptField(value: unknown, _key: CryptoKey) {
      if (value === null || value === undefined) return value;
      if (actual.isEncryptedEnvelope(value)) return value;
      const isJson = typeof value !== 'string';
      const plaintext = isJson ? JSON.stringify(value) : (value as string);
      const envelope: Record<string, unknown> = {
        __enc: 1,
        ct: btoa(unescape(encodeURIComponent(plaintext))),
        iv: btoa('mock-iv-0000'),
      };
      if (isJson) envelope.json = true;
      return envelope;
    },
    // Synchronous mock: unwraps envelope
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    decryptField(value: unknown, _key: CryptoKey) {
      if (value === null || value === undefined) return value;
      if (!actual.isEncryptedEnvelope(value)) return value;
      const plaintext = decodeURIComponent(escape(atob(value.ct)));
      return value.json ? JSON.parse(plaintext) : plaintext;
    },
  };
});

import { db } from '../db';
import {
  ENCRYPTED_FIELDS,
  setSessionKey,
  getSessionKey,
  getSessionKeyRaw,
  encryptAllExistingData,
  decryptAllExistingData,
} from '../lib/encryptionMiddleware';
import { generateMasterKey, isEncryptedEnvelope } from '../lib/crypto';

// ── Helpers ─────────────────────────────────────────────────────────

function makeNote(id: string, title = 'Test Note', content = 'Secret content') {
  return {
    id, title, content, tags: ['alpha'], pinned: false,
    archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function makeTask(id: string, title = 'Test Task') {
  return {
    id, title, completed: false, priority: 'none' as const, tags: [],
    status: 'todo' as const, order: 0, createdAt: Date.now(), updatedAt: Date.now(),
  };
}

// ── Setup / Teardown ────────────────────────────────────────────────

beforeEach(async () => {
  setSessionKey(null);
  await db.notes.clear();
  await db.tasks.clear();
  await db.folders.clear();
  await db.tags.clear();
  await db.timelineEvents.clear();
  await db.timelines.clear();
  await db.whiteboards.clear();
  await db.activityLog.clear();
});

afterEach(() => {
  setSessionKey(null);
});

// ── ENCRYPTED_FIELDS constant ───────────────────────────────────────

describe('ENCRYPTED_FIELDS', () => {
  it('covers all 8 tables', () => {
    const tables = Object.keys(ENCRYPTED_FIELDS);
    expect(tables).toContain('notes');
    expect(tables).toContain('tasks');
    expect(tables).toContain('folders');
    expect(tables).toContain('timelines');
    expect(tables).toContain('timelineEvents');
    expect(tables).toContain('whiteboards');
    expect(tables).toContain('tags');
    expect(tables).toContain('activityLog');
    expect(tables).toHaveLength(8);
  });

  it('notes table encrypts sensitive fields', () => {
    expect(ENCRYPTED_FIELDS.notes).toContain('title');
    expect(ENCRYPTED_FIELDS.notes).toContain('content');
    expect(ENCRYPTED_FIELDS.notes).toContain('sourceUrl');
    expect(ENCRYPTED_FIELDS.notes).toContain('clsLevel');
    expect(ENCRYPTED_FIELDS.notes).toContain('iocAnalysis');
  });

  it('does not encrypt indexed/queryable fields', () => {
    expect(ENCRYPTED_FIELDS.notes).not.toContain('id');
    expect(ENCRYPTED_FIELDS.notes).not.toContain('folderId');
    expect(ENCRYPTED_FIELDS.notes).not.toContain('tags');
    expect(ENCRYPTED_FIELDS.notes).not.toContain('pinned');
    expect(ENCRYPTED_FIELDS.notes).not.toContain('createdAt');
    expect(ENCRYPTED_FIELDS.tasks).not.toContain('status');
    expect(ENCRYPTED_FIELDS.tasks).not.toContain('priority');
  });
});

// ── Session key management ──────────────────────────────────────────

describe('Session key management', () => {
  it('starts with null session key', () => {
    expect(getSessionKey()).toBeNull();
    expect(getSessionKeyRaw()).toBeNull();
  });

  it('setSessionKey stores and retrieves key', async () => {
    const key = await generateMasterKey();
    setSessionKey(key, 'dGVzdA==');

    expect(getSessionKey()).toBe(key);
    expect(getSessionKeyRaw()).toBe('dGVzdA==');
  });

  it('setSessionKey(null) clears both key and raw', async () => {
    const key = await generateMasterKey();
    setSessionKey(key, 'dGVzdA==');
    setSessionKey(null);

    expect(getSessionKey()).toBeNull();
    expect(getSessionKeyRaw()).toBeNull();
  });

  it('setSessionKey without rawBase64 preserves existing raw', async () => {
    const key1 = await generateMasterKey();
    const key2 = await generateMasterKey();
    setSessionKey(key1, 'original');
    setSessionKey(key2); // no rawBase64 arg

    expect(getSessionKey()).toBe(key2);
    expect(getSessionKeyRaw()).toBe('original');
  });
});

// ── Middleware: transparent encrypt/decrypt ──────────────────────────

describe('Middleware transparent encryption', () => {
  it('without session key, data is stored as plaintext', async () => {
    await db.notes.add(makeNote('n1', 'Plain Title', 'Plain Content'));

    const note = await db.notes.get('n1');
    expect(note!.title).toBe('Plain Title');
    expect(note!.content).toBe('Plain Content');
    expect(isEncryptedEnvelope(note!.title)).toBe(false);
  });

  it('with session key, add encrypts and get decrypts transparently', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.add(makeNote('n1', 'Secret Title', 'Secret Body'));

    // Read through middleware — should be plaintext
    const note = await db.notes.get('n1');
    expect(note!.title).toBe('Secret Title');
    expect(note!.content).toBe('Secret Body');
  });

  it('encrypted fields are actually encrypted in storage', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.add(makeNote('n1', 'Classified', 'Top Secret'));

    // Clear key so middleware doesn't decrypt on read
    setSessionKey(null);

    const raw = await db.notes.get('n1');
    expect(isEncryptedEnvelope(raw!.title)).toBe(true);
    expect(isEncryptedEnvelope(raw!.content)).toBe(true);
  });

  it('non-encrypted fields remain plaintext in storage', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.add(makeNote('n1'));

    setSessionKey(null);

    const raw = await db.notes.get('n1');
    expect(raw!.id).toBe('n1');
    expect(raw!.pinned).toBe(false);
    expect(raw!.archived).toBe(false);
    expect(raw!.tags).toEqual(['alpha']);
    expect(typeof raw!.createdAt).toBe('number');
  });

  it('put also encrypts fields', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.add(makeNote('n1', 'Original'));
    await db.notes.put(makeNote('n1', 'Updated'));

    // Transparent read
    expect((await db.notes.get('n1'))!.title).toBe('Updated');

    // Raw storage is encrypted
    setSessionKey(null);
    expect(isEncryptedEnvelope((await db.notes.get('n1'))!.title)).toBe(true);
  });

  it('query (toArray) returns decrypted results', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.bulkAdd([
      makeNote('n1', 'First', 'Body 1'),
      makeNote('n2', 'Second', 'Body 2'),
    ]);

    const results = await db.notes.toArray();
    expect(results).toHaveLength(2);
    expect(results.find((n) => n.id === 'n1')!.title).toBe('First');
    expect(results.find((n) => n.id === 'n2')!.title).toBe('Second');
  });

  it('where query returns decrypted results', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.add({ ...makeNote('n1', 'Scoped'), folderId: 'f1' });
    await db.notes.add({ ...makeNote('n2', 'Other'), folderId: 'f2' });

    const results = await db.notes.where('folderId').equals('f1').toArray();
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Scoped');
  });

  it('works across multiple tables', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.add(makeNote('n1', 'Secret Note'));
    await db.tasks.add(makeTask('t1', 'Secret Task'));
    await db.tags.add({ id: 'tg1', name: 'classified', color: '#f00' });

    // Transparent reads
    expect((await db.notes.get('n1'))!.title).toBe('Secret Note');
    expect((await db.tasks.get('t1'))!.title).toBe('Secret Task');
    expect((await db.tags.get('tg1'))!.name).toBe('classified');

    // Raw storage is encrypted
    setSessionKey(null);
    expect(isEncryptedEnvelope((await db.notes.get('n1'))!.title)).toBe(true);
    expect(isEncryptedEnvelope((await db.tasks.get('t1'))!.title)).toBe(true);
    expect(isEncryptedEnvelope((await db.tags.get('tg1'))!.name)).toBe(true);
  });

  it('fields not present in row are skipped (no crash)', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    // Note without optional sourceUrl/sourceTitle/color/clsLevel
    await db.notes.add(makeNote('n1'));

    const note = await db.notes.get('n1');
    expect(note!.id).toBe('n1');
    expect(note!.sourceUrl).toBeUndefined();
  });

  it('delete passes through without encryption', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.add(makeNote('n1'));
    await db.notes.delete('n1');

    expect(await db.notes.get('n1')).toBeUndefined();
  });
});

// ── Encrypt-then-disable round-trip ─────────────────────────────────

describe('Key rotation scenario', () => {
  it('data encrypted with key is unreadable raw without it', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.add(makeNote('n1', 'KeyA Data'));

    setSessionKey(null);
    const raw = await db.notes.get('n1');
    expect(isEncryptedEnvelope(raw!.title)).toBe(true);
    expect(raw!.title).not.toBe('KeyA Data');
  });

  it('data written without key, then read with key, stays plaintext', async () => {
    await db.notes.add(makeNote('n1', 'Plaintext'));

    const key = await generateMasterKey();
    setSessionKey(key);

    // decryptField passes through non-envelopes
    const note = await db.notes.get('n1');
    expect(note!.title).toBe('Plaintext');
  });
});

// ── encryptAllExistingData ──────────────────────────────────────────

describe('encryptAllExistingData', () => {
  it('encrypts all plaintext rows in all tables', async () => {
    // Write plaintext
    await db.notes.add(makeNote('n1', 'Plain Note'));
    await db.tasks.add(makeTask('t1', 'Plain Task'));

    // Enable encryption and encrypt existing data
    const key = await generateMasterKey();
    setSessionKey(key);
    await encryptAllExistingData(db);

    // Read with key — decrypted
    expect((await db.notes.get('n1'))!.title).toBe('Plain Note');
    expect((await db.tasks.get('t1'))!.title).toBe('Plain Task');

    // Read without key — encrypted envelopes
    setSessionKey(null);
    expect(isEncryptedEnvelope((await db.notes.get('n1'))!.title)).toBe(true);
    expect(isEncryptedEnvelope((await db.tasks.get('t1'))!.title)).toBe(true);
  });

  it('calls progress callback', async () => {
    await db.notes.add(makeNote('n1'));
    await db.tasks.add(makeTask('t1'));

    const key = await generateMasterKey();
    setSessionKey(key);

    const progress: { current: number; total: number }[] = [];
    await encryptAllExistingData(db, (p) => progress.push({ ...p }));

    // First callback: { current: 0, total: N }
    expect(progress[0].current).toBe(0);
    expect(progress[0].total).toBeGreaterThanOrEqual(2);

    // Last callback: current === total
    const last = progress[progress.length - 1];
    expect(last.current).toBe(last.total);
  });

  it('is idempotent (encrypting already-encrypted data is safe)', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);

    await db.notes.add(makeNote('n1', 'Data'));

    // Encrypt twice
    await encryptAllExistingData(db);
    await encryptAllExistingData(db);

    // Should still decrypt correctly
    expect((await db.notes.get('n1'))!.title).toBe('Data');
  });
});

// ── decryptAllExistingData ──────────────────────────────────────────

describe('decryptAllExistingData', () => {
  it('decrypts all encrypted rows back to plaintext', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);
    await db.notes.add(makeNote('n1', 'Was Encrypted'));
    await db.tasks.add(makeTask('t1', 'Was Encrypted Task'));

    // Decrypt all — clears session key internally
    await decryptAllExistingData(db);

    expect(getSessionKey()).toBeNull();

    // Data is plaintext now
    const note = await db.notes.get('n1');
    expect(note!.title).toBe('Was Encrypted');
    expect(isEncryptedEnvelope(note!.title)).toBe(false);

    const task = await db.tasks.get('t1');
    expect(task!.title).toBe('Was Encrypted Task');
    expect(isEncryptedEnvelope(task!.title)).toBe(false);
  });

  it('calls progress callback', async () => {
    const key = await generateMasterKey();
    setSessionKey(key);
    await db.notes.add(makeNote('n1'));

    const progress: { current: number; total: number }[] = [];
    await decryptAllExistingData(db, (p) => progress.push({ ...p }));

    expect(progress[0].current).toBe(0);
    const last = progress[progress.length - 1];
    expect(last.current).toBe(last.total);
  });

  it('full cycle: plaintext → encrypt all → decrypt all → plaintext', async () => {
    // 1. Write plaintext
    await db.notes.add(makeNote('n1', 'Cycle Test'));

    // 2. Encrypt existing
    const key = await generateMasterKey();
    setSessionKey(key);
    await encryptAllExistingData(db);

    // Verify encrypted
    setSessionKey(null);
    expect(isEncryptedEnvelope((await db.notes.get('n1'))!.title)).toBe(true);

    // 3. Decrypt all
    setSessionKey(key);
    await decryptAllExistingData(db);

    // 4. Back to plaintext
    const note = await db.notes.get('n1');
    expect(note!.title).toBe('Cycle Test');
    expect(isEncryptedEnvelope(note!.title)).toBe(false);
  });
});
