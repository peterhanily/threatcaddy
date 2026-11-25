/** A Replace restore that removes rows takes their AI undo copies and ignored names with them, as
 * deleting them does (found by the F8 re-audit). */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { BackupPayload } from '../lib/backup-crypto';
import { BACKUP_TABLES } from '../lib/backup-tables';
import { restoreFullReplace } from '../lib/backup-restore';
import type { Identity } from '../types';

const dana: Identity = { id: 'dana', folderId: 'A', type: 'person', name: 'Dana Okafor', aliases: [], tags: [], connections: [],
  details: [{ id: 'd1', label: 'Mobile', value: '+44 7700 900123', private: true }], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };

beforeEach(async () => {
  await db.transaction('rw', [...BACKUP_TABLES.map(name => db.table(name)), db.checkpoints], async () => {
    for (const name of BACKUP_TABLES) await db.table(name).clear();
    await db.checkpoints.clear();
  });
});

describe('a Replace restore that removes an identity', () => {
  it('deletes the AI undo checkpoint holding its private details', async () => {
    await db.folders.add({ id: 'A', name: 'A', order: 0, createdAt: 1 } as never);
    await db.identities.add(dana);
    // As executeCheckpointedTool records an AI update_identity.
    await db.checkpoints.put({ id: 'cp1', threadId: 't1', messageId: 'm1', toolNames: ['update_identity'], restored: false, createdAt: 1,
      snapshot: [{ table: 'identities', entityId: 'dana', data: dana, after: { ...dana, status: 'cleared' }, afterRevision: 0 }] } as never);
    const payload: BackupPayload = { version: 1, type: 'full', scope: 'all', createdAt: 10_000, data: { identities: [] } };
    await restoreFullReplace(payload);
    expect(await db.identities.get('dana')).toBeUndefined();
    expect(JSON.stringify(await db.checkpoints.toArray())).not.toContain('+44 7700 900123');
  });
});
