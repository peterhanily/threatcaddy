import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

/** The supplied database is a coordinator; application SQL runs only in new scratch databases. */
export function testDatabaseUrl(value: string | undefined): URL {
  if (!value) throw new Error('TEST_DATABASE_URL is required; no application DATABASE_URL or .env fallback is permitted.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/threatcaddy_test(?:_[a-z0-9_]+)?$/.test(url.pathname)
    || url.search || url.hash) {
    throw new Error('TEST_DATABASE_URL must use a loopback host and database threatcaddy_test or threatcaddy_test_<suffix>, without query options or fragments.');
  }
  return url;
}

function connect(url: URL, max = 1) {
  return postgres(url.toString(), { max, connect_timeout: 5, idle_timeout: 2, onnotice: () => {} });
}

export type TestSql = ReturnType<typeof connect>;
export interface ScratchDatabase {
  name: string;
  url: URL;
  sql: TestSql;
  db: ReturnType<typeof drizzle>;
  close(): Promise<void>;
}

export async function scratchDatabase(options: { maxConnections?: number } = {}): Promise<ScratchDatabase> {
  const maxConnections = options.maxConnections ?? 1;
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 8) throw new Error('Scratch database pool must have 1–8 connections.');
  const coordinatorUrl = testDatabaseUrl(process.env.TEST_DATABASE_URL);
  const coordinator = connect(coordinatorUrl);
  const name = `tc_it_${process.pid}_${randomBytes(10).toString('hex')}`;
  let created = false;
  let client: TestSql | undefined;
  try {
    const [identity] = await coordinator`SELECT current_database() AS name`;
    if (identity.name !== coordinatorUrl.pathname.slice(1)) throw new Error('Test coordinator database identity did not match TEST_DATABASE_URL.');
    await coordinator`CREATE DATABASE ${coordinator(name)} TEMPLATE template0`;
    created = true;
    const url = new URL(coordinatorUrl);
    url.pathname = `/${name}`;
    client = connect(url, maxConnections);
    const [scratchIdentity] = await client`SELECT current_database() AS name`;
    if (scratchIdentity.name !== name) throw new Error('Scratch database identity mismatch.');
    let closed = false;
    return {
      name, url, sql: client, db: drizzle(client),
      async close() {
        if (closed) return;
        closed = true;
        try { await client!.end({ timeout: 5 }); }
        finally {
          // This identifier is generated above, never obtained from an environment variable or database row.
          try { await coordinator`DROP DATABASE ${coordinator(name)} WITH (FORCE)`; }
          finally { await coordinator.end({ timeout: 5 }); }
        }
      },
    };
  } catch (error) {
    try {
      try { if (client) await client.end({ timeout: 5 }); }
      finally { if (created) await coordinator`DROP DATABASE ${coordinator(name)} WITH (FORCE)`; }
    } finally { await coordinator.end({ timeout: 5 }); }
    throw error;
  }
}
