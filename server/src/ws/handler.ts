import type { WSContext } from 'hono/ws';
import { verifyAccessToken } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { updatePresence, removePresence, getPresence } from './presence.js';
import { logger } from '../lib/logger.js';
import type { AuthUser } from '../types.js';
import { onSessionRevocation } from '../services/session-events.js';

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
  token: string;
  expiryTimer: ReturnType<typeof setTimeout>;
  authorizationRevision: number;
}

const clients = new Map<WSContext, ConnectedClient>();
// userId → Set<WSContext> for per-user broadcasting
const userConnections = new Map<string, Set<WSContext>>();
// folderId → Set<WSContext> for fast folder-scoped broadcasts
const folderSubscribers = new Map<string, Set<WSContext>>();
// Pending auth: ws → timeout timer (connections not yet authenticated)
const pendingAuth = new Map<WSContext, ReturnType<typeof setTimeout>>();
const authenticating = new Map<WSContext, symbol>();
let authenticationEpoch = 0;
// Per-user message rate limiting (sliding window)
const userMsgCounts = new Map<string, { count: number; windowStart: number }>();

export function handleWSConnection(ws: WSContext) {
  // Give client 5 seconds to send auth message
  const timer = setTimeout(() => {
    closeClient(ws, 4001, 'Authentication timeout');
  }, 5000);
  pendingAuth.set(ws, timer);
}

function registerClient(ws: WSContext, user: AuthUser, token: string): boolean {
  if (!user.sessionFamily || !user.tokenExpiresAt || user.tokenExpiresAt <= Date.now() || user.email.endsWith('@threatcaddy.internal')) {
    try { ws.close(4001, 'Session expired'); } catch { /* noop */ }
    return false;
  }
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
    token,
    expiryTimer: setTimeout(() => closeClient(ws, 4001, 'Session expired'), user.tokenExpiresAt - Date.now()),
    authorizationRevision: 0,
  };

  client.pingTimer = setInterval(() => {
    if (!client.alive) {
      closeClient(ws, 4002, 'Ping timeout');
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
    if (authenticating.has(ws)) return;
    const timer = pendingAuth.get(ws)!;
    const attempt = Symbol('authentication');
    const epoch = authenticationEpoch;
    authenticating.set(ws, attempt);

    try {
      const msg = JSON.parse(data);
      if (msg.type !== 'auth' || typeof msg.token !== 'string' || !msg.token) {
        try { ws.close(4001, 'First message must be auth'); } catch { /* noop */ }
        return;
      }
      const user = await verifyAccessToken(msg.token);
      if (authenticating.get(ws) === attempt) {
        if (authenticationEpoch === epoch) registerClient(ws, user, msg.token);
        else closeClient(ws, 4001, 'Session changed during authentication');
      }
    } catch {
      try { ws.close(4001, 'Authentication failed'); } catch { /* noop */ }
    } finally {
      clearTimeout(timer);
      pendingAuth.delete(ws);
      authenticating.delete(ws);
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
    logger.warn('WebSocket per-connection rate limit exceeded', {
      userId: client.user.id,
      displayName: client.user.displayName,
      msgCount: client.msgCount,
      limit: MSG_RATE_MAX,
      windowMs: MSG_RATE_WINDOW_MS,
    });
    sendTo(ws, { type: 'error', code: 'RATE_LIMIT', message: 'Message rate limit exceeded' });
    return;
  }

  // Per-user rate limiting (across all connections)
  let userRate = userMsgCounts.get(client.user.id);
  if (!userRate || now - userRate.windowStart > MSG_RATE_WINDOW_MS) {
    userRate = { count: 0, windowStart: now };
    userMsgCounts.set(client.user.id, userRate);
  }
  userRate.count++;
  if (userRate.count > USER_MSG_RATE_MAX) {
    logger.warn('WebSocket per-user rate limit exceeded', {
      userId: client.user.id,
      displayName: client.user.displayName,
      userMsgCount: userRate.count,
      limit: USER_MSG_RATE_MAX,
      windowMs: MSG_RATE_WINDOW_MS,
    });
    sendTo(ws, { type: 'error', code: 'RATE_LIMIT', message: 'Message rate limit exceeded' });
    return;
  }

  try {
    const msg = JSON.parse(data);
    if (!await authorizeClient(client)) return;

    switch (msg.type) {
      case 'pong': {
        client.alive = true;
        break;
      }

      case 'subscribe': {
        const folderId = msg.folderId as string;
        if (folderId && typeof folderId === 'string' && folderId.length < 128) {
          // Verify folder access before subscribing
          const revision = client.authorizationRevision;
          const hasAccess = await checkInvestigationAccess(client.user.id, folderId, 'viewer');
          if (clients.get(ws) !== client || revision !== client.authorizationRevision) break;
          if (!hasAccess) {
            sendTo(ws, { type: 'error', message: 'No access to this investigation' });
            break;
          }
          addSubscription(client, folderId);
          // Send current presence
          const presence = getPresence(folderId);
          sendTo(ws, { type: 'presence', folderId, users: presence });
        }
        break;
      }

      case 'unsubscribe': {
        const folderId = msg.folderId as string;
        if (folderId) {
          removeSubscription(client, folderId);
          // Broadcast updated presence
          await broadcastPresence(folderId);
        }
        break;
      }

      case 'presence-update': {
        const folderId = msg.folderId as string;
        // Only allow presence updates for folders the client is subscribed to
        if (folderId && client.subscribedFolders.has(folderId) && await authorizeClient(client, folderId)) {
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
          await broadcastPresence(folderId);
        }
        break;
      }

      case 'entity-change-preview': {
        // Older clients still send optimistic previews. Only committed server
        // mutations may produce entity-change messages that peers persist.
        break;
      }
    }
  } catch (err) {
    logger.error('WS message parse error', { error: String(err) });
  }
}

function addSubscription(client: ConnectedClient, folderId: string) {
  client.subscribedFolders.add(folderId);
  let subscribers = folderSubscribers.get(folderId);
  if (!subscribers) { subscribers = new Set(); folderSubscribers.set(folderId, subscribers); }
  subscribers.add(client.ws);
}

function removeSubscription(client: ConnectedClient, folderId: string) {
  client.subscribedFolders.delete(folderId);
  const subscribers = folderSubscribers.get(folderId);
  if (subscribers) { subscribers.delete(client.ws); if (!subscribers.size) folderSubscribers.delete(folderId); }
  const others = userConnections.get(client.user.id);
  if (![...(others ?? [])].some(ws => ws !== client.ws && clients.get(ws)?.subscribedFolders.has(folderId))) removePresence(folderId, client.user.id);
}

function closeClient(ws: WSContext, code: number, reason: string) {
  handleWSClose(ws);
  try { ws.close(code, reason); } catch { /* noop */ }
}

async function authorizeClient(client: ConnectedClient, folderId?: string, role: 'viewer' | 'editor' = 'viewer'): Promise<boolean> {
  if (clients.get(client.ws) !== client) return false;
  if (!client.user.tokenExpiresAt || client.user.tokenExpiresAt <= Date.now()) { closeClient(client.ws, 4001, 'Session expired'); return false; }
  const revision = client.authorizationRevision;
  try {
    const user = await verifyAccessToken(client.token);
    if (user.id !== client.user.id || user.sessionFamily !== client.user.sessionFamily) throw new Error('Session identity changed');
    if (clients.get(client.ws) !== client || revision !== client.authorizationRevision) return false;
    client.user = user;
    if (folderId && (!client.subscribedFolders.has(folderId) || !await checkInvestigationAccess(user.id, folderId, role))) {
      revokeUserFolderAccess(user.id, folderId);
      return false;
    }
    return clients.get(client.ws) === client && revision === client.authorizationRevision
      && (!folderId || client.subscribedFolders.has(folderId));
  } catch {
    closeClient(client.ws, 4001, 'Session revoked');
    return false;
  }
}

export function handleWSClose(ws: WSContext) {
  const authTimer = pendingAuth.get(ws);
  if (authTimer) clearTimeout(authTimer);
  pendingAuth.delete(ws);
  authenticating.delete(ws);
  const client = clients.get(ws);
  if (!client) return;
  clients.delete(ws);
  clearInterval(client.pingTimer);
  clearTimeout(client.expiryTimer);
  const folders = [...client.subscribedFolders];
  for (const folderId of folders) removeSubscription(client, folderId);
  const connections = userConnections.get(client.user.id);
  if (connections) {
    connections.delete(ws);
    if (!connections.size) { userConnections.delete(client.user.id); userMsgCounts.delete(client.user.id); }
  }
  for (const folderId of folders) void broadcastPresence(folderId);
}

function sendTo(ws: WSContext, msg: unknown) {
  try {
    ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  } catch { /* client disconnected */ }
}

async function broadcastPresence(folderId: string) {
  await broadcastToFolder(folderId, { type: 'presence', folderId, users: getPresence(folderId) });
}

// Revalidate each recipient against current database authorization before delivering investigation data.
export async function broadcastToFolder(folderId: string, msg: unknown, excludeUserId?: string) {
  const subscribers = [...(folderSubscribers.get(folderId) ?? [])];
  const json = typeof msg === 'string' ? msg : JSON.stringify(msg);
  await Promise.all(subscribers.map(async ws => {
    const client = clients.get(ws);
    if (client && client.user.id !== excludeUserId && client.subscribedFolders.has(folderId)
      && await authorizeClient(client, folderId)) sendTo(ws, json);
  }));
}

export async function broadcastGlobal(msg: unknown, excludeUserId?: string) {
  const json = typeof msg === 'string' ? msg : JSON.stringify(msg);
  await Promise.all([...clients.values()].map(async client => {
    if (client.user.id !== excludeUserId && await authorizeClient(client)) sendTo(client.ws, json);
  }));
}

export async function broadcastToUser(userId: string, msg: unknown) {
  const json = typeof msg === 'string' ? msg : JSON.stringify(msg);
  await Promise.all([...(userConnections.get(userId) ?? [])].map(async ws => {
    const client = clients.get(ws);
    if (client && await authorizeClient(client)) sendTo(ws, json);
  }));
}

export function revokeUserFolderAccess(userId: string, folderId: string) {
  for (const ws of userConnections.get(userId) ?? []) {
    const client = clients.get(ws);
    if (!client) continue;
    client.authorizationRevision++;
    const subscribed = client.subscribedFolders.has(folderId);
    removeSubscription(client, folderId);
    if (subscribed) sendTo(ws, { type: 'access-revoked', folderId });
  }
  void broadcastPresence(folderId);
}

export function revokeFolderAccess(folderId: string) {
  const userIds = new Set([...clients.values()].map(client => client.user.id));
  for (const userId of userIds) revokeUserFolderAccess(userId, folderId);
}

export function disconnectUser(userId: string, family?: string) {
  for (const ws of [...(userConnections.get(userId) ?? [])]) {
    const client = clients.get(ws);
    if (client && (!family || client.user.sessionFamily === family)) closeClient(ws, 4004, 'Session revoked');
  }
}

onSessionRevocation(event => {
  authenticationEpoch++;
  if ('all' in event) {
    for (const userId of [...userConnections.keys()]) disconnectUser(userId);
  } else disconnectUser(event.userId, event.family);
});

// Periodic WS connection stats (every 5 minutes)
const wsStatsInterval = setInterval(() => {
  logger.info('WebSocket stats', {
    connections: clients.size,
    uniqueUsers: userConnections.size,
    pendingAuth: pendingAuth.size,
  });
}, 5 * 60 * 1000);
wsStatsInterval.unref(); // Don't prevent process exit
