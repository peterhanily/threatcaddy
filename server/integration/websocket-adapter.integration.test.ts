import { once } from 'node:events';
import { hash } from 'argon2';
import { expect, it } from 'vitest';
import { scratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';
import { bootBuiltServer, stageBuiltServer } from './startup.js';

const event = (socket: WebSocket, name: string) => once(socket, name, { signal: AbortSignal.timeout(5_000) });
async function message(socket: WebSocket) {
  const [received] = await event(socket, 'message');
  return JSON.parse(received.data);
}

it('packaged HTTP/WebSocket adapters authenticate, subscribe, deliver committed sync and revoke live sessions', async () => {
  const database = await scratchDatabase();
  let artifact: Awaited<ReturnType<typeof stageBuiltServer>> | undefined;
  try {
    await applyCurrentMigrations(database);
    const password = 'Synthetic-websocket-password';
    const passwordHash = await hash(password);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('ws-writer','writer@example.test','Writer',${passwordHash},'analyst'),
      ('ws-reader','reader@example.test','Reader',${passwordHash},'viewer')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES ('ws-folder','WebSocket fixture',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
      ('ws-writer-member','ws-folder','ws-writer','owner'),
      ('ws-reader-member','ws-folder','ws-reader','viewer')`;
    artifact = await stageBuiltServer();
    await bootBuiltServer(database, artifact, async ({ apiUrl }) => {
      const sockets: WebSocket[] = [];
      const connect = async () => {
        const socket = new WebSocket(apiUrl.replace('http:', 'ws:') + '/ws');
        sockets.push(socket);
        await event(socket, 'open');
        return socket;
      };
      const post = (path: string, body: unknown, token?: string) => fetch(apiUrl + path, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5_000),
      });
      try {
        const rejected = await connect();
        const rejection = event(rejected, 'close');
        rejected.send(JSON.stringify({ type: 'subscribe', folderId: 'ws-folder' }));
        expect((await rejection)[0].code).toBe(4001);

        const login = async (email: string) => {
          const response = await post('/api/auth/login', { email, password });
          expect(response.status).toBe(200);
          return (await response.json()).accessToken as string;
        };
        const writerToken = await login('writer@example.test');
        const readerToken = await login('reader@example.test');
        const socket = await connect();
        const authenticated = message(socket);
        socket.send(JSON.stringify({ type: 'auth', token: readerToken }));
        expect(await authenticated).toEqual({ type: 'auth-ok' });
        const denied = message(socket);
        socket.send(JSON.stringify({ type: 'subscribe', folderId: 'unrelated-folder' }));
        expect(await denied).toMatchObject({ type: 'error', message: 'No access to this investigation' });
        const subscribed = message(socket);
        socket.send(JSON.stringify({ type: 'subscribe', folderId: 'ws-folder' }));
        expect(await subscribed).toMatchObject({ type: 'presence', folderId: 'ws-folder' });

        const pull = await fetch(apiUrl + '/api/sync/pull?cursor=0', { headers: { authorization: `Bearer ${writerToken}` } });
        expect(pull.status).toBe(200);
        const { generation } = await pull.json();
        const broadcast = message(socket);
        const pushed = await post('/api/sync/push', { generation, changes: [{ table: 'notes', op: 'put',
          entityId: 'ws-note', clientVersion: 0, data: { title: 'Committed note', content: 'Synthetic fixture', folderId: 'ws-folder' } }] }, writerToken);
        expect(pushed.status).toBe(200);
        expect((await pushed.json()).results[0]).toMatchObject({ status: 'accepted', serverVersion: 1 });
        expect(await broadcast).toMatchObject({ type: 'entity-change', entityId: 'ws-note', updatedBy: 'ws-writer',
          data: { title: 'Committed note', folderId: 'ws-folder', version: 1 } });
        expect(await database.sql`SELECT id FROM notes`).toEqual([{ id: 'ws-note' }]);

        await database.sql`UPDATE users SET active=false WHERE id='ws-reader'`;
        const revoked = event(socket, 'close');
        socket.send(JSON.stringify({ type: 'subscribe', folderId: 'ws-folder' }));
        expect((await revoked)[0].code).toBe(4001);
      } finally {
        await Promise.all(sockets.filter(socket => socket.readyState !== WebSocket.CLOSED).map(async socket => {
          const closed = event(socket, 'close');
          socket.close();
          await closed;
        }));
      }
    });
  } finally {
    await artifact?.close();
    await database.close();
  }
});
