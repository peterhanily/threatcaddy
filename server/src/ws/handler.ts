import type { WSContext } from 'hono/ws';
import { verifyAccessToken } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { updatePresence, removePresence, removeUserFromAllFolders, getPresence } from './presence.js';
import { logger } from '../lib/logger.js';
import type { AuthUser } from '../types.js';

const MAX_WS_MESSAGE_SIZE = 64 * 1024; // 64 KB
const MAX_CONNECTIONS_PER_USER = 10;
const MSG_RATE_WINDOW_MS = 1000;
const MSG_RATE_MAX = 30; // max 30 messages per second per connection
const USER_MSG_RATE_MAX = 50; // max 50 messages per second per user (across all connections)

interface ConnectedClient {
  ws: WSContext;
  user: AuthUser;
  subscribedFolders: Set<string>;
  alive: boolean;
  pingTimer: ReturnType<typeof setInterval>;
  msgCount: number;
  msgWindowStart: number;
}

const clients = new Map<WSContext, ConnectedClient>();
// userId → Set<WSContext> for per-user broadcasting
const userConnections = new Map<string, Set<WSContext>>();
// folderId → Set<WSContext> for fast folder-scoped broadcasts
const folderSubscribers = new Map<string, Set<WSContext>>();
// Pending auth: ws → timeout timer (connections not yet authenticated)
const pendingAuth = new Map<WSContext, ReturnType<typeof setTimeout>>();
// Per-user message rate limiting (sliding window)
const userMsgCounts = new Map<string, { count: number; windowStart: number }>();

export function handleWSConnection(ws: WSContext) {
  // Give client 5 seconds to send auth message
  const timer = setTimeout(() => {
    pendingAuth.delete(ws);
    try { ws.close(4001, 'Authentication timeout'); } catch { /* noop */ }
  }, 5000);
  pendingAuth.set(ws, timer);
}

function registerClient(ws: WSContext, user: AuthUser): boolean {
  // Enforce per-user connection limit
  const existing = userConnections.get(user.id);
  if (existing && existing.size >= MAX_CONNECTIONS_PER_USER) {
    try { ws.close(4003, 'Too many connections'); } catch { /* noop */ }
    return false;
  }

  const client: ConnectedClient = {
    ws,
    user,
    subscribedFolders: new Set(),
    alive: true,
    pingTimer: null as unknown as ReturnType<typeof setInterval>,
    msgCount: 0,
    msgWindowStart: Date.now(),
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

  let conns = userConnections.get(user.id);
  if (!conns) {
    conns = new Set();
    userConnections.set(user.id, conns);
  }
  conns.add(ws);

  sendTo(ws, { type: 'auth-ok' });
  return true;
}

export async function handleWSMessage(ws: WSContext, data: string) {
  if (data.length > MAX_WS_MESSAGE_SIZE) return;

  // Handle auth for unauthenticated connections
  if (pendingAuth.has(ws)) {
    const timer = pendingAuth.get(ws)!;
    clearTimeout(timer);
    pendingAuth.delete(ws);

    try {
      const msg = JSON.parse(data);
      if (msg.type !== 'auth' || !msg.token) {
        try { ws.close(4001, 'First message must be auth'); } catch { /* noop */ }
        return;
      }
      const user = await verifyAccessToken(msg.token);
      registerClient(ws, user);
    } catch {
      try { ws.close(4001, 'Authentication failed'); } catch { /* noop */ }
    }
    return;
  }

  const client = clients.get(ws);
  if (!client) return;

  // Per-connection rate limiting
  const now = Date.now();
  if (now - client.msgWindowStart > MSG_RATE_WINDOW_MS) {
    client.msgCount = 0;
    client.msgWindowStart = now;
  }
  client.msgCount++;
  if (client.msgCount > MSG_RATE_MAX) {
    return; // Silently drop messages exceeding rate limit
  }

  // Per-user rate limiting (across all connections)
  let userRate = userMsgCounts.get(client.user.id);
  if (!userRate || now - userRate.windowStart > MSG_RATE_WINDOW_MS) {
    userRate = { count: 0, windowStart: now };
    userMsgCounts.set(client.user.id, userRate);
  }
  userRate.count++;
  if (userRate.count > USER_MSG_RATE_MAX) {
    return; // Silently drop
  }

  try {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'pong': {
        client.alive = true;
        break;
      }

      case 'subscribe': {
        const folderId = msg.folderId as string;
        if (folderId && typeof folderId === 'string' && folderId.length < 128) {
          // Verify folder access before subscribing
          const hasAccess = await checkInvestigationAccess(client.user.id, folderId, 'viewer');
          if (!hasAccess) {
            sendTo(ws, { type: 'error', message: 'No access to this investigation' });
            break;
          }
          client.subscribedFolders.add(folderId);
          let subs = folderSubscribers.get(folderId);
          if (!subs) { subs = new Set(); folderSubscribers.set(folderId, subs); }
          subs.add(ws);
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
          const subs = folderSubscribers.get(folderId);
          if (subs) { subs.delete(ws); if (subs.size === 0) folderSubscribers.delete(folderId); }
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
          const view = typeof msg.view === 'string' ? msg.view.slice(0, 64) : 'unknown';
          const entityId = typeof msg.entityId === 'string' ? msg.entityId.slice(0, 128) : undefined;
          updatePresence(
            folderId,
            client.user.id,
            client.user.displayName,
            client.user.avatarUrl,
            view,
            entityId
          );
          broadcastPresence(folderId);
        }
        break;
      }

      case 'entity-change-preview': {
        // Relay as entity-change to other clients for optimistic real-time sync
        const { table, entityId, op, data } = msg as {
          table?: string; entityId?: string; op?: string; data?: Record<string, unknown>;
        };
        if (!table || !entityId || !op) break;
        const relayMsg = { type: 'entity-change', table, entityId, op, data };
        // Determine scope: if data has folderId and client is subscribed, broadcast to folder
        const dataFolderId = data?.folderId as string | undefined;
        if (dataFolderId && client.subscribedFolders.has(dataFolderId)) {
          broadcastToFolder(dataFolderId, relayMsg, client.user.id);
        } else {
          // Global broadcast (e.g. tags, folders themselves)
          broadcastGlobal(relayMsg, client.user.id);
        }
        break;
      }
    }
  } catch (err) {
    logger.error('WS message parse error', { error: String(err) });
  }
}

export function handleWSClose(ws: WSContext) {
  // Clean up pending auth if connection closes before auth
  const authTimer = pendingAuth.get(ws);
  if (authTimer) {
    clearTimeout(authTimer);
    pendingAuth.delete(ws);
  }

  const client = clients.get(ws);
  if (client) {
    clearInterval(client.pingTimer);

    // Remove from all subscribed folders' presence
    removeUserFromAllFolders(client.user.id);

    // Remove from folder subscriber index
    for (const folderId of client.subscribedFolders) {
      const subs = folderSubscribers.get(folderId);
      if (subs) { subs.delete(ws); if (subs.size === 0) folderSubscribers.delete(folderId); }
    }

    // Broadcast updated presence for all folders this client was in
    for (const folderId of client.subscribedFolders) {
      broadcastPresence(folderId);
    }

    // Remove from user connections
    const conns = userConnections.get(client.user.id);
    if (conns) {
      conns.delete(ws);
      if (conns.size === 0) {
        userConnections.delete(client.user.id);
        userMsgCounts.delete(client.user.id);
      }
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
  const subs = folderSubscribers.get(folderId);
  if (!subs) return;
  const presence = getPresence(folderId);
  const msg = { type: 'presence', folderId, users: presence };

  for (const ws of subs) {
    sendTo(ws, msg);
  }
}

// Broadcast entity changes to all clients subscribed to a folder (except sender)
export function broadcastToFolder(folderId: string, msg: unknown, excludeUserId?: string) {
  const subs = folderSubscribers.get(folderId);
  if (!subs) return;
  for (const ws of subs) {
    const client = clients.get(ws);
    if (client && client.user.id !== excludeUserId) {
      sendTo(ws, msg);
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

// Force-unsubscribe a user from a folder (called when member is removed)
export function revokeUserFolderAccess(userId: string, folderId: string) {
  const conns = userConnections.get(userId);
  if (!conns) return;
  for (const ws of conns) {
    const client = clients.get(ws);
    if (client && client.subscribedFolders.has(folderId)) {
      client.subscribedFolders.delete(folderId);
      removePresence(folderId, userId);
      sendTo(ws, { type: 'access-revoked', folderId });
    }
  }
  broadcastPresence(folderId);
}

// Force-disconnect all connections for a user (called when user is deactivated)
export function disconnectUser(userId: string) {
  const conns = userConnections.get(userId);
  if (!conns) return;
  for (const ws of conns) {
    try { ws.close(4004, 'Account deactivated'); } catch { /* noop */ }
  }
}

// Periodic WS connection stats (every 5 minutes)
const wsStatsInterval = setInterval(() => {
  logger.info('WebSocket stats', {
    connections: clients.size,
    uniqueUsers: userConnections.size,
    pendingAuth: pendingAuth.size,
  });
}, 5 * 60 * 1000);
wsStatsInterval.unref(); // Don't prevent process exit
