# Changelog

## Unreleased

## v2.0.2 — 2026-11-16

First release since 2.0.0. Version 2.0.1 was deployed to threatcaddy.com and published as the GHCR `latest` server image on 15 November 2026, but its downloads were never released; an independent review then found regressions in it, which this release fixes. 2.0.2 includes every 2.0.1 change. See the [upgrade and channel notes](docs/releases/v2.0.2.md). The extension remains independently versioned at 1.1.3.

### Backup, restore and data safety

- Backups work again in workspaces affected by non-numeric AI token usage, deleted meeting minutes or agent threads, or workspace-recovery restores (within the 50 MiB backup limit). A one-time local repair runs after unlock, and restored recovery archives are repaired immediately.
- Restoring or importing a backup in a workspace connected to a team server never sends deletions or rollbacks to teammates. Sync pauses until the user reconciles in Settings → General → Sync history recovery; a restore that would delete records with unsent sync changes is refused and changes nothing.
- Export Investigation files carry a `threatcaddy-investigation` format marker and, like older single-investigation files, always merge: importing one can no longer delete other investigations. 2.0.0 rejects the marked files, and backups that contain AI-delegated tasks.
- Backups and investigation exports that carry sync revision metadata import again, and failed backups name the table, field and record that blocked them.
- Accepted sync responses and conflict resolution keep device-only task, note, IOC, timeline, whiteboard and chat fields. The app warns that team sync is partial and offers a backup before local removal.

### Team sync

- A server change this device cannot read is skipped and named in the sync banner while everything else keeps syncing. The server rejects an invalid change on its own instead of failing the whole upload.
- Agent delegation no longer stores agent IDs as task assignees, which made every upload fail; the server stores a non-user assignee as empty.
- Share links no longer carry assignees or agent IDs, and investigation links include only the tags their records use.
- Evidence with BMP or AVIF previews stays on the device and is named in the banner instead of being resent and refused on every cycle. Sync pauses while the workspace is locked.

### Evidence import

- Document parsing runs in cancellable workers with input, entry and decompression budgets, and a batch is committed atomically.
- PDFs with screenshots or many images, very long PDFs and large workbooks import again, partially with a warning, instead of failing the whole batch. Encrypted, damaged or truncated Office files and images over 32 megapixels import as metadata only. Decompression stays bounded: oversized parts are cut, and archives with too many entries, too much compressed data or sizes that do not match their contents reject the batch.
- Evidence import works in the standalone file in Safari and other WebKit browsers.
- Imports are no longer cancelled when AI agents, CaddyAI or a sync pull reload chats or evidence. Errors are translated and name the file; the drop zone states the limits (20 files and 50 MiB per import, 25 MiB per file).
- Spreadsheets with styled or merged empty cells keep their columns, and IOC extraction stays fast on long encoded strings.

### Samples and onboarding

- A realistic synthetic mailbox investigation is the default sample, with a first-investigation guide; the parody sample remains available and now uses reserved IP addresses and domains.
- Removing a sample always asks first and can keep the items the user added or changed by moving them to a new local investigation. A `?demo` link asks before adding a sample to a workspace that has the user's own investigations.
- Sample tags and timelines stay on the device and never become the default timeline for new events, clips or imports.

### Encryption and sessions

- Timed sessions (1, 8 or 24 hours) now lock open tabs at their deadline, including after resume; in 2.0.0 they only limited unlocking after a reload, to at most 8 hours. A two-minute warning accepts the passphrase to stay unlocked.
- Unsaved note and whiteboard drafts, chat drafts and interrupted chat output survive a lock; other unsaved form input is lost unless the passphrase is re-entered when the warning appears.
- Logout revokes server sessions after access-token expiry and reports when remote revocation cannot be confirmed. Choosing another server signs out of the previous one, Disconnect stays available while the server is unreachable, and Start Fresh on the lock screen also signs out of the team server.

### Team server and operations

- The server image runs on the Node 24.22.3 security release with Hono 4.13.18 (GHSA-39q9-qp46-w8xg) and Alpine zlib 1.4-r0 or later. It contains no npm, npx, Yarn or Corepack (use the packaged `node dist/...` commands), sets `NODE_ENV=production` (error responses no longer echo exception messages, including for client errors) and declares a `/health` HEALTHCHECK. The tracked Compose file rotates server and database logs with the `json-file` driver.
- File, backup and sync uploads are authenticated before their bodies are buffered. Request errors return a generic message, and request error logs record a failed query's SQLSTATE and driver message instead of its SQL text and parameters; a duplicate admin username returns 409.
- Login lockout counts failures per account and client address, so a stranger can no longer lock an account for 15 minutes when the server sees each client's own address (behind a proxy, set `TRUSTED_PROXY_IPS`). A per-account limit still slows distributed guessing (see the known limitations in the upgrade notes).
- The read-only viewer role can no longer post, pin, edit posts or upload server backups, and the app hides those controls. Downloads of files with non-Latin names work. Admin Sign Out revokes that administrator's tokens on the server.
- Administration binds to localhost by default and the Compose file publishes it only on host loopback. Docker deployments that do not use the tracked Compose file and need the admin panel must set `ADMIN_HOST=0.0.0.0` and publish `127.0.0.1:3002:3002`; on Kubernetes, leave `ADMIN_HOST` unset and use `kubectl port-forward`. Startup warns when `ADMIN_SECRET` is shorter than 24 characters, and the deployment guide no longer proxies administration publicly.
- A purged investigation's ID can no longer be re-created through sync. A purge still does not erase sync history, audit entries or database backups.
- The team-server AI proxy reports token usage as numbers, so agent cost counters no longer become invalid.

### Accessibility and interface

- Keyboard focus indicators reach 3:1 in every colour scheme and theme, and scheme-coloured text stays readable on selected items. Dialogs keep the cursor in their first field and return focus to the button that opened them.
- Contrast, quick-link targets, landmarks and headings are corrected; startup locales are bundled and unopened sharing UI is deferred.
- Returning visitors who open the Privacy Policy now see it (also offline) instead of the app, and translation updates reach non-English users after a deploy.
- Whiteboards drop generated-HTML `iframe` elements, and notes, clips and fetched pages can no longer inject `<style>` or arbitrary class names into the app.

### CI and release

- Browser acceptance runs as one job per browser with timing margin, keeps original failure traces and still fails when a test passes only on retry. Verified client and server artifacts are kept for 90 days.
- The image audit fails on fixable findings of unknown severity and on a vulnerability database older than 48 hours, and Dependabot proposes new Node base images. A release-channel checker verifies downloaded assets against the qualified build.

## v2.0.0 — 2026-11-03

Coordinated client/server release. See [upgrade notes](docs/releases/v2.0.0.md) for the sync protocol, account onboarding, credential and rollback changes. The extension is versioned separately at 1.1.3.

- Update reviewed client and server dependencies, including server TypeScript 7, while keeping Node API typings aligned with the supported Node 24 runtime.
- Consolidate dependency updates, group routine and security update proposals, and enable repository security/code scanning. Preserve the full verification and exact-artifact publication gates.
- Keep CTI code values literal when they contain backticks, and decode fetched extension text only once. Extension download artifacts advance to 1.1.3.

### Interface fixes

- Center sidebar tag, timeline and whiteboard deletion confirmations over the full window instead of clipping them to the sidebar.

### Request validation security

- Oversized HTTP bodies return a bounded `PAYLOAD_TOO_LARGE` error and explicitly close the HTTP/1 connection, preventing a follow-up request from reusing a socket that the server is still draining.
- Sync data now has bounded dictionary width, top-level field-name length, depth and aggregate traversal before schema cloning and service preparation. Service validation messages are bounded as well.
- Shared template IDs are restricted to safe path segments, and client deletion validates and encodes them. Invalid outer descriptions are rejected; duplicate shares return an explicit conflict without replacing the existing definition.
- Team catalogs retain valid rows while reporting invalid entries and load failures with a refresh action. Identical retained team definitions can be reinstalled without overwriting changed definitions or credentials.
- Team sync rejects batches over 500 changes before validating individual records, while retaining the 16 MiB request limit. Integration sharing rejects steps, outputs and triggers above 256 entries before preliminary element validation and still requires full graph compilation before storage.
- Malformed outer request bodies return validation errors, and validation details have fixed count and text limits. Isolated child-process checks cover large invalid requests, memory retention and successful follow-up requests.
- Team integration sharing sends the required request envelope and reads validated templates from the server's list response. Failed shares retain the local template and show the server's rejection reason.
- Update the Node 24 runtime and targeted dependency security patches. Required verification exercises native password hashing and image transformation inside the production server image. Weekly dependency-update proposals supplement the existing full-lockfile audit schedule.

### Data preservation and recovery

- Portable JSON backups cover all 19 supported entity tables, validate complete records before writes and preserve supported long text without silent truncation. Plaintext exports omit installed integration configuration; explicit encrypted exports can retain it. Restores suspend automation and report settings-only failures separately from committed entity writes.
- Import, restore and workspace-switch barriers protect pending edits. Unsent CaddyAI text and images remain attached to their conversation in memory across view changes; they are not crash recovery or part of a backup.
- Extension captures use explicit workspace confirmation and durable per-revision receipts. Retries do not create a second entity after a successful import, and failed captures remain available to retry.
- Bound workspaces capture eligible local changes while signed out without sending them to another account. Incomplete legacy sync history pauses for archive-backed reconciliation instead of silently replacing local data.
- Markdown/text opening supports the file picker, drag-and-drop and PWA launch delivery, with bounded queues, size limits and unlock-aware reads.

### Access and automation

- Team-server reads and writes recheck current accounts, memberships and investigation scope. Ordinary investigation deletion/restoration is owner-only; explicit admin purge remains separate. Physical server deletion does not revoke exported or offline copies.
- Bot reads, writes and scoped notifications use current grants and live investigation access. Admin AI writes require approval tied to the exact proposed action.
- The unsupported server integration runner and server-side AgentCaddy handoff remain unavailable; saved configuration and history are retained.
- Client integrations validate their graph and configuration before running, preserve typed substitutions and nested loop state, and enforce cancellation and work/data limits. Output counts reflect committed supported writes. Imported templates receive fresh identities; catalog collisions cannot silently replace installed definitions.
- Integration results remain visible when their source list row is virtualized or refreshed.

### Usability and accessibility

- Settings tabs support manual keyboard activation, directional navigation, Home/End and RTL layouts. Narrow-screen forms and named controls improve Settings, encryption, Exec and extension workflows.
- Dashboard quick links have separate keyboard controls for opening, editing and deleting, so editing or deleting cannot accidentally open the destination.
- Existing CaddyAI conversations retain their selected provider/model when server availability changes, without silently rerouting to a local provider.
- Product Composer uses localized controls and validation messages while preserving drafts on failed saves. Locale checks cover keys, interpolation and language-specific plural forms across the app and extension; automated checks do not certify translation fluency.
- Exec views provide useful empty states and return unfiled entity details to their global list.

### Performance and offline use

- IOC extraction uses an exact-input, bounded cache with isolated returned objects; different middle text cannot reuse a stale result.
- Heavy client views load on demand, while the hosted offline shell precaches its packaged assets. A passive status notice reports service-worker installation without reloading the page; it is not a backup, cache-integrity check or current-version guarantee.
- Team-feed clients can request bounded reply pages and viewer-only reaction summaries. Existing full-reply/full-reactor API behavior remains the default for callers that do not opt in.
- Build, locale, lint and runtime acceptance checks document reproducible release gates.

### Upgrade notes

Use the recorded Node 24.22.2 / pnpm 10.29.1 / npm 11.19.0 baseline. Coordinate client and team-server upgrades, preserve the existing credential-encryption key and retain a verified database-and-files backup. Publishing a server image does not update a running deployment. See [deployment](docs/deployment.md), [runtime operations](server/docs/runtime-operations.md), [backup recovery](docs/backup-recovery.md) and [verification](docs/development-verification.md).

---

## v1.0.0 — 2026-03-05

First stable release of ThreatCaddy — a local-first threat investigation workspace.

### Features

- **Investigation workspace** with notes, tasks, timeline events, IOCs, and whiteboards per investigation folder
- **IOC extraction** — automatic detection of IPv4/IPv6, domains, URLs, emails, MD5/SHA-1/SHA-256, CVEs, MITRE ATT&CK IDs, YARA rules, SIGMA rules, and file paths from any text
- **IOC relationship graph** — entity relationship visualization with Cytoscape, BFS shortest-path, and connectivity analysis
- **MITRE ATT&CK integration** — technique mapping on timeline events, Navigator layer export, CSV export
- **STIX 2.1 export** — indicators, vulnerabilities, relationships, reports with TLP marking definitions
- **Timeline view** — chronological event tracking with 19 event types aligned to ATT&CK tactics and IR phases
- **CaddyAI** — LLM-powered investigation assistant with 29 tools (search, create, update, link, analyze, fetch, report generation, cross-investigation analysis). Supports Anthropic, OpenAI, Google Gemini, Mistral, and local LLMs
- **Customizable CaddyAI system prompt** — editable in settings with CTI/IR tradecraft baked into the default (MITRE ATT&CK, Diamond Model, Kill Chain, Pyramid of Pain, estimative language, TLP/PAP)
- **Classification system** — TLP and PAP markings on all entities, screenshare mode to hide sensitive data
- **Browser extension** — clip text, selections, and full pages from any site. Right-click context menu and keyboard shortcuts. Chrome and Firefox support (Manifest V3)
- **Encryption at rest** — AES-256-GCM with PBKDF2 (600k iterations) key derivation, recovery keys, configurable session duration
- **Standalone HTML** — single-file offline version with all assets inlined, file:// protocol support
- **Team server** — optional self-hosted server for real-time sync, collaboration, presence, and encrypted backups (PostgreSQL + Hono + WebSocket)
- **Cloud backup** — encrypted backups to team server with full and differential modes
- **Whiteboard** — Excalidraw-based visual workspace per investigation
- **Activity log** — audit trail of all entity operations
- **Advanced search** — regex, boolean operators, saved searches across all entity types
- **Data import/export** — JSON, CSV, TSV, NDJSON import; JSON, CSV, Markdown, HTML report export
- **Geolocation** — optional lat/long on timeline events with Leaflet map view
- **Keyboard shortcuts** — customizable keybindings for common actions
- **PWA** — installable progressive web app with offline support via service worker

### Security Fixes (pre-release)

- Fix XSS vector in wiki link preprocessor — HTML-escape user input in `[[...]]` links before DOMPurify
- Fix sync errors silently swallowed — log enqueue failures instead of discarding
- Add IndexedDB quota exceeded detection — user-friendly error on storage limits during restore
- Fix WebSocket auth race condition — prevent stale token use with active-flag pattern
- Strengthen backup password requirement — minimum 12 characters (up from 8)
- Cap encryption session key cache TTL at 8 hours regardless of user setting
- Add aria-labels to IOC filter badges for screen reader accessibility

### Contributors

- Peter Hanily — creator, design, and development
- Adam Knopik — testing, feedback, and feature suggestions
- Colin Hanily — testing and quality assurance
- Brian Davies — testing, feedback, and feature suggestions
