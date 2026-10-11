# ThreatCaddy Architecture

ThreatCaddy consists of a local-first browser app, optional Chrome/Firefox extension, optional Team Server, and Agent Bridge integrations.

---

## 1. System Overview

ThreatCaddy is a local-first, team-capable threat intelligence workbench. Local investigation features work offline after the necessary assets are available, or from the standalone HTML file. Optional remote features require their configured services; a shared team server enables collaboration.

### Component Roles

| Component | Technology | Purpose |
|---|---|---|
| **Browser Client** | React, Vite, TypeScript, Dexie.js, PWA | Investigation workspace -- notes, tasks, timelines, IOCs, whiteboards, chat |
| **IndexedDB** | Dexie.js, versioned migrations | Local investigation storage; optional server-backed features have separate persistence. |
| **Encryption Middleware** | Web Crypto API (AES-256-GCM) | Transparent field-level encryption at rest in IndexedDB |
| **Browser Extension** | Chrome/Firefox MV3 | Web clipping and explicitly approved API proxy/URL fetching |
| **Team Server** | Hono framework, Node.js | REST API, WebSocket server, bot runtime, admin panel |
| **PostgreSQL** | Drizzle ORM | Shared data store for team mode |
| **Admin Panel** | Separate Hono app on port 3002 | Server-rendered HTML admin UI (users, bots, settings, audit) |
| **Bot Runtime** | In-process (BotManager) | Automated workflows triggered by events, schedules, webhooks |
| **Docker Sandbox** | dockerode | Isolated code execution for bots (Python, Node.js, Bash) |
| **Agent Bridge** | Chrome DevTools Protocol (CDP) | Programmatic access for AI agents to read/write investigation data |

---

## 2. Directory Layout

```
src/                    Browser application source
  components/           React components
  contexts/             React context providers
  hooks/                React hooks (data layer)
  lib/                  Business logic, tools, export/import
  types.ts              TypeScript interfaces
  types/                Additional type modules (integrations, etc.)
  workers/              Web Workers
  db.ts                 Dexie database schema

extension/              Chrome/Firefox extension source, manifests and build scripts

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

- **Folder (Investigation)** -- The top-level investigation container. Entities may belong to a folder or remain unfiled. Folders carry status (active, closed, archived), TLP/PAP classification, and closure resolution metadata.

- **Note** -- Rich Markdown content with automatic IOC extraction, inline annotations, and cross-entity links to tasks, timeline events, and other notes.

- **Task** -- Kanban-style work items with three columns (todo, in-progress, done). Supports priority levels (none, low, medium, high), inline checklists, and assignees.

- **TimelineEvent** -- Temporal records tagged with MITRE ATT&CK tactics, incident response phases, confidence levels, geographic context (latitude/longitude), and threat actor attribution.

- **StandaloneIOC** -- Indicators of Compromise spanning 13 types: ipv4, ipv6, domain, url, email, md5, sha1, sha256, cve, mitre-attack, yara-rule, sigma-rule, and file-path. Each IOC tracks status, enrichment data, and typed relationships to other IOCs.

- **Whiteboard** -- Excalidraw-based visual collaboration canvas for diagramming attack flows and relationships.

- **ChatThread** -- LLM conversation threads with tool-use support, enabling AI-assisted analysis within investigations.

### 3.2 Entity Relationships

All entities support cross-linking through `linkedNoteIds`, `linkedTaskIds`, and `linkedTimelineEventIds` arrays. IOCs use typed relationships with the following link types: resolves-to, downloads, communicates-with, drops, hosts, attributed-to, exploits, uses-technique, detected-by, alerts-on, and related-to.

### 3.3 Client-Side Storage (IndexedDB via Dexie)

The migration definitions in `src/db.ts` are authoritative. Tables include notes, tasks, folders, tags, timelineEvents, timelines, whiteboards, activityLog, standaloneIOCs, chatThreads, evidenceItems, templates, integrations, and internal sync, migration and clip-receipt records. The portable backup registry explicitly distinguishes supported portable content from runtime/internal state.

### 3.4 Server-Side Storage (PostgreSQL via Drizzle ORM)

The server's append-only migration history lives in `server/src/db/migrations/`. It includes synchronized entities and server-specific tables such as users, sessions, investigation_members, server_settings, allowed_emails, bot_configs, bot_runs, admin_users, activity_log, posts, reactions, notifications, files, saved_searches, integration_templates, and backups. Not every local runtime table is synchronized.

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

Local investigation work is stored in IndexedDB; a team server is optional. Team sync uses optimistic concurrency with exact version checks. Remote collaboration, provider calls and other configured network features still require their services to be reachable.

### 4.1 Push

The client sends bounded batches from `_syncQueue` to `POST /api/sync/push`. A request supplies the server history `generation` and up to 500 changes, with no repeated table/entity pair. Each change contains `table`, `entityId`, `op` (`put` or `delete`), a data object for puts, and a `clientVersion` baseline for existing rows. The server checks the current account, investigation scope and version under the same transaction as the write and ordered change log. Each result is accepted, rejected or a conflict; broadcasts follow commit.

### 4.2 Pull

Current clients use `GET /api/sync/pull?cursor=…&generation=…`. Cursors are decimal strings, not JavaScript numbers or timestamps. Each page returns flat entity changes, the next cursor, generation, `hasMore` and `serverTimestamp`. Authorization and the page watermark are read from one consistent database snapshot. A requested folder narrows the results; `metadataOnly=true` omits selected heavy fields, not all sensitive content. Deleted or moved-out entities can be represented by minimal tombstones.

A changed history generation or a cursor ahead of the server returns `409 SYNC_CURSOR_RESET` with `resetRequired: true`. The client pauses for explicit recovery rather than silently resetting its cursor. The legacy `since` request remains available, but returns a full currently visible resync, not a timestamp-based incremental page.

### 4.3 Snapshot

`GET /api/sync/snapshot/:folderId` returns a currently authorized investigation as a map of tables to rows. This is not a portable backup or permission to overwrite pending local work. Current client recovery also checks workspace identity and history generation; see [server sync recovery](../server/docs/sync-recovery.md).

### 4.4 Conflict Resolution

Updates use compare-and-swap, not last-writer-wins: an existing entity's `clientVersion` must equal its current server version. An accepted write advances that version; a stale or missing baseline returns the current server row as a conflict. A new put accepts an absent or zero baseline. Choosing "mine" retries against the reviewed version, so another intervening server edit can conflict again. Choosing "theirs" applies the reviewed server state with local pending-work checks.

Server-managed fields (id, createdBy, updatedBy, version, createdAt, updatedAt, deletedAt) are stripped from client payloads and never trusted from the client. Delete operations use soft-delete (setting `deletedAt` and bumping the version) so other clients discover deletions on their next pull.

### 4.5 Offline Support

Dexie DBCore middleware captures eligible local writes in `_syncQueue` in the same transaction as the entity change. A queue failure aborts the entity write. Capture requires a durable server/account binding and continues while signed out; transport separately requires that exact active identity. Local-only investigations and unfiled scoped entities are excluded. When local encryption is enabled, the outbox's content payload is covered by the encryption middleware too.

Committed writes wake the sync engine, with periodic retries as a safety net. Pull, push and acknowledgement handling fence the workspace/session generation and preserve queued local work. Existing workspaces with potentially incomplete historical capture pause before remote application or transmission. Reconciliation requires a verified encrypted archive, reads current rows instead of replaying stale queued bodies, retains recorded deletes and blocks ambiguous missing put targets. It cannot reconstruct deletions that were never recorded. Clip-delivery receipts are local import metadata, not sync history. See [backup and recovery](backup-recovery.md).

### 4.6 Authorization on Push

- All public pushes require a current active admin or analyst account and valid data/version baselines. Global tables (tags, timelines) do not require investigation membership, but do not bypass those checks.
- Folder-scoped writes require current editor access to live source and destination investigations. Ordinary folder deletion and restoration require an eligible owner; a separate confirmed admin purge is a physical deletion, not device erasure.
- New folders auto-create an owner membership for the creating user.
- Folders marked `localOnly` (and their scoped entities) are excluded from capture. This setting does not erase copies previously shared with other devices or exported.

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

Covered content fields in IndexedDB can be encrypted at rest using AES-256-GCM. This is field-level protection, not whole-profile encryption: record identifiers, indexing metadata and configuration outside the encryption registry remain readable. The key hierarchy:

1. **Master key** -- Random AES-256-GCM key generated once. Passphrase-wrapped and recovery-wrapped copies, with their salts, are stored in workspace-scoped localStorage metadata.
2. **Wrapping key** -- Derived from user passphrase via PBKDF2 (600,000 iterations, SHA-256).
3. **Session key** -- Unwrapped master key used in memory. Depending on the chosen session duration, raw key bytes may also be cached in workspace-scoped sessionStorage for refreshes (never for the every-load option; timed cache duration is capped at eight hours). Browser session restoration can preserve sessionStorage; explicit locking clears the cache. This is not protection from scripts running in the unlocked app or from a compromised browser profile.
4. **Recovery phrase** -- 24-word BIP39-style phrase (192 bits of entropy) for passphrase recovery.

Each encrypted field gets its own random 96-bit IV. The encryption middleware is installed as a Dexie DBCore middleware, transparently encrypting on mutate (add/put) and decrypting on get/getMany/query and cursor reads. It uses `Dexie.waitFor()` to keep IDB transactions alive during async Web Crypto operations.

The field registry in [`src/lib/encryptionMiddleware.ts`](../src/lib/encryptionMiddleware.ts) is authoritative. It covers content in notes, tasks, evidence, timelines, IOCs, whiteboards (including embedded files), chat and agent records, templates, checkpoints, integration records and queued sync payloads. Operational metadata remains plaintext by design. Enable/disable and unlock-time coverage upgrades complete before normal app access; this does not encrypt historical exports, server copies or arbitrary browser storage.

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

Entity-change messages are wake-up hints: `applyRemoteChange()` requests the normal generation-checked sync cycle instead of applying the WebSocket payload directly. Current access is rechecked before scoped delivery; a subscription is not a permanent authorization grant.

---

## 7. Export and Import Formats

ThreatCaddy supports multiple interchange formats for interoperability with other threat intelligence tools.

| Format | Direction | Description |
|---|---|---|
| JSON | Import/Export | Portable backup of 19 supported entity tables, or single-investigation export; operational sync/receipt stores and credentials are not a raw database dump |
| CSV | Export | IOC export with configurable column selection |
| STIX 2.1 | Import/Export | Full bundle with Indicator SDOs, Vulnerability SDOs, Relationship SROs, and TLP markings using official OASIS UUIDs |
| MISP | Import/Export | Event-level export and import with attribute type mapping |
| Markdown | Import/Export | Individual note export; import from Markdown files via file picker (`Ctrl+O`), drag-and-drop, or PWA file handler |
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
| integration | Legacy records retained; server runtime unavailable |
| custom | User-defined logic |

The legacy server integration runner and server-side AgentCaddy handoff are unavailable; their saved records/history are retained, not silently executed. Bot projections expose `runtimeAvailable` / `unavailableReason`, and enabling an unavailable runtime is rejected. The separate, explicitly invoked client integration engine remains supported; see [integration platform](integration-platform.md).

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

Investigation data is stored in IndexedDB first. The server is optional: users can run the hosted web app or standalone HTML without a team server. When a server is connected, the sync engine handles bidirectional change propagation. Client-side encryption protects covered fields in the local database at rest, but middleware decrypts those fields before the sync engine reads them. Team sync sends readable entity values, not end-to-end encrypted envelopes. Trust and secure the team server and its backups independently; use HTTPS for transport. Local-only folders can be excluded from sync. Offline copies, exports and historical server records have separate retention lifecycles.

### Separate Admin Panel on a Different Port

The admin panel runs as a separate Hono app on port 3002 with its own CORS policy (same-origin only), its own JWT signing key, and its own user table. This allows the admin panel to be firewalled separately (e.g., only accessible from a management network) and keeps admin sessions independent from user sessions.

### In-Memory JWT Admin Signing Key

The admin JWT signing key is a random 32-byte value generated at startup and never persisted. All admin sessions are invalidated on server restart -- this is intentional. No key rotation mechanism is needed because a restart achieves it.

### EdDSA (Ed25519) for User JWT Signing

User JWTs are signed with EdDSA using Ed25519 key pairs. This provides smaller keys and signatures than RSA with fast signing and verification. Keys are configured via environment variables in PEM format.

### Drizzle ORM over Prisma/Knex

Drizzle ORM with the postgres.js driver provides a SQL-like TypeScript API that maps closely to actual SQL. It is lightweight with no binary engine dependency (unlike Prisma's Rust engine). Schema is defined in TypeScript with type-safe queries.

### Startup, Offline Installation and Performance Checks

Hosted builds preserve the natural dynamic-import graph. Whiteboard, graph and map engines are deferred; event maps load only when coordinates are displayed. `build/startup-budget.ts` checks the complete static entry dependency graph, raw/gzip JavaScript and CSS budgets, and the service worker's per-chunk precache limit. It fails builds if a heavy feature becomes eager. Its test metadata stays in ignored `node_modules/.cache/threatcaddy/`, not the published site. Browser tests then open the actual lazy features and check persistence and rendering.

The PWA still precaches its packaged module graph and fonts, including CJK subsets, for offline use. This background download is larger than foreground startup. The passive offline notice observes the existing worker's installation state without changing registration, requesting persistence, clearing caches or reloading unsaved work. An installed worker indicates that a matching worker has activated, not an integrity check, a guarantee of the newest release, or a backup. Browsers can evict storage; remote services still need connectivity. The self-contained standalone edition does not use this hosted-worker notice.

For reproducible local lab measurements, build the hosted app and run `node scripts/measure-startup.mjs --dir dist --out /tmp/threatcaddy-startup.json`. It uses disposable Chromium contexts, a gzip loopback server, cold and HTTP-cache-warm visits, and a fixed throttled mobile profile. Service workers are blocked in this measurement to isolate foreground startup. These synthetic results are not real-user percentiles or field INP. Real installed/offline behavior has separate browser acceptance tests.

IOC extraction uses an exact-input/options cache with eight LRU entries and a total two-million UTF-16-code-unit retention budget. Results returned to callers are copied; oversized inputs still extract normally but bypass caching. The budget is a retained-string bound, not an exact heap-byte measurement.

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
