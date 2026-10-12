import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { scratchDatabase, testDatabaseUrl } from './database.js';

describe('disposable PostgreSQL cleanup boundaries', () => {
  it('drops only its generated database, supports concurrent close and leaves the coordinator intact', async () => {
    const database = await scratchDatabase();
    const coordinator = postgres(testDatabaseUrl(process.env.TEST_DATABASE_URL).toString(), { max: 1, onnotice: () => {} });
    try {
      await Promise.all([database.close(), database.close()]);
      await database.close();
      expect(await coordinator`SELECT datname FROM pg_database WHERE datname=${database.name}`).toEqual([]);
      expect((await coordinator`SELECT current_database() AS name`)[0].name)
        .toBe(testDatabaseUrl(process.env.TEST_DATABASE_URL).pathname.slice(1));
    } finally { try { await database.close(); } finally { await coordinator.end({ timeout: 5 }); } }
  });

  it('does not terminate a leaked ordinary client and permits cleanup retry after that client closes', async () => {
    const database = await scratchDatabase();
    const extraClient = postgres(database.url.toString(), { max: 1, idle_timeout: 0, max_lifetime: null, onnotice: () => {} });
    const coordinator = postgres(testDatabaseUrl(process.env.TEST_DATABASE_URL).toString(), { max: 1, onnotice: () => {} });
    try {
      const originalPid = (await extraClient`SELECT pg_backend_pid() AS pid`)[0].pid;
      await expect(database.close()).rejects.toMatchObject({ code: '55006' });
      // Same live session, not a driver reconnection after a forced termination.
      expect((await extraClient`SELECT pg_backend_pid() AS pid`)[0].pid).toBe(originalPid);
      expect(await coordinator`SELECT datname FROM pg_database WHERE datname=${database.name}`).toHaveLength(1);
      await extraClient.end({ timeout: 5 });
      await Promise.all([database.close(), database.close()]);
      expect(await coordinator`SELECT datname FROM pg_database WHERE datname=${database.name}`).toEqual([]);
    } finally {
      try { await extraClient.end({ timeout: 5 }); }
      finally { try { await database.close(); } finally { await coordinator.end({ timeout: 5 }); } }
    }
  });
});
