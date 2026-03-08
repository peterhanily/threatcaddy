type GetTokenFn = () => Promise<string | null>;
type InvalidateTokenFn = () => void;

let _getToken: GetTokenFn = async () => null;
let _invalidateToken: InvalidateTokenFn = () => {};
let _serverUrl: string | null = null;

export function configureServerApi(
  serverUrl: string | null,
  getToken: GetTokenFn,
  invalidateToken?: InvalidateTokenFn,
) {
  _serverUrl = serverUrl;
  _getToken = getToken;
  _invalidateToken = invalidateToken || (() => {});
}

async function apiFetch(path: string, opts: RequestInit = {}, _retry = false): Promise<Response> {
  if (!_serverUrl) throw new Error('Not connected to server');

  const token = await _getToken();
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(opts.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const resp = await fetch(`${_serverUrl}${path}`, {
    ...opts,
    headers,
  });

  // On 401, invalidate the cached token so getAccessToken triggers a refresh,
  // then retry the request once with the fresh token.
  if (resp.status === 401 && !_retry) {
    _invalidateToken();
    const freshToken = await _getToken();
    if (freshToken) {
      return apiFetch(path, opts, true);
    }
  }

  return resp;
}

// ─── Auth ───────────────────────────────────────────────────────

export async function fetchMe() {
  const resp = await apiFetch('/api/auth/me');
  if (!resp.ok) throw new Error('Failed to fetch profile');
  return resp.json();
}

export async function updateProfile(updates: { displayName?: string; avatarUrl?: string }) {
  const resp = await apiFetch('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!resp.ok) throw new Error('Failed to update profile');
  return resp.json();
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const resp = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || 'Failed to change password');
  }
}

// ─── Server Info ────────────────────────────────────────────────

export async function fetchServerInfo(): Promise<{ serverName: string }> {
  const resp = await apiFetch('/api/server/info');
  if (!resp.ok) throw new Error('Failed to fetch server info');
  return resp.json();
}

// ─── Sync ───────────────────────────────────────────────────────

export interface SyncChange {
  table: string;
  op: 'put' | 'delete';
  entityId: string;
  data?: Record<string, unknown>;
  clientVersion?: number;
}

export interface SyncResult {
  table?: string;
  entityId: string;
  status: 'accepted' | 'conflict' | 'rejected';
  serverVersion?: number;
  serverData?: Record<string, unknown>;
}

export async function syncPush(changes: SyncChange[]): Promise<{ results: SyncResult[] }> {
  const resp = await apiFetch('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ changes }),
  });
  if (!resp.ok) throw new Error('Sync push failed');
  return resp.json();
}

export async function syncPull(since: string, folderId?: string) {
  const params = new URLSearchParams({ since });
  if (folderId) params.set('folderId', folderId);
  const resp = await apiFetch(`/api/sync/pull?${params}`);
  if (!resp.ok) throw new Error('Sync pull failed');
  return resp.json();
}

export async function syncSnapshot(folderId: string) {
  const resp = await apiFetch(`/api/sync/snapshot/${folderId}`);
  if (!resp.ok) throw new Error('Sync snapshot failed');
  return resp.json();
}

// ─── Investigations ─────────────────────────────────────────────

export async function fetchInvestigations() {
  const resp = await apiFetch('/api/investigations');
  if (!resp.ok) throw new Error('Failed to fetch investigations');
  return resp.json();
}

export async function fetchInvestigationMembers(folderId: string) {
  const resp = await apiFetch(`/api/investigations/${folderId}/members`);
  if (!resp.ok) {
    if (resp.status === 403) throw new Error('not_synced');
    throw new Error('Failed to fetch members');
  }
  return resp.json();
}

export async function addInvestigationMember(folderId: string, userId: string, role = 'editor') {
  const resp = await apiFetch(`/api/investigations/${folderId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId, role }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || 'Failed to add member');
  }
}

export async function inviteByEmail(folderId: string, email: string, role = 'editor') {
  const resp = await apiFetch(`/api/investigations/${folderId}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || 'Failed to invite');
  }
}

export async function removeInvestigationMember(folderId: string, userId: string) {
  const resp = await apiFetch(`/api/investigations/${folderId}/members/${userId}`, {
    method: 'DELETE',
  });
  if (!resp.ok) throw new Error('Failed to remove member');
}

export async function updateMemberRole(folderId: string, userId: string, role: string) {
  const resp = await apiFetch(`/api/investigations/${folderId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  if (!resp.ok) throw new Error('Failed to update role');
}

// ─── CaddyShack ─────────────────────────────────────────────────

export async function fetchFeed(opts: { cursor?: string; limit?: number; folderId?: string }) {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.folderId) params.set('folderId', opts.folderId);
  const resp = await apiFetch(`/api/caddyshack?${params}`);
  if (!resp.ok) throw new Error('Failed to fetch feed');
  return resp.json();
}

export async function createPost(data: {
  content: string;
  attachments?: Array<{ id: string; url: string; type: string; mimeType: string; filename: string; size?: number; thumbnailUrl?: string; alt?: string }>;
  mentions?: string[];
  folderId?: string | null;
  parentId?: string | null;
  replyToId?: string | null;
}) {
  const resp = await apiFetch('/api/caddyshack/posts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error('Failed to create post');
  return resp.json();
}

export async function fetchPost(postId: string) {
  const resp = await apiFetch(`/api/caddyshack/posts/${postId}`);
  if (!resp.ok) throw new Error('Failed to fetch post');
  return resp.json();
}

export async function editPost(postId: string, updates: { content?: string; pinned?: boolean }) {
  const resp = await apiFetch(`/api/caddyshack/posts/${postId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!resp.ok) throw new Error('Failed to edit post');
}

export async function deletePost(postId: string) {
  const resp = await apiFetch(`/api/caddyshack/posts/${postId}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error('Failed to delete post');
}

export async function addReaction(postId: string, emoji: string) {
  const resp = await apiFetch(`/api/caddyshack/posts/${postId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
  if (!resp.ok) throw new Error('Failed to add reaction');
}

export async function removeReaction(postId: string, emoji: string) {
  const resp = await apiFetch(`/api/caddyshack/posts/${postId}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'DELETE',
  });
  if (!resp.ok) throw new Error('Failed to remove reaction');
}

// ─── Files ──────────────────────────────────────────────────────

export async function uploadFile(file: File, folderId?: string): Promise<{
  id: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  size: number;
  filename: string;
}> {
  const formData = new FormData();
  formData.append('file', file);
  if (folderId) formData.append('folderId', folderId);

  const resp = await apiFetch('/api/files/upload', {
    method: 'POST',
    body: formData,
    headers: {}, // Let browser set content-type for FormData
  });
  if (!resp.ok) throw new Error('Failed to upload file');
  return resp.json();
}

export function getFileUrl(fileId: string): string {
  return _serverUrl ? `${_serverUrl}/api/files/${fileId}` : '';
}

// ─── LLM ────────────────────────────────────────────────────────

export async function fetchLLMConfig() {
  const resp = await apiFetch('/api/llm/config');
  if (!resp.ok) throw new Error('Failed to fetch LLM config');
  return resp.json();
}

export async function streamLLMChat(
  data: { provider: string; model: string; messages: unknown[]; systemPrompt?: string; tools?: unknown[] },
  onChunk: (text: string) => void,
  onDone: (stopReason: string) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
) {
  const token = await _getToken();
  const resp = await fetch(`${_serverUrl}/api/llm/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.text();
    onError(err);
    return;
  }

  const reader = resp.body?.getReader();
  if (!reader) { onError('No response body'); return; }
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'chunk') onChunk(event.content);
        else if (event.type === 'done') onDone(event.stopReason);
        else if (event.type === 'error') onError(event.error);
      } catch (e) { console.warn('Failed to parse SSE event:', e); }
    }
  }
}

// ─── Audit ──────────────────────────────────────────────────────

export async function fetchAuditLog(opts: { folderId?: string; userId?: string; since?: string; category?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (opts.folderId) params.set('folderId', opts.folderId);
  if (opts.userId) params.set('userId', opts.userId);
  if (opts.since) params.set('since', opts.since);
  if (opts.category) params.set('category', opts.category);
  if (opts.limit) params.set('limit', String(opts.limit));
  const resp = await apiFetch(`/api/audit?${params}`);
  if (!resp.ok) throw new Error('Failed to fetch audit log');
  return resp.json();
}

// ─── Notifications ──────────────────────────────────────────────

export async function fetchNotifications(unread = false, limit = 50) {
  const params = new URLSearchParams();
  if (unread) params.set('unread', 'true');
  params.set('limit', String(limit));
  const resp = await apiFetch(`/api/notifications?${params}`);
  if (!resp.ok) throw new Error('Failed to fetch notifications');
  return resp.json();
}

export async function markNotificationRead(id: string) {
  await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead() {
  await apiFetch('/api/notifications/mark-all-read', { method: 'POST' });
}

// ─── Users ──────────────────────────────────────────────────────

export async function searchUsers(query: string) {
  const resp = await apiFetch(`/api/users?search=${encodeURIComponent(query)}`);
  if (!resp.ok) throw new Error('Failed to search users');
  return resp.json();
}

export async function fetchAllUsers() {
  const resp = await apiFetch('/api/users');
  if (!resp.ok) throw new Error('Failed to fetch users');
  return resp.json();
}

export async function fetchUserProfile(userId: string) {
  const resp = await apiFetch(`/api/users/${userId}`);
  if (!resp.ok) throw new Error('Failed to fetch user');
  return resp.json();
}

export async function fetchUserFeed(userId: string) {
  const resp = await apiFetch(`/api/users/${userId}/feed`);
  if (!resp.ok) throw new Error('Failed to fetch user feed');
  return resp.json();
}

export async function fetchUserLikes(userId: string) {
  const resp = await apiFetch(`/api/users/${userId}/likes`);
  if (!resp.ok) throw new Error('Failed to fetch user likes');
  return resp.json();
}

export async function fetchUserActivity(userId: string) {
  const resp = await apiFetch(`/api/users/${userId}/activity`);
  if (!resp.ok) throw new Error('Failed to fetch user activity');
  return resp.json();
}

// ─── Backups ─────────────────────────────────────────────────────

export interface BackupMeta {
  id: string;
  name: string;
  type: 'full' | 'differential';
  scope: 'all' | 'investigation' | 'entity';
  scopeId: string | null;
  entityCount: number;
  sizeBytes: number;
  parentBackupId: string | null;
  createdAt: string;
}

export async function createBackup(
  metadata: {
    name: string;
    type: string;
    scope: string;
    scopeId?: string;
    entityCount: number;
    parentBackupId?: string;
  },
  encryptedBlob: Blob,
): Promise<BackupMeta> {
  const formData = new FormData();
  formData.append('metadata', JSON.stringify(metadata));
  formData.append('blob', encryptedBlob, 'backup.enc');

  const resp = await apiFetch('/api/backups', {
    method: 'POST',
    body: formData,
    headers: {},
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Failed to create backup' }));
    throw new Error(err.error || 'Failed to create backup');
  }
  return resp.json();
}

export async function listBackups(): Promise<{ backups: BackupMeta[] }> {
  const resp = await apiFetch('/api/backups');
  if (!resp.ok) throw new Error('Failed to list backups');
  return resp.json();
}

export async function downloadBackup(id: string): Promise<Blob> {
  const resp = await apiFetch(`/api/backups/${id}`);
  if (!resp.ok) throw new Error('Failed to download backup');
  return resp.blob();
}

export async function deleteBackup(id: string): Promise<void> {
  const resp = await apiFetch(`/api/backups/${id}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error('Failed to delete backup');
}

// ─── Integration Templates (Team Sharing) ────────────────────────

export async function shareIntegrationTemplate(template: unknown): Promise<void> {
  const resp = await apiFetch('/api/integrations/templates', {
    method: 'POST',
    body: JSON.stringify(template),
  });
  if (!resp.ok) throw new Error('Failed to share template');
}

export async function fetchTeamTemplates(): Promise<unknown[]> {
  const resp = await apiFetch('/api/integrations/templates');
  if (!resp.ok) throw new Error('Failed to fetch team templates');
  return resp.json();
}

export async function deleteTeamTemplate(id: string): Promise<void> {
  const resp = await apiFetch(`/api/integrations/templates/${id}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error('Failed to delete template');
}
