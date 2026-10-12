# ThreatCaddy API Reference

## Table of Contents

- [Overview](#overview)
- [Servers](#servers)
- [Authentication](#authentication)
- [Rate Limits](#rate-limits)
- [Error Responses](#error-responses)
- [Endpoints](#endpoints)
  - [Health](#health)
  - [Server Info](#server-info)
  - [Auth](#auth)
  - [Sync](#sync)
  - [Investigations](#investigations)
  - [Feed (CaddyShack)](#feed-caddyshack)
  - [Files](#files)
  - [Backups](#backups)
  - [LLM](#llm)
  - [Audit](#audit)
  - [Notifications](#notifications)
  - [Users](#users)
  - [Saved Searches](#saved-searches)
  - [Integrations](#integrations)
  - [Bots](#bots)
  - [Admin Panel](#admin-panel)

---

## Overview

ThreatCaddy is a collaborative threat investigation platform. The API runs on two separate servers:

- **Main API** -- serves all client-facing endpoints (`/api/*`, `/health`, `/ws`)
- **Admin API** -- serves the admin panel on an internal-only port (`/admin/*`)

The OpenAPI 3.1 specification is available in [`api-reference.yml`](./api-reference.yml).

---

## Servers

| Server | Default Port | Env Var | Purpose |
|--------|-------------|---------|---------|
| Main API | `3001` | `PORT` | Client-facing API, WebSocket |
| Admin API | `3002` | `ADMIN_PORT` | Admin panel (internal only) |

---

## Authentication

### User JWT (Main API)

Most `/api/*` endpoints require a Bearer JWT token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

Obtain tokens via `POST /api/auth/login` or `POST /api/auth/register`. Access tokens are short-lived; use `POST /api/auth/refresh` with the refresh token to rotate.

**User roles:** `admin`, `analyst`, `viewer`. Some endpoints require specific roles (noted per endpoint).

### Admin JWT (Admin API)

All `/admin/api/*` endpoints (except `/admin/api/setup-status`, `/admin/api/bootstrap`, and `/admin/api/login`) require an admin Bearer JWT:

```
Authorization: Bearer <adminToken>
```

Obtain via `POST /admin/api/login` or `POST /admin/api/bootstrap`.

### Webhook Authentication

Bot webhook endpoints (`POST /api/bots/:id/webhook`) use one of two schemes:

1. **HMAC-SHA256 signature** -- `X-Webhook-Signature: sha256=<hex>` where the hex value is `HMAC-SHA256(body, secret)`
2. **Raw secret** -- `X-Webhook-Secret: <secret>` for simple comparison

No Bearer token is required for webhook endpoints.

### WebSocket Authentication

The WebSocket endpoint (`/ws`) authenticates via the first message after connection. The client sends the JWT token as the first message payload, not as a URL parameter.

---

## Rate Limits

Rate limits are per-IP, enforced using an in-memory sliding window. When exceeded, the server responds with `429 Too Many Requests` and a `Retry-After` header.

| Endpoint | Limit |
|----------|-------|
| `POST /api/auth/login` | 10 req/min |
| `POST /api/auth/register` | 5 req/min |
| `POST /api/auth/refresh` | 20 req/min |
| `POST /api/llm/chat` | 20 req/min |
| `POST /api/caddyshack/posts` | 30 req/min |
| `POST /api/backups` | 5 req/min |
| `POST /api/bots/*/webhook` | 30 req/min |
| `POST /admin/api/login` | 5 req/min |

**Body size limits:**

| Route Pattern | Max Body Size |
|---------------|--------------|
| `/api/files/*` | 50 MB |
| `/api/backups/*` | 100 MB |
| All other `/api/*` | 1 MB |
| `/admin/api/*` | 1 MB |

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Description of the error"
}
```

Some validation errors include additional detail:

```json
{
  "error": "Validation failed",
  "details": { ... }
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| `400` | Bad request / validation error |
| `401` | Authentication failed |
| `403` | Insufficient permissions |
| `404` | Resource not found |
| `409` | Conflict (duplicate) |
| `413` | Payload too large |
| `429` | Rate limit exceeded |
| `503` | Service unavailable / degraded |

---

## Endpoints

### Health

#### `GET /health`

No authentication required. Checks database and file storage connectivity.

**Response `200`:**
```json
{
  "status": "ok",
  "db": "connected",
  "storage": "accessible",
  "timestamp": "2026-03-07T12:00:00.000Z"
}
```

**Response `503`** (degraded):
```json
{
  "status": "degraded",
  "db": "disconnected",
  "storage": "accessible",
  "timestamp": "2026-03-07T12:00:00.000Z"
}
```

---

### Server Info

#### `GET /api/server/info`

No authentication required. Returns the configured server name.

**Response `200`:**
```json
{
  "serverName": "My ThreatCaddy Instance"
}
```

---

### Auth

#### `POST /api/auth/register`

Create a new user account. May be blocked if registration mode is `invite`.

**Request body:**
```json
{
  "email": "user@example.com",
  "displayName": "Jane",
  "password": "securepassword"
}
```

- `displayName`: 1-15 characters
- `password`: 8-128 characters
- Emails ending in `@threatcaddy.internal` are blocked

**Response `201`:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "abc123...",
  "user": {
    "id": "nanoid",
    "email": "user@example.com",
    "displayName": "Jane",
    "role": "analyst",
    "avatarUrl": null
  }
}
```

| Status | Condition |
|--------|-----------|
| `400` | Validation error |
| `403` | Invite-only registration |
| `409` | Email already registered |
| `429` | Rate limited |

---

#### `POST /api/auth/login`

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response `200`:** Same shape as register.

| Status | Condition |
|--------|-----------|
| `401` | Invalid credentials |
| `403` | Account disabled / bot account |
| `429` | Rate limited |

---

#### `POST /api/auth/refresh`

**Request body:**
```json
{
  "refreshToken": "abc123..."
}
```

**Response `200`:** Same token+user shape. The old refresh token is deleted (rotated).

---

#### `POST /api/auth/logout`

**Auth:** Bearer token required.

**Request body:**
```json
{
  "refreshToken": "abc123..."
}
```

**Response `200`:** `{ "ok": true }`

---

#### `GET /api/auth/me`

**Auth:** Bearer token required.

**Response `200`:**
```json
{
  "id": "...",
  "email": "user@example.com",
  "displayName": "Jane",
  "role": "analyst",
  "avatarUrl": null,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

---

#### `PATCH /api/auth/me`

Update the current user's profile.

**Request body:**
```json
{
  "displayName": "NewName",
  "avatarUrl": "https://example.com/avatar.png"
}
```

Both fields are optional. `avatarUrl` can be set to `null` to clear.

---

#### `POST /api/auth/change-password`

**Request body:**
```json
{
  "oldPassword": "current",
  "newPassword": "newsecurepassword"
}
```

Invalidates **all** existing sessions for the user.

---

### Sync

All sync endpoints require Bearer authentication.

#### `POST /api/sync/push`

Push entity changes to the server. Each change is authorized against the user's investigation membership.

**Request body:**
```json
{
  "changes": [
    {
      "table": "notes",
      "op": "put",
      "entityId": "note-123",
      "data": { "folderId": "folder-1", "title": "My Note", "content": "..." },
      "clientVersion": 1
    }
  ]
}
```

**Supported tables:** `folders`, `notes`, `tasks`, `timelineEvents`, `whiteboards`, `standaloneIOCs`, `chatThreads`, `tags`, `timelines` (last two are global, not folder-scoped).

**Response `200`:**
```json
{
  "results": [
    { "table": "notes", "entityId": "note-123", "status": "accepted", "serverVersion": 1 },
    { "table": "notes", "entityId": "note-456", "status": "rejected" }
  ]
}
```

---

#### `GET /api/sync/pull?since={timestamp}&folderId={id}`

Pull changes since a timestamp. Without `folderId`, returns changes from all folders the user is a member of.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `since` | Yes | ISO 8601 timestamp |
| `folderId` | No | Scope to a single folder (requires viewer access) |

---

#### `GET /api/sync/snapshot/{folderId}`

Returns a full snapshot of all entities in a folder. Requires viewer access.

---

### Investigations

All endpoints require Bearer authentication.

#### `GET /api/investigations`

Lists all investigations the user is a member of.

**Response `200`:**
```json
[
  {
    "folderId": "folder-1",
    "role": "owner",
    "joinedAt": "2026-01-01T00:00:00.000Z",
    "folderName": "Incident 2026-001",
    "folderStatus": "active",
    "folderColor": "#ff6b6b",
    "folderIcon": "shield"
  }
]
```

---

#### `GET /api/investigations/:id/members`

List members of an investigation. Requires viewer access.

---

#### `POST /api/investigations/:id/members`

Add a member by user ID. **Owner only.**

**Request body:**
```json
{
  "userId": "user-id",
  "role": "editor"
}
```

`role` defaults to `"editor"`. Valid values: `owner`, `editor`, `viewer`.

---

#### `PATCH /api/investigations/:id/members/:userId`

Update a member's role. **Owner only.**

**Request body:**
```json
{ "role": "viewer" }
```

---

#### `DELETE /api/investigations/:id/members/:userId`

Remove a member. Users can remove themselves; owners can remove others.

---

#### `POST /api/investigations/:id/invite`

Invite a member by email. **Owner only.**

**Request body:**
```json
{
  "email": "colleague@example.com",
  "role": "editor"
}
```

---

#### `DELETE /api/investigations/:id`

Permanently delete an investigation and all its content. **Owner only.** Deletes notes, tasks, timeline events, whiteboards, IOCs, chat threads, posts, files, notifications, and memberships.

---

### Feed (CaddyShack)

All endpoints require Bearer authentication.

#### `GET /api/caddyshack`

Paginated feed of top-level posts. Returns posts with reactions and reply counts.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cursor` | -- | ISO timestamp of last post (for pagination) |
| `limit` | `20` | 1-100 |
| `folderId` | -- | Scope to an investigation (requires viewer access) |
| `reactions` | full lists | Set to `summary` for exact counts and viewer participation without downloading every reactor ID |

Without `folderId`, returns global posts (not scoped to any investigation).

---

#### `POST /api/caddyshack/posts`

Create a post or reply. Rate limited to 30 req/min.

**Request body:**
```json
{
  "content": "Found a suspicious C2 domain...",
  "attachments": [
    { "id": "file-1", "url": "/api/files/abc", "type": "image", "mimeType": "image/png", "filename": "screenshot.png" }
  ],
  "mentions": ["user-id-1"],
  "folderId": null,
  "parentId": null,
  "replyToId": null
}
```

- `content`: required, max 50,000 chars
- `attachments`: max 10, each requires `id`, `url`, `type` (image/video/audio/document), `mimeType`, `filename`
- `mentions`: max 50 user IDs/names
- `parentId`: set to reply to a post (flat threading -- walks up to root)

---

#### `GET /api/caddyshack/posts/:id`

By default, returns a post with all flat replies and full reactor ID lists, preserving the legacy contract.

New clients should request `?replies=page&reactions=summary&limit=50`:

- `replies=page` adds `replyPage: { total, limit, hasMore, nextCursor }`. `replies` contains only this page. The default and maximum page size is 50; limits must be positive integers.
- Pass `nextCursor` back as `cursor`. It is an opaque, thread-bound keyset cursor that preserves timestamp precision and ID ordering. Do not construct or reuse it for another thread. Invalid cursors return 400. Concurrent changes can alter totals between pages; this is not a frozen snapshot.
- Each page rechecks the current session and investigation access. Reply-target author metadata is included only for currently visible, non-deleted targets.
- `reactions=summary` retains exact `count` and adds `reactedByMe`, `userIdsScope: "viewer"`, and `userIdsComplete`. `userIds` contains only the requesting viewer's ID if they reacted; it is **not** a full reactor list. This opt-in also works on the feed and on legacy, unpaged detail requests.

The current web client opts into paging and summaries. Older servers ignore these query parameters; absence of `replyPage` means the response is a complete legacy thread. Older clients continue receiving the original response. Legacy unpaged reads remain potentially large. Pagination bounds reply rows, not total response bytes, distinct emoji groups, or database work needed for exact aggregate counts.

---

#### `PATCH /api/caddyshack/posts/:id`

Edit a post. Author or admin only.

**Request body:**
```json
{
  "content": "Updated content",
  "pinned": true
}
```

---

#### `DELETE /api/caddyshack/posts/:id`

Soft-deletes a post. Author or admin only.

---

#### `POST /api/caddyshack/posts/:id/reactions`

Add an emoji reaction.

**Request body:**
```json
{ "emoji": "thumbsup" }
```

---

#### `DELETE /api/caddyshack/posts/:id/reactions/:emoji`

Remove a reaction.

---

### Files

All endpoints require Bearer authentication.

#### `POST /api/files/upload`

Upload a file. Requires `admin` or `analyst` role. Max 50 MB.

**Request:** `multipart/form-data` with `file` field and optional `folderId` field.

**Allowed extensions:** jpg, jpeg, png, gif, webp, bmp, ico, avif, mp4, webm, ogg, mov, avi, mp3, wav, flac, aac, m4a, pdf, txt, csv, json, xml, zip, gz, tar, doc, docx, xls, xlsx, ppt, pptx, bin.

SVG uploads are blocked (validated via magic bytes).

**Response `201`:**
```json
{
  "id": "abc123",
  "url": "/api/files/abc123",
  "thumbnailUrl": "/api/files/abc123/thumbnail",
  "mimeType": "image/png",
  "size": 102400,
  "filename": "screenshot.png"
}
```

---

#### `GET /api/files/:id`

Serves the file content with proper MIME type. Access controlled by folder membership or uploader ownership.

---

#### `GET /api/files/:id/thumbnail`

Serves the WebP thumbnail for image files (400x400 max).

---

### Backups

All endpoints require Bearer authentication.

#### `POST /api/backups`

Upload an encrypted backup. Max 50 backups per user. Rate limited to 5 req/min.

**Request:** `multipart/form-data` with fields:
- `metadata` (string): JSON with `name` (required), `type` (`full`|`differential`), `scope` (`all`|`investigation`|`entity`), `scopeId`, `entityCount`, `parentBackupId`
- `blob` (file): encrypted backup data

**Response `201`:**
```json
{
  "id": "backup-123",
  "name": "Weekly backup",
  "type": "full",
  "scope": "all",
  "scopeId": null,
  "entityCount": 150,
  "sizeBytes": 524288,
  "parentBackupId": null,
  "createdAt": "2026-03-07T12:00:00.000Z"
}
```

---

#### `GET /api/backups`

List the current user's backups.

---

#### `GET /api/backups/:id`

Download the encrypted backup blob (returns `application/octet-stream`).

---

#### `DELETE /api/backups/:id`

Delete a backup and its file from disk.

---

### LLM

All endpoints require Bearer authentication.

#### `POST /api/llm/chat`

Proxy a chat request to a configured LLM provider. Requires `admin` or `analyst` role. Streams the response via Server-Sent Events. Rate limited to 20 req/min.

**Request body:**
```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "messages": [
    { "role": "user", "content": "Analyze this IOC..." }
  ],
  "systemPrompt": "You are a threat analyst.",
  "tools": []
}
```

**SSE events:**
```
data: {"type":"chunk","content":"The IOC appears to be..."}
data: {"type":"done","stopReason":"end_turn"}
```

Error events: `{"type":"error","error":"..."}`

---

#### `GET /api/llm/config`

Returns available LLM providers (API keys not exposed).

**Response `200`:**
```json
{
  "providers": [
    { "provider": "anthropic", "models": ["claude-sonnet-4-20250514", "..."] },
    { "provider": "openai", "models": ["gpt-4o", "..."] }
  ]
}
```

---

### Audit

#### `GET /api/audit`

Query the activity audit log. Requires Bearer authentication.

Non-admin users must specify a `folderId` and be an **owner** of that investigation. Admin users can query without restrictions.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `folderId` | Yes (non-admin) | Investigation folder ID |
| `userId` | No | Filter by user |
| `since` | No | ISO timestamp lower bound |
| `category` | No | Filter by category |
| `limit` | No | Max 500, default 100 |

**Response `200`:** Array of audit log entries with `id`, `userId`, `category`, `action`, `detail`, `itemId`, `itemTitle`, `folderId`, `timestamp`, `userDisplayName`, `userAvatarUrl`.

---

### Notifications

All endpoints require Bearer authentication. Notifications are scoped to the current user.

#### `GET /api/notifications`

| Parameter | Description |
|-----------|-------------|
| `unread` | Set to `"true"` for unread only |
| `limit` | Max 500, default 50 |

---

#### `PATCH /api/notifications/:id/read`

Mark a single notification as read.

---

#### `POST /api/notifications/mark-all-read`

Mark all notifications as read.

---

#### `DELETE /api/notifications/read`

Delete all read notifications. Returns `{ "ok": true, "deleted": 5 }`.

---

### Users

All endpoints require Bearer authentication.

#### `GET /api/users`

**With `search` query:** Any authenticated user can search. Returns up to 20 active users matching display name or email (case-insensitive).

**Without `search`:** Admin only. Returns full user list with `lastLoginAt` and `createdAt`.

---

#### `GET /api/users/:id`

Get a user's public profile (id, email, displayName, avatarUrl, role, createdAt).

---

#### `GET /api/users/:id/feed`

Get a user's post timeline. Returns max 50 non-deleted posts, filtered to those the requesting user has access to.

---

#### `GET /api/users/:id/likes`

Get posts the user has reacted to. Max 50, filtered by requesting user's folder access.

---

#### `GET /api/users/:id/activity`

Get a user's recent activity log entries. Max 50, filtered by requesting user's folder access.

---

#### `PATCH /api/users/:id`

Admin-only. Update a user's `role`, `active` status, or `displayName`.

---

#### `DELETE /api/users/:id`

Admin-only. Deactivates the user, invalidates all sessions, and disconnects WebSocket connections. Cannot deactivate yourself.

---

### Saved Searches

All endpoints require Bearer authentication.

#### `GET /api/saved-searches`

List saved searches visible to the current user (own searches + shared searches). Requires `admin`, `analyst`, or `viewer` role.

**Response `200`:**
```json
{
  "searches": [
    {
      "id": "search-1",
      "userId": "user-1",
      "name": "Suspicious IPs",
      "query": "type:ip confidence:high",
      "filters": {},
      "isShared": true,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

#### `POST /api/saved-searches`

Create a saved search. Requires `admin` or `analyst` role.

**Request body:**
```json
{
  "name": "My Search",
  "query": "type:domain",
  "filters": { "confidence": "high" },
  "isShared": false
}
```

- `name`: 1-200 characters, required
- `query`: 1-5000 characters, required
- `filters`: optional object, defaults to `{}`
- `isShared`: optional boolean, defaults to `false`

**Response `201`:** Returns `{ "search": { ... } }` with the created search.

| Status | Condition |
|--------|-----------|
| `400` | Validation error |

---

#### `PUT /api/saved-searches/:id`

Update a saved search. Only the owner can update. Requires `admin` or `analyst` role.

**Request body:** Same as POST.

| Status | Condition |
|--------|-----------|
| `403` | Not the owner |
| `404` | Search not found |

---

#### `DELETE /api/saved-searches/:id`

Delete a saved search. Owner or admin can delete. Requires `admin` or `analyst` role.

| Status | Condition |
|--------|-----------|
| `403` | Not authorized |
| `404` | Search not found |

---

### Integrations

All endpoints require Bearer authentication.

#### `GET /api/integrations/templates`

List all shared integration templates. Requires `admin`, `analyst`, or `viewer` role.

**Response `200`:**
```json
{
  "templates": [
    {
      "id": "tmpl-1",
      "name": "VirusTotal Lookup",
      "description": "Query VirusTotal for IOC enrichment",
      "template": { "id": "tmpl-1", "name": "...", "steps": [...], "outputs": {...}, "triggers": [...] },
      "sharedBy": "user-1",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

#### `GET /api/integrations/templates/:id`

Get a single integration template by ID. Requires `admin`, `analyst`, or `viewer` role.

| Status | Condition |
|--------|-----------|
| `404` | Template not found |

---

#### `POST /api/integrations/templates`

Share an integration template with the team. Requires `admin` or `analyst` role.

**Request body:**
```json
{
  "template": {
    "name": "My Integration",
    "description": "Does something useful",
    "steps": [{ "type": "http", "url": "https://api.example.com" }],
    "outputs": {},
    "triggers": []
  }
}
```

The `template` field must contain at minimum: `name` (1-200 chars), `steps` (array), and `outputs` (array or object).

**Response `201`:** Returns `{ "template": { ... } }`.

| Status | Condition |
|--------|-----------|
| `400` | Missing or invalid template |

---

#### `DELETE /api/integrations/templates/:id`

Delete a shared integration template. **Admin only.**

| Status | Condition |
|--------|-----------|
| `404` | Template not found |

---

### Bots

#### `GET /api/bots`

List all bot configs. Requires `admin` or `analyst` role.

---

#### `POST /api/bots`

Create a new bot. **Admin only.**

---

#### `GET /api/bots/:id`

Get a single bot config. Requires `admin` or `analyst` role.

---

#### `PATCH /api/bots/:id`

Update bot config. **Admin only.**

---

#### `DELETE /api/bots/:id`

Delete a bot. **Admin only.**

---

#### `POST /api/bots/:id/enable`

Enable a bot. **Admin only.** Returns `{ "ok": true, "enabled": true }`.

---

#### `POST /api/bots/:id/disable`

Disable a bot. **Admin only.** Returns `{ "ok": true, "enabled": false }`.

---

#### `POST /api/bots/:id/trigger`

Manually trigger a bot. **Admin only.**

---

#### `POST /api/bots/:id/webhook`

**No Bearer token required.** Authenticated via webhook signature or secret.

Accepts JSON payload and passes it to the bot for execution. Rate limited to 30 req/min.

**Authentication (pick one):**
- `X-Webhook-Signature: sha256=<HMAC-SHA256 hex of body>`
- `X-Webhook-Secret: <raw secret>`

---

#### `GET /api/bots/:id/runs`

Get bot run history. Requires `admin` or `analyst` role. `limit` param (1-100, default 50).

---

#### `GET /api/bots/:id/runs/:runId`

Get detail for a specific bot run.

---

### Admin Panel

The admin panel is served on port 3002 (configurable via `ADMIN_PORT`). All `/admin/api/*` endpoints use admin JWT authentication unless noted otherwise.

#### Setup and Authentication

##### `GET /admin/api/setup-status`

**No auth.** Returns `{ "hasAdminAccounts": true|false }`. Used by the UI to show setup vs login.

##### `POST /admin/api/bootstrap`

**No auth.** Creates the first admin account using the bootstrap secret (from `ADMIN_SECRET` env var).

**Request body:**
```json
{
  "bootstrapSecret": "your-admin-secret",
  "username": "admin",
  "displayName": "Admin User",
  "password": "12+ character password"
}
```

**Response `200`:**
```json
{
  "token": "eyJ...",
  "admin": { "id": "...", "username": "admin", "displayName": "Admin User" }
}
```

##### `POST /admin/api/login`

**No auth.** Rate limited to 5 req/min.

**Request body:** `{ "username": "admin", "password": "..." }`

**Response `200`:** Same as bootstrap.

---

#### Admin Account Management

##### `GET /admin/api/admin-accounts`

List all admin accounts.

##### `POST /admin/api/admin-accounts`

Create a new admin account. Username: 2+ chars, alphanumeric/dots/hyphens/underscores. Password: 12+ chars.

##### `PATCH /admin/api/admin-accounts/:id`

Update displayName or active status. Cannot disable your own account.

##### `DELETE /admin/api/admin-accounts/:id`

Delete an admin account. Cannot delete yourself.

##### `POST /admin/api/admin-accounts/me/change-password`

Change your own admin password. Requires `currentPassword` and `newPassword` (12+ chars).

##### `POST /admin/api/admin-accounts/:id/reset-password`

Reset another admin's password. Body: `{ "password": "..." }`.

---

#### Server Settings

##### `GET /admin/api/stats`

Returns: `totalUsers`, `activeUsers`, `investigations`, `activeSessions`, `auditLogEntries24h`.

##### `GET /admin/api/settings`

Returns: `serverName`, `registrationMode` (`open`|`invite`), `ttlHours`, `maxPerUser`, `notificationRetentionDays`, `auditLogRetentionDays`.

##### `PATCH /admin/api/settings`

Update any combination of settings. All fields optional.

```json
{
  "serverName": "My Instance",
  "registrationMode": "invite",
  "ttlHours": 72,
  "maxPerUser": 5,
  "notificationRetentionDays": 90,
  "auditLogRetentionDays": 365
}
```

##### `POST /admin/api/change-secret`

Change the admin bootstrap secret. Body: `{ "currentSecret": "...", "newSecret": "..." }`.

---

#### Email Allowlist (Invite Mode)

##### `GET /admin/api/allowed-emails`

List allowed emails.

##### `POST /admin/api/allowed-emails`

Add email. Body: `{ "email": "user@example.com" }`.

##### `DELETE /admin/api/allowed-emails/:email`

Remove email from allowlist.

---

#### User Management (Admin Panel)

##### `GET /admin/api/users`

List all non-bot users with role, active status, login times.

##### `POST /admin/api/users`

Create a user. Body: `{ "email", "displayName", "password" (8+), "role" (default "analyst") }`.

##### `PATCH /admin/api/users/:id`

Update role or active status.

##### `POST /admin/api/users/:id/reset-password`

Generates a temporary password. Response: `{ "temporaryPassword": "..." }`.

##### `GET /admin/api/users/:id/detail`

Composite view: user info, active sessions, investigation memberships, last 50 activity log entries.

##### `POST /admin/api/users/bulk`

Bulk action on multiple users.

```json
{
  "userIds": ["id1", "id2"],
  "action": "changeRole",
  "role": "viewer"
}
```

Actions: `changeRole`, `enable`, `disable`.

##### `GET /admin/api/users/export`

Download all users as CSV.

---

#### Session Management (Admin Panel)

##### `GET /admin/api/sessions`

List all active (non-expired) sessions with user info.

##### `DELETE /admin/api/sessions/user/:userId`

Force-logout a specific user (deletes all their sessions).

##### `DELETE /admin/api/sessions/all`

Force-logout all users server-wide.

---

#### Investigation Management (Admin Panel)

##### `GET /admin/api/investigations`

List all investigations with creator info and member counts.

##### `GET /admin/api/investigations/:id/detail`

Detailed view: investigation metadata, members, and entity counts (notes, tasks, timeline events, whiteboards, IOCs, chat threads, files).

##### `PATCH /admin/api/investigations/:id`

Update investigation status. Body: `{ "status": "active"|"closed"|"archived" }`.

##### `POST /admin/api/investigations/:id/members`

Add a member. Body: `{ "userId": "...", "role": "editor" }`.

##### `PATCH /admin/api/investigations/:id/members/:userId`

Update member role.

##### `DELETE /admin/api/investigations/:id/members/:userId`

Remove a member.

##### `DELETE /admin/api/investigations/:id/content`

**Destructive.** Purge and delete an investigation and all its content. Requires confirmation:

```json
{ "confirmName": "Exact Investigation Name" }
```

Returns counts of deleted entities per type.

---

#### Audit Log (Admin Panel)

##### `GET /admin/api/audit-log`

Paginated, filterable audit log.

| Parameter | Description |
|-----------|-------------|
| `page` | Page number (default 1) |
| `pageSize` | 1-200 (default 50) |
| `userId` | Filter by user |
| `category` | Filter by category |
| `action` | Filter by action |
| `folderId` | Filter by folder |
| `dateFrom` | ISO timestamp lower bound |
| `dateTo` | ISO timestamp upper bound |
| `search` | Search in detail and itemTitle |

Returns: `{ entries, total, page, pageSize }`.

##### `GET /admin/api/audit-log/export`

Export up to 50,000 entries as CSV with the same filter parameters.

---

#### Bot Management (Admin Panel)

##### `GET /admin/api/bots`

List all bots with creator info.

##### `POST /admin/api/bots`

Create a bot.

##### `GET /admin/api/bots/:id`

Bot detail with runs and memberships.

##### `PATCH /admin/api/bots/:id`

Update bot config.

##### `POST /admin/api/bots/:id/enable` / `POST /admin/api/bots/:id/disable`

Enable or disable a bot.

##### `POST /admin/api/bots/:id/trigger`

Manually trigger a bot.

##### `DELETE /admin/api/bots/:id`

Delete a bot.

##### `GET /admin/api/bots/:id/runs`

Bot run history. `limit` param (1-200, default 50).

##### `GET /admin/api/bots/:id/runs/:runId`

Run detail with execution log.

---

#### AI Assistant (Admin Panel)

##### `GET /admin/api/ai/providers`

List configured AI providers (Anthropic, OpenAI, Gemini, Mistral, local) with default settings.

##### `GET /admin/api/ai/settings`

Get AI assistant settings. Local API key is masked.

##### `PATCH /admin/api/ai/settings`

Update AI settings:

```json
{
  "localEndpoint": "http://localhost:11434/v1",
  "localApiKey": "optional-key",
  "localModelName": "llama3",
  "customSystemPrompt": "Additional instructions...",
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "temperature": 0.7
}
```

##### `POST /admin/api/ai/chat`

AI assistant with tool use (agentic loop). Streams via SSE.

**Request body:**
```json
{
  "messages": [{ "role": "user", "content": "Show me user stats" }],
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
```

Only user/assistant messages with string content are accepted: at most 50 messages, 20,000 characters per message, and 128 KiB for the request body. A turn allows at most 20 tool calls, a 512 KiB conversation context, and 1 MiB of SSE output (256 KiB per event). It has a two-minute deadline; disconnects and stalled consumers cancel provider work. Supports Anthropic, OpenAI, Gemini, Mistral, and local providers.

Write tools do not execute in this endpoint. They produce one exact-action proposal and terminate the turn. Nonempty legacy `confirmedToolCalls` lists are rejected; a tool name or chat message cannot authorize a mutation. Current administrator authority is rechecked around provider/tool work.

**SSE events:**
- `{ "type": "provider", "provider": "anthropic", "model": "..." }` -- selected provider
- `{ "type": "text", "text": "..." }` -- response text
- `{ "type": "tool_call", "name": "...", "input": {...}, "requiresConfirm": false }` -- tool invocation
- `{ "type": "tool_result", "name": "...", "result": {...} }` -- tool result
- `{ "type": "tool_error", "name": "...", "error": "..." }` -- tool error
- `{ "type": "done", "stopReason": "end_turn" }` -- completion
- `{ "type": "error", "error": "..." }` -- fatal error
- `{ "type": "confirmation_required", "approvalId": "...", "name": "...", "input": {...}, "expiresAt": 1234567890000 }` -- terminal, exact-action proposal; no mutation has executed

Exactly one terminal event ends a completed stream. A truncated stream is not success; partial text must not be reused as completed conversation history.

##### `POST /admin/api/ai/approvals/:approvalId`

Send only `{ "decision": "approve" }` or `{ "decision": "reject" }` from the same administrator session that received the proposal. The server uses its stored tool name and validated arguments, not replacement arguments from the request. Proposals expire after at most five minutes, bounded by session expiry. Authorization, last-owner/admin constraints, and supported bot capabilities are rechecked inside the mutation transaction.

The receipt has `approvalId`, `name`, and `status` (`executing`, `completed`, `rejected`, or `failed`), with optional bounded `result`, `error`, and `completedAt`. An executing receipt returns HTTP 202; a settled receipt returns 200. A completed receipt may include warnings when the mutation committed but its audit or runtime refresh did not complete.

Repeating a decision for the same ID returns its receipt without executing again. After a lost response, explicitly retry the same ID rather than requesting another proposal. Completed receipts are retained for five minutes. The registry is process-local and bounded (200 total / 20 per session); restarting the server invalidates pending approvals and receipts. An expired or missing receipt does not prove that an earlier submitted action failed: inspect current state and the audit log before requesting a replacement. Cancelling or clearing the UI cannot undo a committed mutation.
