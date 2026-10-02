export interface JWTPayload {
  sub: string;       // userId
  email: string;
  role: string;
  displayName: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  displayName: string;
  avatarUrl: string | null;
  sessionFamily?: string;
  tokenExpiresAt?: number;
}

export type ServerRole = 'admin' | 'analyst' | 'viewer';
export type InvestigationRole = 'owner' | 'editor' | 'viewer';

export interface SyncChange {
  table: string;
  op: 'put' | 'delete';
  entityId: string;
  data?: Record<string, unknown>;
  clientVersion?: number;
}

export interface SyncResult {
  table: string;
  entityId: string;
  status: 'accepted' | 'conflict' | 'rejected';
  serverVersion?: number;
  serverData?: Record<string, unknown>;
  serverRecord?: Record<string, unknown>;
  previousFolderId?: string;
}

// WebSocket message types
export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

export interface WSSubscribeMsg {
  type: 'subscribe';
  folderId: string;
}

export interface WSUnsubscribeMsg {
  type: 'unsubscribe';
  folderId: string;
}

export interface WSPresenceUpdateMsg {
  type: 'presence-update';
  folderId: string;
  view: string;
  entityId?: string;
}

export interface WSEntityChangeMsg {
  type: 'entity-change';
  table: string;
  op: 'put' | 'delete';
  entityId: string;
  data?: Record<string, unknown>;
  updatedBy: string;
}

export interface WSPresenceMsg {
  type: 'presence';
  folderId: string;
  users: Array<{
    id: string;
    displayName: string;
    avatarUrl: string | null;
    view: string;
  }>;
}

export interface LLMChatRequest {
  provider: string;
  model: string;
  messages: Array<{ role: string; content: string | unknown[] }>;
  systemPrompt?: string;
  tools?: unknown[];
}
