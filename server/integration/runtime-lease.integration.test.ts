import { afterEach, describe, expect, it, vi } from 'vitest';
import { scratchDatabase, testDatabaseUrl, type ScratchDatabase } from './database.js';
import { acquireRuntimeLease, assertServerStopped } from '../src/services/runtime-lease.js';

testDatabaseUrl(process.env.TEST_DATABASE_URL);
describe('single-instance runtime lease', () => {
  let database: ScratchDatabase | undefined;
  const releases: Array<() => Promise<void>> = [];
  afterEach(async () => { for (const release of releases.splice(0)) await release(); await database?.close(); });
  it('excludes a second runtime and offline rotation until the first runtime releases its lease', async () => {
    database = await scratchDatabase();
    const lost = vi.fn();
    const first = await acquireRuntimeLease(database.url.toString(), lost);
    releases.push(first);
    await expect(acquireRuntimeLease(database.url.toString(), lost)).rejects.toThrow('only one instance');
    await expect(database.sql.begin(tx => assertServerStopped(tx))).rejects.toThrow('server instance is running');
    await first(); releases.shift();
    await expect(database.sql.begin(tx => assertServerStopped(tx))).resolves.toBeUndefined();
    releases.push(await acquireRuntimeLease(database.url.toString(), lost));
    expect(lost).not.toHaveBeenCalled();
  });
  it('notifies the owner when its dedicated lease connection is lost', async () => {
    database = await scratchDatabase();
    const lost = vi.fn();
    releases.push(await acquireRuntimeLease(database.url.toString(), lost));
    await database.sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${database.name} AND pid <> pg_backend_pid()`;
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1), { timeout: 5000 });
  });
});
