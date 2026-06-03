/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../db';
import type { Note } from '../types';

// ─────────────────────────────────────────────────────────────────────
// Regression coverage for the live v29→v32 evidence migration in db.ts.
//
// The whole chain MUST be non-destructive: no analyst-authored note may be
// deleted by the upgrade. We prove this by:
//   1. Closing the real Dexie `db` singleton and deleting ThreatCaddyDB.
//   2. Recreating the DB at the PRE-evidence schema (version 28) via raw
//      indexedDB.open(name, 28) — evidenceItems does NOT exist at v28.
//   3. Seeding `notes` rows directly.
//   4. Re-opening the real `db` (it declares version 32), which forces Dexie
//      to run the v29→v32 upgrade against our seeded v28 database — this
//      exercises the actual production migration code, not a copy.
//   5. Inspecting results via db.notes / db.evidenceItems.
// ─────────────────────────────────────────────────────────────────────

const DB_NAME = 'ThreatCaddyDB';

// The object stores that existed at schema version 28 (right before v29 added
// evidenceItems). Compiled by accumulating every .stores() call from v1..v28
// in db.ts. evidenceItems is intentionally absent here.
const V28_STORES = [
  'notes',
  'tasks',
  'folders',
  'tags',
  'timelineEvents',
  'timelines',
  'whiteboards',
  'activityLog',
  'standaloneIOCs',
  'chatThreads',
  '_syncQueue',
  '_syncMeta',
  'noteTemplates',
  'playbookTemplates',
  'integrationTemplates',
  'installedIntegrations',
  'integrationRuns',
  'checkpoints',
  'customSlashCommands',
  'agentActions',
  'agentProfiles',
  'agentDeployments',
  'agentMeetings',
] as const;

// ── Raw IDB helpers (bypass Dexie) ──────────────────────────────────

function rawDeleteDB(name: string): Promise<'deleted' | 'blocked'> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve('deleted');
    req.onerror = () => resolve('deleted');
    // onblocked means a live connection is still open; surface it so the caller
    // can wait and retry rather than proceeding against a half-deleted DB.
    req.onblocked = () => resolve('blocked');
  });
}

/**
 * Fully tear down ThreatCaddyDB: close the Dexie connection and delete the
 * underlying database, retrying while a stale connection keeps it blocked.
 * Resolving early on `onblocked` was the source of cross-test flakiness, so we
 * loop until the deletion genuinely succeeds.
 */
async function resetDatabase(): Promise<void> {
  db.close();
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await rawDeleteDB(DB_NAME);
    if (result === 'deleted') return;
    db.close();
    await new Promise((r) => setTimeout(r, 5));
  }
}

// Dexie encodes schema version N as raw IndexedDB version N*10, and records the
// current schema version in a special '$meta' object store (out-of-line key
// 'version'). To make the production `db` (declared at schema v32) run exactly
// the v29→v32 upgrade chain against our seeded DB, we must create the raw DB at
// IDB version 280 AND write $meta.version = 28 — otherwise Dexie can't tell
// which schema version it's upgrading from and skips the migration entirely.
const SCHEMA_VERSION_V28 = 28;
const IDB_VERSION_V28 = SCHEMA_VERSION_V28 * 10;

/**
 * Create ThreatCaddyDB at Dexie schema version 28 (raw IDB version 280) with the
 * v28 store list + $meta marker, and seed the provided notes. keyPath 'id'
 * matches Dexie's primary key for notes.
 */
function createV28DB(notes: Partial<Note>[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, IDB_VERSION_V28);
    req.onupgradeneeded = () => {
      const raw = req.result;
      for (const store of V28_STORES) {
        if (!raw.objectStoreNames.contains(store)) {
          if (store === '_syncQueue') {
            raw.createObjectStore(store, { keyPath: 'seq', autoIncrement: true });
          } else if (store === '_syncMeta') {
            raw.createObjectStore(store, { keyPath: 'key' });
          } else {
            raw.createObjectStore(store, { keyPath: 'id' });
          }
        }
      }
      // Dexie's version marker so its upgrade machinery sees oldVersion = 28.
      if (!raw.objectStoreNames.contains('$meta')) {
        const meta = raw.createObjectStore('$meta');
        meta.add(SCHEMA_VERSION_V28, 'version');
      }
    };
    req.onsuccess = () => {
      const raw = req.result;
      const tx = raw.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      for (const note of notes) store.put(note);
      tx.oncomplete = () => {
        raw.close();
        resolve();
      };
      tx.onerror = () => {
        raw.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Re-open the real `db` singleton. Dexie sees the on-disk DB at v28 and
 * runs the declared v29→v32 upgrade chain (the production migration).
 */
async function runMigration(): Promise<void> {
  await db.open();
}

function makeNote(overrides: Partial<Note> & { id: string }): Partial<Note> {
  return {
    title: 'Note',
    content: '',
    tags: [],
    pinned: false,
    archived: false,
    trashed: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ── Setup / teardown: clean DB per test ─────────────────────────────

beforeEach(async () => {
  // The real `db` was opened at v32 on import. Close it and wipe the database
  // so each test can recreate the v28 state from scratch.
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('v29→v32 evidence migration (non-destructive)', () => {
  it('Case 1: promotes a true legacy evidence note AND keeps the source note', async () => {
    await createV28DB([
      makeNote({
        id: 'ev-true',
        title: 'Evidence - report.pdf',
        content: '# Evidence: report.pdf\n\n**File type:** PDF\n\n## Extracted Text\n\nThreat actor analysis.',
        tags: ['evidence', 'source:file'],
      }),
    ]);

    await runMigration();

    // Promoted into evidenceItems, reusing the note id.
    const item = await db.evidenceItems.get('ev-true');
    expect(item).toBeDefined();
    expect(item!.id).toBe('ev-true');
    expect(item!.fileName).toBe('report.pdf');
    expect(item!.fileType).toBe('pdf');

    // NON-DESTRUCTIVE: the original analyst note still exists.
    const note = await db.notes.get('ev-true');
    expect(note).toBeDefined();
    expect(note!.id).toBe('ev-true');
  });

  it('Case 2a: an ordinary note tagged [evidence] + extraction:partial (no file provenance) is NOT lost', async () => {
    // The v29 predicate promotes this (extraction: tag present) even though it
    // is really an analyst note. The full chain must still preserve it in notes.
    await createV28DB([
      makeNote({
        id: 'analyst-extraction',
        title: 'Suspicious behaviour writeup',
        content: 'My analysis of the partial extraction situation.',
        tags: ['evidence', 'extraction:partial'],
      }),
    ]);

    await runMigration();

    const note = await db.notes.get('analyst-extraction');
    expect(note, 'analyst note tagged [evidence, extraction:partial] must survive').toBeDefined();
    expect(note!.id).toBe('analyst-extraction');
  });

  it('Case 2b: a note tagged [evidence] alone is untouched (not promoted, not lost)', async () => {
    // [evidence] alone does NOT satisfy the v29 predicate (needs source:file OR
    // extraction:*), so it must never enter evidenceItems and must survive.
    await createV28DB([
      makeNote({
        id: 'evidence-only',
        title: 'Working theory',
        content: 'Just an analyst note that happens to be tagged evidence.',
        tags: ['evidence'],
      }),
    ]);

    await runMigration();

    const note = await db.notes.get('evidence-only');
    expect(note, 'note tagged [evidence] alone must survive').toBeDefined();

    const item = await db.evidenceItems.get('evidence-only');
    expect(item, 'note tagged [evidence] alone must NOT be promoted').toBeUndefined();
  });

  it('Case 3: multipart evidence promotes both parts and keeps both source notes', async () => {
    await createV28DB([
      makeNote({
        id: 'ev-part-1',
        title: 'Evidence - bigdump.pdf (1 of 2)',
        content: '# Evidence: bigdump.pdf\n\n**Part:** 1 of 2\n\n## Extracted Text\n\nFirst half.',
        tags: ['evidence', 'source:file'],
      }),
      makeNote({
        id: 'ev-part-2',
        title: 'Evidence - bigdump.pdf (2 of 2)',
        content: '# Evidence: bigdump.pdf\n\n**Part:** 2 of 2\n\n## Extracted Text\n\nSecond half.',
        tags: ['evidence', 'source:file'],
      }),
    ]);

    await runMigration();

    // Both parts are promoted (each keeps its own note id as the item id).
    const item1 = await db.evidenceItems.get('ev-part-1');
    const item2 = await db.evidenceItems.get('ev-part-2');
    expect(item1).toBeDefined();
    expect(item2).toBeDefined();
    expect(item1!.fileName).toBe('bigdump.pdf');
    expect(item2!.fileName).toBe('bigdump.pdf');
    expect(item1!.fileType).toBe('pdf');

    // NOTE on chunk metadata: v29 parses "**Part:** N of M" into
    // chunkIndex/chunkCount, but the v30/v31 cleanup
    // (combineEvidenceIntoItems → evidenceGroupToItem) re-emits each item with
    // chunkIndex/chunkCount reset to 1. The two parts are NOT merged because
    // their group key falls back to including the distinct note id (size=0, no
    // lastModified). So the observable end-of-chain state is two items, each
    // 1-of-1. We assert the actual production behavior here.
    expect(item1!.chunkIndex).toBe(1);
    expect(item1!.chunkCount).toBe(1);
    expect(item2!.chunkIndex).toBe(1);
    expect(item2!.chunkCount).toBe(1);

    // NON-DESTRUCTIVE (the invariant that matters): both source notes survive.
    expect(await db.notes.get('ev-part-1')).toBeDefined();
    expect(await db.notes.get('ev-part-2')).toBeDefined();
  });

  it('Case 4: a plain note with no evidence tags is untouched', async () => {
    await createV28DB([
      makeNote({
        id: 'plain',
        title: 'Daily standup notes',
        content: 'Nothing to do with evidence.',
        tags: ['notes', 'standup'],
      }),
    ]);

    await runMigration();

    const note = await db.notes.get('plain');
    expect(note).toBeDefined();
    expect(note!.title).toBe('Daily standup notes');

    expect(await db.evidenceItems.get('plain')).toBeUndefined();
    expect(await db.evidenceItems.count()).toBe(0);
  });

  it('Case 5: re-running the upgrade is idempotent (no duplication, no deletion)', async () => {
    await createV28DB([
      makeNote({
        id: 'ev-true',
        title: 'Evidence - report.pdf',
        content: '# Evidence: report.pdf\n\n**File type:** PDF\n\n## Extracted Text\n\nBody.',
        tags: ['evidence', 'source:file'],
      }),
      makeNote({
        id: 'analyst-extraction',
        title: 'Analyst writeup',
        content: 'Analyst content.',
        tags: ['evidence', 'extraction:partial'],
      }),
    ]);

    await runMigration();

    const notesAfterFirst = (await db.notes.toArray()).map((n) => n.id).sort();
    const itemsAfterFirst = (await db.evidenceItems.toArray()).map((i) => i.id).sort();

    // Close and re-open the already-migrated (v32) DB. Dexie runs no upgrade
    // (verno unchanged), but this is the closest in-test analogue to a reload;
    // assert nothing changed.
    db.close();
    await db.open();

    const notesAfterSecond = (await db.notes.toArray()).map((n) => n.id).sort();
    const itemsAfterSecond = (await db.evidenceItems.toArray()).map((i) => i.id).sort();

    expect(notesAfterSecond).toEqual(notesAfterFirst);
    expect(itemsAfterSecond).toEqual(itemsAfterFirst);

    // Both seeded notes survive — no dupes, no losses.
    expect(notesAfterSecond).toEqual(['analyst-extraction', 'ev-true']);
    // Both match the v29 promotion predicate (source:file / extraction:*), so
    // both also exist as evidenceItems reusing the note id. The point of this
    // case is that the SECOND open neither duplicated nor deleted anything.
    expect(itemsAfterSecond).toEqual(['analyst-extraction', 'ev-true']);
  });

  it('reaches schema version 32 after the upgrade', async () => {
    await createV28DB([makeNote({ id: 'plain', tags: [] })]);
    await runMigration();
    expect(db.verno).toBe(32);
  });

  it('full chain: a realistic mix survives — every seeded note is still present', async () => {
    const seeded: Partial<Note>[] = [
      makeNote({
        id: 'a',
        title: 'Evidence - a.pdf',
        content: '# Evidence: a.pdf\n\n## Extracted Text\n\ntext',
        tags: ['evidence', 'source:file'],
      }),
      makeNote({ id: 'b', title: 'Analyst note', content: 'analysis', tags: ['evidence', 'extraction:partial'] }),
      makeNote({ id: 'c', title: 'Tagged evidence only', content: 'x', tags: ['evidence'] }),
      makeNote({ id: 'd', title: 'Totally plain', content: 'x', tags: [] }),
    ];
    await createV28DB(seeded);

    await runMigration();

    const survivingIds = (await db.notes.toArray()).map((n) => n.id).sort();
    // The audit's core invariant: the upgrade deletes NO analyst note.
    expect(survivingIds).toEqual(['a', 'b', 'c', 'd']);
  });
});
