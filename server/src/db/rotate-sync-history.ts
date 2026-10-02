import type { Sql } from 'postgres';
import { assertServerStopped } from '../services/runtime-lease.js';

/** Run after restoring a database, before accepting clients. The token is not
 * a secret; it distinguishes histories even if restored cursors are equal or
 * numerically newer. No log, revision, entity or membership is removed. */
export async function rotateSyncHistory(sql: Sql, confirmed: boolean): Promise<string> {
  if (!confirmed) throw new Error('Confirm the backed-up database restore before rotating sync history.');
  return sql.begin(async tx => {
    await assertServerStopped(tx);
    const rows = await tx<{ generation: string }[]>`
      UPDATE sync_clock SET generation = gen_random_uuid()::text WHERE id = 1 RETURNING generation`;
    if (rows.length !== 1) throw new Error('Sync clock is missing; history was not rotated.');
    return rows[0].generation;
  });
}
