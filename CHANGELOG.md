# Changelog

## Unreleased

### Features

- **Open markdown files as notes** — Open `.md` and `.txt` files directly in the browser via `Ctrl+O` / `Cmd+O` file picker, drag-and-drop anywhere on the app, or the "Open File" item in the New dropdown menu. File name, size, and creation date are captured in the note title. IOCs are auto-extracted on import. Also registers as a PWA file handler for OS-level "Open with" support when installed.
- **AgentCaddy hardening pass (April 2026)** — six-phase architectural sweep grounded in 2025-2026 multi-agent failure research:
  - **Phase 0 — Observability**: per-cycle `AgentCycleSummary` (cost in USD, tool histogram, error histogram, outcome) emitted to the audit ChatThread and rendered inline. Per-deployment metrics now expose cost, tokens, and top-tool at a glance.
  - **Phase 1 — Safety holes**: new `delegate` action class so a locked-down policy never silently breaks lead→specialist handoff. Agent soul rendering uses control-char stripping + length caps instead of an ineffective word blocklist. Supervisor folder gets rolling retention (200 newest notes, 3-per-cycle quota). Observer-authored notes flagged `reviewRequired` for analyst review.
  - **Phase 2 — Tool surface**: extracted `buildAgentToolset` — one source of truth for the LLM-visible tool list and the runtime authorization gate. Closes the latent bug where a lead's role-granted `delegate_task` was offered in the prompt but rejected at runtime.
  - **Phase 3 — Delegation loop**: tasks gain `rejectionCount` / `rejectionHistory` / `escalated`. `review_completed_task` requires a structured `requestedDelta` on reject, refuses identical deltas, and auto-escalates after 3 rejections. Escalated tasks are frozen to agents — only humans can unstick.
  - **Phase 4 — Meeting discipline**: new `MeetingPurpose` enum (`redTeamReview` / `dissentSynthesis` / `signOff` / `freeform`). Structured purposes hard-cap at 2 rounds and emit a JSON artifact matching the purpose's schema. Per-turn `[[confidence=N]]` signal replaces the brittle string-match termination. Agent-authored meeting requests appear as a one-click queue in the meeting panel.
  - **Phase 5 — Handoff idempotency**: auto-executed write tools carry an `idempotencyKey` so client crashes and client↔server handoff boundaries can't produce double-writes. New explicit `handoffState` state machine on each deployment (client → handoff-pending → server → reclaim-pending → client) blocks new cycles while the server owns the loop. Heartbeat success/failure drives transitions automatically.
  - **Reconcile summary**: when the client reclaims a deployment, a `HandoffReconciliation` summarizing what the server did while away appears as a dismissable banner on the deployment card.
- **Hypothesis Writer profile** — replaces the old generalist Case Analyst persona. Generates 3-5 falsifiable working theories of the case as structured notes with claim, evidence (for/against), confidence, and how-to-test. Tagged with `hypothesis-status:<open|confirmed|refuted>` so the Lead can filter open theories.
- **Settings: CaddyLabs branding** — info dropdown gains a "CaddyLabs" link to caddylabs.io (Flask icon); Settings About block adds a tagline ("This is a CaddyLabs tool, made with love and tokens in Ireland.") with the link, translated across all 20 locales.

### Security

- **Server `/api/caddy-agents` authZ closures** — `/register`, `/unregister`, and `/heartbeat` now require `checkInvestigationAccess` before mutating bot configs or heartbeat rows. The April 12 audit covered `/status`, `/actions`, `/approve`, `/reject`, and `/trigger`; these three were missed and allowed an authenticated user to register/deregister server-side bots for investigations they couldn't read. `/unregister` by `deploymentIds` now re-checks access per-deployment's scope folders.
- **Agent Host error-body redaction** — `fetchHostSkills` in `src/lib/agent-hosts.ts` now strips `Bearer <token>`, `Authorization` headers, and common credential keys (`api_key`, `access_token`, `secret`, `password`) from upstream HTTP error bodies before raising them into tool results or audit logs. Upstream servers that echo the caller's auth header in 401/403 responses can no longer leak it through agent tool output. Error body also capped at 500 chars.

### Accessibility

- **Cycle-summary card expand button has an accessible name** — `AgentCycleSummaryCard` toggle previously carried `aria-expanded` but no `aria-label`, leaving screen readers to announce only the meta content next to it. Now labeled "Show/Hide cycle details" (translated across 20 locales).
- **Load more actions** — `AgentPanel` action feed previously computed `hasMore` but never exposed it; long investigations silently capped at 100 items. Replaced the static "Showing latest 100" text with a "Load more actions" button that bumps a per-investigation `pageCount` state. Resets to 1 on investigation switch.
- **Profile picker focus management** — `AgentProfilePicker` now captures `document.activeElement` on mount, moves focus to the close button when the modal opens, and restores focus to the opener on unmount. Previously focus stayed on whatever button was clicked behind the backdrop.

### i18n

- **AgentCaddy UI fully translated across 20 locales** — Phase 0-5 hardening shipped new surface area (`AgentCycleSummaryCard`, `AgentMeetingPanel` purpose picker, `AgentProfilePicker` deploy modal, `AgentPanel` approval-flow toasts + reconciliation banner, `AgentHostsConfig` form) that was English-only. 56 `agent.json` keys and 5 `settings.json` keys added and translated — outcome labels (complete/timed out/error/approval-gated), meeting purposes (red-team/dissent synthesis/sign-off/freeform) + hints, "Server ran N actions while away" banner, all error toasts, all picker group labels and buttons. `_one`/`_other` plural forms for counts. `OUTCOME_META` keys and `PURPOSES` arrays refactored to resolve labels at render time.

### Integrity

- **Idempotency key stability across property reordering** — `makeIdempotencyKey` now canonicalizes object property order before hashing, so `{a:1,b:2}` and `{b:2,a:1}` produce the same key. Without this, an LLM that re-emitted the same tool call with a different field order across a handoff boundary would defeat dedup and double-write. Array order is still sequence-sensitive by design. 6 unit tests lock the behavior.
- **Reconciliation banner reverts on server failure** — `AgentPanel` dismiss handler previously ran `setDismissedReconciliations` optimistically and left the UI dismissed even if `acknowledgeReconciliation` rejected, which drifted client state from the persisted `handoffReconciliation` on the deployment. Now reverts the set on error so the user can retry.
- **Agent Host delete requires confirmation** — trashing a host from Settings > AI > Agent Hosts now prompts before dropping the host and its cached skill list, matching the pattern `AgentProfileManager` uses. Single-click data loss fixed.

### Fixes

- **Keyboard shortcuts** — Synced shortcuts across both UI panels (Ctrl+/ modal and Settings), added missing entries (`Ctrl+O`, `Ctrl+\``, `Ctrl+/`, `Ctrl+B/I`)
- **Pattern Hunter role** — flipped from `lead` to `specialist`. The lead-only delegation tools couldn't usefully delegate cross-case findings (`executeDelegateTask` scopes to a single `folderId`). `create_task` is still in `allowedTools`, so follow-ups still work.
- **Meeting synthesizer purpose coercion** — `parseSynthesizerJson` was meant to force the requested purpose onto the parsed JSON but the spread order let the parsed value win. Fixed.

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
