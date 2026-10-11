import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { WSContext } from 'hono/ws';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';

const state = vi.hoisted(() => ({ db: undefined as unknown, forbidGlobalQueries: false }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  if (state.forbidGlobalQueries && property === 'select') throw new Error('Unexpected query outside the recipient transaction');
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));

import { createTokenPair } from '../src/services/session-service.js';
import { broadcastToUser, handleWSConnection, handleWSMessage, handleWSClose } from '../src/ws/handler.js';

describe('scoped websocket notification delivery in PostgreSQL', () => {
  let database: ScratchDatabase;
  const sockets: WSContext[] = [];
  beforeAll(() => {
    const keys = generateKeyPairSync('ed25519');
    process.env.JWT_PRIVATE_KEY = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    process.env.JWT_PUBLIC_KEY = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  });
  beforeEach(async () => {
    state.forbidGlobalQueries = false;
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role)
      VALUES ('recipient','recipient@example.invalid','Fictional recipient','fixture','viewer')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at)
      VALUES ('case-a','Fictional A',now(),now()),('case-b','Fictional B',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role)
      VALUES ('member-a','case-a','recipient','viewer'),('member-b','case-b','recipient','viewer')`;
  });
  afterEach(async () => {
    state.forbidGlobalQueries = false;
    for (const socket of sockets.splice(0)) handleWSClose(socket);
    await database?.close();
  });
  async function socketFor() {
    const token = (await createTokenPair('recipient')).accessToken;
    const socket = { send: vi.fn(), close: vi.fn(), readyState: 1 } as unknown as WSContext;
    sockets.push(socket);
    handleWSConnection(socket);
    await handleWSMessage(socket, JSON.stringify({ type: 'auth', token }));
    expect(vi.mocked(socket.send).mock.calls.map(([message]) => JSON.parse(String(message)).type)).toContain('auth-ok');
    vi.mocked(socket.send).mockClear();
    // Deliberately no investigation subscription: direct notifications should
    // still arrive while the actual membership/session remains authorized.
    return socket;
  }
  const message = { type: 'notification', notification: { message: 'Fictional scoped notification' } };
  const delivered = (socket: WSContext) => vi.mocked(socket.send).mock.calls.some(([value]) => String(value) === JSON.stringify(message));
  async function waitForLock(table: 'sync_clock' | 'users') {
    await vi.waitFor(async () => {
      const waiting = await database.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query ILIKE ${`%${table}%`} AND query ILIKE '%FOR SHARE%'`;
      expect(waiting.length).toBeGreaterThan(0);
    }, { timeout: 5000, interval: 20 });
  }

  it('delivers to an authorized unsubscribed recipient and checks every effective scope', async () => {
    const socket = await socketFor();
    await broadcastToUser('recipient', message, ['case-a', 'case-b']);
    expect(delivered(socket)).toBe(true);
    vi.mocked(socket.send).mockClear();
    await database.sql`DELETE FROM investigation_members WHERE id='member-b'`;
    await broadcastToUser('recipient', message, ['case-a', 'case-b']);
    expect(delivered(socket)).toBe(false);
  });

  it.each(['membership', 'soft-delete'])('does not send after a queued %s commits before its policy lock', async change => {
    const socket = await socketFor();
    let pending: Promise<void> | undefined;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      pending = broadcastToUser('recipient', message, ['case-a']);
      await waitForLock('sync_clock');
      if (change === 'membership') await tx`DELETE FROM investigation_members WHERE id='member-a'`;
      else await tx`UPDATE folders SET deleted_at=now() WHERE id='case-a'`;
    });
    await pending;
    expect(delivered(socket)).toBe(false);
  });

  it.each(['session', 'account'])('rechecks a queued %s revocation under the recipient row lock', async change => {
    const socket = await socketFor();
    let pending: Promise<void> | undefined;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM users WHERE id='recipient' FOR UPDATE`;
      pending = broadcastToUser('recipient', message, ['case-a']);
      await waitForLock('users');
      if (change === 'session') await tx`DELETE FROM sessions WHERE user_id='recipient'`;
      else await tx`UPDATE users SET active=false WHERE id='recipient'`;
    });
    await pending;
    expect(delivered(socket)).toBe(false);
    expect(socket.close).toHaveBeenCalled();
  });

  it('uses each transaction connection for token and membership checks with a full recipient pool', async () => {
    for (let index = 0; index < 4; index++) await socketFor();
    state.forbidGlobalQueries = true;
    await broadcastToUser('recipient', message, ['case-a']);
    expect(sockets.map(delivered)).toEqual([true, true, true, true]);
  });

  it('does not revive a closed connection while delivery waits for authorization', async () => {
    const socket = await socketFor();
    let pending: Promise<void> | undefined;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      pending = broadcastToUser('recipient', message, ['case-a']);
      await waitForLock('sync_clock');
      handleWSClose(socket);
    });
    await pending;
    expect(delivered(socket)).toBe(false);
  });

  it('fails scoped delivery closed without a clock and leaves ordinary unscoped delivery unchanged', async () => {
    const socket = await socketFor();
    await database.sql`DELETE FROM investigation_members WHERE user_id='recipient'`;
    await broadcastToUser('recipient', message);
    expect(delivered(socket)).toBe(true);
    vi.mocked(socket.send).mockClear();
    await database.sql`DELETE FROM sync_clock WHERE id=1`;
    await broadcastToUser('recipient', message, ['case-a']);
    expect(delivered(socket)).toBe(false);
  });
});
