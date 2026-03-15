# ThreatCaddy Architecture

ThreatCaddy is a threat intelligence investigation platform composed of three main subsystems: a Chrome Extension client, a Team Server, and an Agent Bridge for AI integration.

---

## 1. System Overview

ThreatCaddy is a local-first, team-capable threat intelligence workbench. Users can run it entirely offline in a browser, or connect to a shared team server for real-time collaboration.

### Component Roles

| Component | Technology | Purpose |
|---|---|---|
| **Browser Client** | React, Vite, TypeScript, Dexie.js, PWA | Investigation workspace -- notes, tasks, timelines, IOCs, whiteboards, chat |
| **IndexedDB** | Dexie.js (21 schema versions) | Local-first storage. All data persists in the browser first. |
| **Encryption Middleware** | Web Crypto API (AES-256-GCM) | Transparent field-level encryption at rest in IndexedDB |
| **Chrome Extension** | Chrome MV3 | Web clipping, LLM API proxy (bypasses CORS), URL fetching |
| **Team Server** | Hono framework, Node.js | REST API, WebSocket server, bot runtime, admin panel |
| **PostgreSQL** | Drizzle ORM | Shared data store for team mode |
| **Admin Panel** | Separate Hono app on port 3002 | Server-rendered HTML admin UI (users, bots, settings, audit) |
| **Bot Runtime** | In-process (BotManager) | Automated workflows triggered by events, schedules, webhooks |
| **Docker Sandbox** | dockerode | Isolated code execution for bots (Python, Node.js, Bash) |
| **Agent Bridge** | Chrome DevTools Protocol (CDP) | Programmatic access for AI agents to read/write investigation data |

---

## 2. Directory Layout

```
src/                    Chrome extension source
  components/           React components
  contexts/             React context providers
  hooks/                React hooks (data layer)
  lib/                  Business logic, tools, export/import
  types.ts              TypeScript interfaces
  types/                Additional type modules (integrations, etc.)
  workers/              Web Workers
  db.ts                 Dexie database schema

extension/              Chrome extension packaging (manifest, build scripts)

server/                 Team server
  src/
    routes/             API route handlers (+ admin/ sub-routes)
    middleware/          Auth, rate limiting, RBAC
    services/           Business logic services
    db/                 Drizzle schema + migrations
    ws/                 WebSocket handler
    bots/               Bot runtime + sandbox

agents/                 External agent integrations
  claude-code/          Claude Code skill + CDP daemon
  claude-desktop/       Claude Desktop MCP integration
  codex/                OpenAI Codex integration

docs/                   Documentation
```

---

## 3. Data Model

### 3.1 Core Entities

- **Folder (Investigation)** -- The top-level container. Every note, task, timeline event, IOC, and whiteboard belongs to exactly one folder. Folders carry status (active, closed, archived), TLP/PAP classification, and closure resolution metadata.

- **Note** -- Rich Markdown content with automatic IOC extraction, inline annotations, and cross-entity links to tasks, timeline events, and other notes.

- **Task** -- Kanban-style work items with three columns (todo, in-progress, done). Supports priority levels (none, low, medium, high), inline checklists, and assignees.

- **TimelineEvent** -- Temporal records tagged with MITRE ATT&CK tactics, incident response phases, confidence levels, geographic context (latitude/longitude), and threat actor attribution.

- **StandaloneIOC** -- Indicators of Compromise spanning 13 types: ipv4, ipv6, domain, url, email, md5, sha1, sha256, cve, mitre-attack, yara-rule, sigma-rule, and file-path. Each IOC tracks status, enrichment data, and typed relationships to other IOCs.

- **Whiteboard** -- Excalidraw-based visual collaboration canvas for diagramming attack flows and relationships.

- **ChatThread** -- LLM conversation threads with tool-use support, enabling AI-assisted analysis within investigations.

### 3.2 Entity Relationships

All entities support cross-linking through `linkedNoteIds`, `linkedTaskIds`, and `linkedTimelineEventIds` arrays. IOCs use typed relationships with the following link types: resolves-to, downloads, communicates-with, drops, hosts, attributed-to, exploits, uses-technique, detected-by, alerts-on, and related-to.

### 3.3 Client-Side Storage (IndexedDB via Dexie)

The client database has evolved through 21 schema versions. Tables include: notes, tasks, folders, tags, timelineEvents, timelines, whiteboards, activityLog, standaloneIOCs, chatThreads, noteTemplates, playbookTemplates, integrationTemplates, installedIntegrations, integrationRuns, and two internal sync tables (_syncQueue, _syncMeta).

### 3.4 Server-Side Storage (PostgreSQL via Drizzle ORM)

The server schema has 19 migrations and includes all client-side entities plus server-specific tables: users, sessions, investigation_members, server_settings, allowed_emails, bot_configs, bot_runs, admin_users, activity_log, posts, reactions, notifications, files, saved_searches, integration_templates, and backups.

Drizzle ORM with the `postgres.js` driver manages the connection pool (max 20 connections). The schema is defined in TypeScript with type-safe queries. Migration files live in `server/src/db/migrations/`.

### 3.5 Entity Relationship Summary

- Users have sessions, investigation memberships, files, backups, and bot configs.
- Folders contain notes, tasks, timeline events, whiteboards, standalone IOCs, chat threads, and posts.
- Folders have investigation members that bind users to specific roles.
- Timelines contain timeline events.
- Bot configs have bot runs.
- Posts have reactions, replies (self-referential), and trigger notifications.

---

## 4. Sync Protocol

ThreatCaddy uses an optimistic concurrency model with full offline support. Every entity is written to IndexedDB first -- the server is optional and the app is fully functional without it.

### 4.1 Push

The client drains the `_syncQueue` table and sends changes via POST to the server. Each change contains a table name, entity ID, operation type (create/update/delete), data payload, version number, and timestamp. The server validates investigation membership, applies conflict resolution, and broadcasts accepted changes to other clients via WebSocket. Results for each change are classified as accepted, rejected, or conflict.

### 4.2 Pull

The client requests all changes since a given timestamp for a specific folder. The server returns changes with version info. A MetadataOnly mode is available for lightweight polling without full payloads.

### 4.3 Snapshot

A full investigation state download used for initial sync when joining an investigation or for recovery after extended offline periods.

### 4.4 Conflict Resolution

The system uses last-writer-wins semantics keyed by version number. Every entity has a `version` integer that increments on each update. When the server receives a change whose version is less than or equal to the current version, it rejects the write and returns the current server data as a conflict. The client surfaces conflicts to the UI where users choose "mine" (re-push local) or "theirs" (overwrite local with server data).

Server-managed fields (id, createdBy, updatedBy, version, createdAt, updatedAt, deletedAt) are stripped from client payloads and never trusted from the client. Delete operations use soft-delete (setting `deletedAt` and bumping the version) so other clients discover deletions on their next pull.

### 4.5 Offline Support

When the client is offline, all mutations are queued in the `_syncQueue` IndexedDB table via Dexie table hooks (creating, updating, deleting) that run synchronously in Dexie transactions. On reconnect, queued changes are replayed in order. A safety-net full push+pull cycle runs every 30 seconds. During continuous typing, changes trigger a push within 50ms (debounce) with a 300ms maximum wait.

### 4.6 Authorization on Push

- Global tables (tags, timelines) are always accepted.
- Folder-scoped tables require editor role on the folder via investigation_members.
- New folders auto-create an owner membership for the creating user.
- Folders marked `localOnly` (and their scoped entities) skip sync entirely.

---

## 5. Security Model

### 5.1 Authentication

**Access tokens** are JWTs signed with EdDSA (Ed25519) and carry a 15-minute TTL. Claims include sub, email, role, and displayName.

**Refresh tokens** are session-based, generated with nanoid(32), and stored in PostgreSQL. The server tracks token families to detect reuse (a signal of token theft). Both TTL (default 24 hours) and maximum sessions per user are configurable. On refresh, the old session is deleted and a new one is created.

**Admin tokens** use a separate HMAC-SHA256 JWT issued on a dedicated admin port (default 3002). They have a 1-hour TTL with an audience claim of `admin-panel`, signed with a random 32-byte key regenerated on each server startup. This intentionally invalidates all admin sessions on restart.

**Passwords** are hashed with Argon2id. Login rate limiting uses progressive lockout after failed attempts (in-memory, per email).

**Registration modes**: Invite-only (default, requiring an email in the `allowed_emails` table) or open registration.

### 5.2 Authorization

Two separate RBAC systems enforce access control:

**Server roles** (on the users table):
- admin -- Full server access, can create bots.
- analyst -- Standard access, can read bots.
- viewer -- Read-only server access.

**Investigation roles** (on the investigation_members table):
- owner -- Full control, can manage members.
- editor -- Can create and modify entities.
- viewer -- Can read entities.

Access check hierarchy: viewer (0) < editor (1) < owner (2). Server roles are enforced via `requireRole` middleware. Investigation membership is enforced via `requireMembership` middleware.

Bot accounts use `@threatcaddy.internal` email addresses and are blocked from interactive login.

### 5.3 Client-Side Encryption

All sensitive fields in IndexedDB can be encrypted at rest using AES-256-GCM. The key hierarchy:

1. **Master key** -- Random AES-256-GCM key generated once, stored wrapped in IndexedDB.
2. **Wrapping key** -- Derived from user passphrase via PBKDF2 (600,000 iterations, SHA-256).
3. **Session key** -- Unwrapped master key held in memory only (lost on tab close), cached in sessionStorage for tab refreshes.
4. **Recovery phrase** -- 24-word BIP39-style phrase (192 bits of entropy) for passphrase recovery.

Each encrypted field gets its own random 96-bit IV. The encryption middleware is installed as a Dexie DBCore middleware, transparently encrypting on mutate (add/put) and decrypting on get/getMany/query. It uses `Dexie.waitFor()` to keep IDB transactions alive during async Web Crypto operations.

Encrypted tables and fields include: notes (title, content, sourceUrl, sourceTitle, color, clsLevel, iocAnalysis), tasks (title, description, clsLevel, iocAnalysis, comments), folders (name, description, clsLevel, papLevel), timelineEvents (title, description, source, actor, rawData, clsLevel, iocAnalysis), whiteboards (name, elements, appState), chatThreads (title, messages), standaloneIOCs (value, analystNotes), timelines (name, description), tags (name), activityLog (detail, itemTitle), installedIntegrations (config, lastError), and integrationRuns (log, error, displayResults).

### 5.4 Security Headers

All responses include:
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Strict-Transport-Security: max-age=31536000; includeSubDomains
- X-DNS-Prefetch-Control: off
- Referrer-Policy: strict-origin-when-cross-origin
- Content-Security-Policy: default-src 'none'; frame-ancestors 'none' (API server) or nonce-based (admin panel)

### 5.5 Rate Limiting

In-memory sliding window rate limiting, keyed by IP address. Limits are configurable per endpoint.

---

## 6. WebSocket Protocol

Real-time collaboration is powered by WebSocket connections between the client and team server.

**Authentication**: The first message on a new connection must contain a valid JWT (5-second timeout to authenticate).

**Message types**:
- auth -- JWT authentication on connect. Server responds with auth-ok or error.
- subscribe / unsubscribe -- Join or leave folder channels (verified against investigation_members).
- presence-update -- Report current view and entity being edited. Server broadcasts presence to other subscribers.
- entity-change-preview -- Optimistic relay from sender to other subscribers (verified for editor access).
- entity-change -- Server-authoritative entity changes broadcast after sync push acceptance.
- ping / pong -- Keep-alive (25-second interval).
- access-revoked -- Sent when a user is removed from an investigation.
- error -- Sent on malformed messages or unauthorized actions.

**Rate limits**:
- 30 messages per second per connection.
- 50 messages per second per user (across all connections).
- Maximum 10 connections per user.
- Maximum 64KB per message.

Entity changes received via WebSocket are applied directly via `applyRemoteChange()`, bypassing the normal pull cycle for lower latency.

---

## 7. Export and Import Formats

ThreatCaddy supports multiple interchange formats for interoperability with other threat intelligence tools.

| Format | Direction | Description |
|---|---|---|
| JSON | Import/Export | Full database backup and restore, or single-investigation export |
| CSV | Export | IOC export with configurable column selection |
| STIX 2.1 | Import/Export | Full bundle with Indicator SDOs, Vulnerability SDOs, Relationship SROs, and TLP markings using official OASIS UUIDs |
| MISP | Import/Export | Event-level export and import with attribute type mapping |
| Markdown | Import/Export | Individual note export; import from Markdown files |
| HTML Report | Export | Print-friendly, styled investigation report |

Export formats respect TLP classification levels, redacting or omitting data as appropriate.

---

## 8. Agent Bridge (CDP Integration)

The Agent Bridge exposes a `window.threatcaddy` API surface that AI agents can interact with through the Chrome DevTools Protocol.

### 8.1 Capabilities

The bridge provides 29 tools organized into five categories:

- **Search and Read** (10 tools) -- Query and retrieve investigation data.
- **Create and Update** (11 tools) -- Mutate notes, tasks, IOCs, timeline events, and other entities.
- **Analysis** (2 tools) -- Perform analytical operations on investigation data.
- **Web** (1 tool) -- Web-based lookups.
- **Cross-Investigation** (5 tools) -- Operations that span multiple folders.

### 8.2 Security

Authentication uses a nonce-based challenge: the bridge generates a random nonce at startup, and agents must present it with each request.

### 8.3 Architecture

A persistent Node.js daemon holds the CDP session via a Unix domain socket. This eliminates Chrome's debugging confirmation popup and provides a stable connection for long-running agent workflows. All tool calls are audit-logged to the IndexedDB activityLog table.

---

## 9. Bot System

Bots extend ThreatCaddy with automated workflows for enrichment, monitoring, and correlation.

### 9.1 Bot Types

| Type | Purpose |
|---|---|
| enrichment | Enrich IOCs with external threat intel (VirusTotal, AbuseIPDB, etc.) |
| feed | Ingest threat intel feeds |
| monitor | Watch for specific conditions and alert |
| triage | Auto-classify and prioritize |
| report | Generate reports |
| correlation | Find relationships across investigations |
| ai-agent | LLM-powered autonomous agent with tool calling |
| integration | Execute integration templates |
| custom | User-defined logic |

### 9.2 Trigger Types

| Trigger | Mechanism | Details |
|---|---|---|
| Event | In-process event bus (BotEventBus) | Fires on entity.created, entity.updated, entity.deleted, investigation.created/closed/archived, post.created, member.added/removed, webhook.received. Event filters narrow triggers to specific tables, folder IDs, or IOC types. |
| Schedule | Cron expressions via croner library | Any valid cron expression |
| Webhook | POST /api/bots/:id/webhook | Authenticated via HMAC-SHA256 signature or raw secret comparison (both use timing-safe equality) |
| Manual | POST /api/bots/:id/trigger | Admin-initiated on-demand execution |

### 9.3 Capability Model

Bots are granted explicit capabilities that gate what operations they can perform:

| Capability | Grants |
|---|---|
| read_entities | Search, list, read notes/tasks/IOCs/timeline events |
| create_entities | Create notes, tasks, IOCs, timeline events |
| update_entities | Update existing entities |
| post_to_feed | Post to CaddyShack social feed |
| notify_users | Send notifications to users |
| call_external_apis | Make outbound HTTP requests (domain-restricted) |
| cross_investigation | Search/read across multiple investigations |
| execute_remote | SSH commands, SOAR playbook triggers |
| run_code | Execute code in sandboxed Docker containers |

### 9.4 Execution Model

**Concurrency**: Maximum 10 concurrent bot runs (configurable). Excess runs queue up in FIFO order (max 50 queue size). Overflows are dropped.

**Rate limiting**: Token-bucket algorithm per bot with hourly and daily buckets. Default: 100/hour, 1000/day (configurable per bot).

**Timeout**: Default 5 minutes (configurable). AbortController cancels in-flight operations on timeout.

**Circuit breaker**: After 5 consecutive errors or timeouts, the bot is auto-disabled and the bot owner is notified.

**Event chain depth limit**: Events emitted by bot actions carry a depth counter. Chains are terminated at depth 3 to prevent infinite mutual bot loops. Each bot in the chain is tracked via `originBotIds` to prevent amplification (bot A cannot re-trigger itself through bot B). A single event can trigger at most 10 bots (breadth limit).

### 9.5 Sandboxing

Code execution for bots runs in ephemeral Docker containers with strict isolation:

| Control | Setting |
|---|---|
| Network | Completely disabled (NetworkMode: 'none') |
| Filesystem | Read-only root, tmpfs workspace (50MB), tmpfs /tmp (10MB) |
| Capabilities | All Linux capabilities dropped |
| Privilege escalation | Blocked (no-new-privileges) |
| User | nobody (UID 65534) |
| PID limit | 64 (prevents fork bombs) |
| Memory | 128MB hard limit, no swap |
| CPU | 0.5 CPU |
| Timeout | Configurable, default 30s, max 120s |
| Output | 1MB max per stream (stdout/stderr) |
| Cleanup | AutoRemove: true |

Supported languages: Python 3.12, Node.js 22, Bash (Alpine).

### 9.6 SSRF Protection for Bot HTTP Requests

Bots making outbound HTTP requests are subject to:
- Domain allowlist (configured per bot, empty means blocked).
- Pre-flight DNS resolution with private IP check (blocks 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, link-local, loopback, CGNAT, etc.).
- HTTPS/HTTP only (no other protocols).
- Redirect following disabled.
- 30-second timeout per request.

### 9.7 Bot Secret Storage

Bot API keys and secrets are encrypted at rest in the database using AES-256-GCM with 12-byte IV and 16-byte auth tag. The encryption key is derived via scrypt from the `BOT_MASTER_KEY` environment variable. Fields with names ending in secret, password, token, apikey, api_key, auth_key, private_key, or encryption_key are auto-detected as secrets. API responses show redacted placeholders.

---

## 10. Key Design Decisions

### Local-First with Optional Server Sync

All data is stored in IndexedDB first. The server is optional -- users can run the app as a standalone browser extension without any server. When a server is connected, the sync engine handles bidirectional change propagation. This enables offline work and air-gapped deployments while still supporting team collaboration when needed. Client-side encryption protects data at rest even when syncing, as encrypted envelopes are sent to the server. Local-only folders can be excluded from sync entirely.

### Separate Admin Panel on a Different Port

The admin panel runs as a separate Hono app on port 3002 with its own CORS policy (same-origin only), its own JWT signing key, and its own user table. This allows the admin panel to be firewalled separately (e.g., only accessible from a management network) and keeps admin sessions independent from user sessions.

### In-Memory JWT Admin Signing Key

The admin JWT signing key is a random 32-byte value generated at startup and never persisted. All admin sessions are invalidated on server restart -- this is intentional. No key rotation mechanism is needed because a restart achieves it.

### EdDSA (Ed25519) for User JWT Signing

User JWTs are signed with EdDSA using Ed25519 key pairs. This provides smaller keys and signatures than RSA with fast signing and verification. Keys are configured via environment variables in PEM format.

### Drizzle ORM over Prisma/Knex

Drizzle ORM with the postgres.js driver provides a SQL-like TypeScript API that maps closely to actual SQL. It is lightweight with no binary engine dependency (unlike Prisma's Rust engine). Schema is defined in TypeScript with type-safe queries.

---

## 11. Data Pruning and Cleanup

A cleanup service runs on startup and every 6 hours to enforce retention policies:

| Data | Default Retention | Configurable |
|---|---|---|
| Notifications | 90 days | Yes (server setting) |
| Audit log entries | 365 days | Yes (server setting) |
| Soft-deleted entities (tombstones) | 90 days | Yes (server setting) |
| Orphaned investigation memberships | Immediate | No |
| Bot run history | 90 days | No |
| Expired sessions | Immediate (hourly cleanup) | No |
