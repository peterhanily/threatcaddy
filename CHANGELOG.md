# Changelog

## Unreleased

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

Use the recorded Node 24.21.0 / pnpm 10.29.1 / npm 11.19.0 baseline. Coordinate client and team-server upgrades, preserve the existing credential-encryption key and retain a verified database-and-files backup. Publishing a server image does not update a running deployment. See [deployment](docs/deployment.md), [runtime operations](server/docs/runtime-operations.md), [backup recovery](docs/backup-recovery.md) and [verification](docs/development-verification.md).

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
