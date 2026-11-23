import { db } from '../db';
import { deleteEntitiesWithReferences } from './entity-relations';
import { distinctConnections, mergeIdentityRows, retarget } from './identity-merge';
import { holdSyncUntilAccepted } from './sync-state';

/**
 * Merges `goneId` into `keepId` in one transaction: the kept identity gains everything of the other
 * (identity-merge.ts), identities connected to the other are reconnected to it, and the other is
 * deleted with its references and checkpoints. Over sync, the delete and the reconnections wait until
 * the kept identity's change is accepted; their copies let "Keep theirs" on it cancel the merge.
 */
export async function mergeIdentities(keepId: string, goneId: string): Promise<void> {
  if (keepId === goneId) throw new Error('Choose two different identities to merge.');
  await deleteEntitiesWithReferences({ identities: [goneId] }, undefined, undefined, undefined, undefined, async () => {
    const [keep, gone] = await db.identities.bulkGet([keepId, goneId]);
    if (!keep || !gone) throw new Error('Identity not found; nothing was merged.');
    if (keep.folderId !== gone.folderId) throw new Error('Only identities in the same investigation can be merged.');
    const now = Date.now();
    const pointing = (await db.identities.toArray())
      .filter(row => row.id !== keepId && row.id !== goneId && row.connections.some(edge => edge.targetId === goneId));
    holdSyncUntilAccepted('identities', keepId, new Map<string, unknown>([
      [goneId, gone], ...pointing.map(row => [row.id, { connections: row.connections, mergedFrom: goneId }] as const),
    ]));
    await db.identities.bulkPut([mergeIdentityRows(keep, gone, now),
      ...pointing.map(row => ({ ...row, connections: distinctConnections(retarget(row.connections, goneId, keepId), row.id), updatedAt: now }))]);
  });
}
