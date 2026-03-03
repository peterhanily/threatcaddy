import type { WSContext } from 'hono/ws';
import { verifyAccessToken } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { updatePresence, removePresence, removeUserFromAllFolders, getPresence } from './presence.js';
import { logger } from '../lib/logger.js';
import type { AuthUser } from '../types.js';

const MAX_WS_MESSAGE_SIZE = 64 * 1024; // 64 KB

interface ConnectedClient {
  ws: WSContext;
  user: AuthUser;
  subscribedFolders: Set<string>;
  alive: boolean;
  pingTimer: ReturnType<typeof setInterval>;
}

const clients = new Map<WSContext, ConnectedClient>();
// userId → Set<WSContext> for per-user broadcasting
const userConnections = new Map<string, Set<WSContext>>();

export function handleWSConnection(ws: WSContext, token: string) {
  // Auth happens asynchronously
  verifyAccessToken(token)
    .then((user) => {
      const client: ConnectedClient = {
        ws,
        user,
        subscribedFolders: new Set(),
        alive: true,
        pingTimer: null as unknown as ReturnType<typeof setInterval>,
      };

      client.pingTimer = setInterval(() => {
        if (!client.alive) {
          clearInterval(client.pingTimer);
          try { ws.close(4002, 'Ping timeout'); } catch { /* noop */ }
          return;
        }
        client.alive = false;
        sendTo(ws, { type: 'ping' });
      }, 25_000);

      clients.set(ws, client);

      // Track user connections
      let conns = userConnections.get(user.id);
      if (!conns) {
        conns = new Set();
        userConnections.set(user.id, conns);
      }
      conns.add(ws);
    })
    .catch(() => {
      try { ws.close(4001, 'Authentication failed'); } catch { /* noop */ }
    });
}

export async function handleWSMessage(ws: WSContext, data: string) {
  if (data.length > MAX_WS_MESSAGE_SIZE) return; // Drop oversized messages

  const client = clients.get(ws);
  if (!client) return;

  try {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'pong': {
        client.alive = true;
        break;
      }

      case 'subscribe': {
        const folderId = msg.folderId as string;
        if (folderId) {
          // Verify folder access before subscribing
          if (client.user.role !== 'admin') {
            const hasAccess = await checkInvestigationAccess(client.user.id, folderId, 'viewer');
            if (!hasAccess) {
              sendTo(ws, { type: 'error', message: 'No access to this investigation' });
              break;
            }
          }
          client.subscribedFolders.add(folderId);
          // Send current presence
          const presence = getPresence(folderId);
          sendTo(ws, { type: 'presence', folderId, users: presence });
        }
        break;
      }

      case 'unsubscribe': {
        const folderId = msg.folderId as string;
        if (folderId) {
          client.subscribedFolders.delete(folderId);
          removePresence(folderId, client.user.id);
          // Broadcast updated presence
          broadcastPresence(folderId);
        }
        break;
      }

      case 'presence-update': {
        const folderId = msg.folderId as string;
        // Only allow presence updates for folders the client is subscribed to
        if (folderId && client.subscribedFolders.has(folderId)) {
          updatePresence(
            folderId,
            client.user.id,
            client.user.displayName,
            client.user.avatarUrl,
            msg.view as string || 'unknown',
            msg.entityId as string | undefined
          );
          broadcastPresence(folderId);
        }
        break;
      }
    }
  } catch (err) {
    logger.error('WS message parse error', { error: String(err) });
  }
}

export function handleWSClose(ws: WSContext) {
  const client = clients.get(ws);
  if (client) {
    clearInterval(client.pingTimer);

    // Remove from all subscribed folders' presence
    removeUserFromAllFolders(client.user.id);

    // Broadcast updated presence for all folders this client was in
    for (const folderId of client.subscribedFolders) {
      broadcastPresence(folderId);
    }

    // Remove from user connections
    const conns = userConnections.get(client.user.id);
    if (conns) {
      conns.delete(ws);
      if (conns.size === 0) userConnections.delete(client.user.id);
    }

    clients.delete(ws);
  }
}

function sendTo(ws: WSContext, msg: unknown) {
  try {
    ws.send(JSON.stringify(msg));
  } catch { /* client disconnected */ }
}

function broadcastPresence(folderId: string) {
  const presence = getPresence(folderId);
  const msg = { type: 'presence', folderId, users: presence };

  for (const [, client] of clients) {
    if (client.subscribedFolders.has(folderId)) {
      sendTo(client.ws, msg);
    }
  }
}

// Broadcast entity changes to all clients subscribed to a folder (except sender)
export function broadcastToFolder(folderId: string, msg: unknown, excludeUserId?: string) {
  for (const [, client] of clients) {
    if (client.subscribedFolders.has(folderId) && client.user.id !== excludeUserId) {
      sendTo(client.ws, msg);
    }
  }
}

// Broadcast to all connected clients
export function broadcastGlobal(msg: unknown, excludeUserId?: string) {
  for (const [, client] of clients) {
    if (client.user.id !== excludeUserId) {
      sendTo(client.ws, msg);
    }
  }
}

// Broadcast to a specific user (all their connections)
export function broadcastToUser(userId: string, msg: unknown) {
  const conns = userConnections.get(userId);
  if (conns) {
    for (const ws of conns) {
      sendTo(ws, msg);
    }
  }
}
