# Changelog

## Unreleased

## v2.0.3 — 2026-11-18

Hardens CaddyAI chat, AgentCaddy agents, the supervisor and the agent bridge against instructions planted in investigation content (prompt injection). Each AI tool call is decided by where it reaches: a person approves every write into another investigation and every tool call that sends data off the device, apart from built-in vendor lookups and agents' fetches from a short list of reference sites. Changes AI makes inside an investigation that syncs still sync to its members. Settings → AI says where AI data goes. Also replaces the permanent offline strip. The server code is unchanged apart from its version, with no database migrations. See the [upgrade and channel notes](docs/releases/v2.0.3.md). The extension is released at 1.1.4.

### CaddyAI chat

- CaddyAI asks before it opens any web page. The card names the site and flags sites that are not built-in reference sites, addresses long enough to carry investigation data, and sites that are IOCs in the investigation.
- CaddyAI also asks before using skills, SIEM or ticket tools, changing agents, writing into another investigation, or reading other investigations from an investigation that can sync; that card says the conversation syncs to the investigation's members, or, while no team server is connected, that it stays on this device until one is. `create_in_investigation` matches an exact investigation name only.
- Local-only investigations are invisible to chat, agents and the agent bridge working in an investigation that can sync: they are not listed, searched or read.
- YOLO auto-approves only changes inside the conversation's investigation and built-in vendor lookups, and still asks for everything above. Its off position is labelled "Ask" instead of "Safe". Plan mode only reads: in an investigation, only that one; outside any investigation, any investigation except through the cross-investigation tools. It never fetches, uses skills or makes changes.
- The Act, Ask, YOLO and Plan tooltips say what still needs your approval in each mode, including in a conversation outside any investigation; in Plan mode, the Ask/YOLO tooltip says the switch applies only in Act mode.
- Approval cards queue one at a time ("1 of N") above the composer, say what each call reaches, keep the raw input under Details and flag calls taken from reply text. Enter no longer approves, Approve enables after half a second, and Escape in the card or the empty composer rejects. On short windows the card scrolls within its own area.
- A write card names the investigation the change lands in and whether it syncs to its members (while no team server is connected, that it stays on this device until one is), or says that a change outside any investigation stays on this device. In a conversation outside any investigation, that card asks "Approve a change outside any investigation?".
- An enrichment card whose IOC no enabled lookup applies to says that nothing is sent, and its title agrees.
- Chat works in the thread's own investigation, falling back to the selected one; `/fetch` files its note there, and so does **Export as note**, which used the selected investigation before.
- Skill and agent-host results in chat are capped at 50,000 characters before they reach the model or the saved conversation.
- A new conversation no longer says its messages are encrypted at rest. It says they are saved in this browser, that a conversation in an investigation that syncs is shared with its team server, and that each request goes where Settings → AI shows.
- Chat, agent-audit and meeting messages no longer load remote images or media; exec mode and shared chat links show images as links.
- Suggestion chips written by CaddyAI no longer run slash commands or carry @-mentions. An @-mention of a trashed entity, or of a local-only one from an investigation that can sync, is left unresolved.

### AgentCaddy

- Agents can no longer deploy, stop or run agents, create in other investigations, run remote commands, or read or change other investigations' entities (apart from Pattern Hunter's comparisons, below). Executives' spawn, define, dismiss and reflect actions wait for approval.
- Agents fetch automatically only from NVD, CVE, CWE, MITRE ATT&CK, CISA and FIRST (https, exact host), when the investigation allows fetches. Other fetches become proposals labelled "Fetch" with the destination; a proposal to visit a site that is an IOC in the investigation warns that it can alert the attacker.
- Without approval, agents run only the built-in vendor lookups (VirusTotal, AbuseIPDB, Shodan, URLhaus, ThreatFox, MalwareBazaar, GreyNoise). Team and community templates and Slack notifications need an approved proposal or a manual run. An enrichment proposal names the IOC value and every destination that approving it would contact, Slack and team templates included, or says that nothing is sent. SIEM and ticket tools are offered only to profiles that list them.
- An investigation's auto-approve settings limit every deployed agent; an agent's own settings can turn an action off, never on. The agent settings show what each agent asks before doing, and a one-time notice appears when the limit changes what a deployed built-in agent runs on its own.
- Only the agent with a pending proposal or question pauses, and the banner names it; the others keep working. A manual Run also runs waiting agents without queueing a repeated proposal twice. Agents no longer halve their cycle interval (down to 60 seconds) when nearly all their actions run.
- "Approve all" runs only routine actions inside the investigation. Fetches, vendor lookups, skills, agent changes, other investigations, supervisor proposals and calls taken from reply text are left for individual review.
- Pattern Hunter compares investigations only when deployed in a local-only investigation; in one that can sync, its card says the cross-investigation tools are off there. In a workspace never connected to a team server, investigation settings show a "Keep on this device" switch.
- AI tools cannot add an agent once 8 are active in the investigation, counting agents added in the panel, or add a profile that is already active, also when approvals run at the same time.
- Dismissing an agent rejects its pending proposals. A proposal from an agent no longer deployed in its investigation (dismissed, or removed in the panel) fails when approved on its own, and Approve all leaves it for review. An agent dismissed while its cycle runs stops after the call in progress: it runs no further tool, queues nothing and sends no further model request.
- An approved dismissal records a dated lesson in the dismissed agent's soul, without the reason or evidence, so the dismissal's text does not reach that agent's prompts in other investigations; the reason and evidence stay in the dismissal note in that investigation.
- Notes (including alert notes and note folders), tasks, IOCs and timeline events created by agents, the supervisor or the agent bridge record their creator on this device and carry an `ai-generated` tag that syncs. Entities created in chat stay attributed to the analyst, without the tag. Reports from `generate_report` carry the tag even when made in chat, and meeting minutes always carry it.
- The supervisor keeps its findings in a local-only "CaddyAgent Supervisor" investigation and never adopts one of that name that can sync. It asks before writing into other investigations and before any write taken from reply text, cannot reach the network or change agents, and shows an error toast when it cannot run.
- A supervisor proposal filed in another investigation carries a fixed note instead of the supervisor's reasoning, which stays in the CaddyAgent Supervisor investigation; an export of another investigation shows that note for older supervisor proposals too. `list_agent_activity` no longer returns supervisor proposals or server history.
- The Investigations hub's Supervisor Briefing and the AgentCaddy dashboard show the local-only supervisor investigation; an older or a teammate's "CaddyAgent Supervisor" investigation that can sync is listed as an ordinary investigation. The briefing card is translated.
- Escalated tasks are frozen to the supervisor and the agent bridge, as they are to agents.
- Approving a proposal that 2.0.3 no longer allows, for example one queued by 2.0.2, marks it failed with the reason in the analyst's language and runs nothing; a failed action shows its error as plain text rather than JSON. Approving an agent's question acknowledges it.
- An expanded agent proposal no longer hides part of its input without saying so.
- Agent actions read back from a team server are kept as history only and cannot be approved here; one still pending on the server is shown as rejected ("Server proposal not imported").
- Meetings use the current built-in agent personas, not copies stored by an earlier version. A meeting that cannot run says why and keeps the agenda and the request; a refused shift handoff says why.
- Agent prompts say that investigation text, tool results and web pages are data, not instructions. Built-in agents are told to research indicators with vendor lookups and reference sources, never the indicator's own host. An agent's prompt names only the host and local skills it is offered as tools.
- Review feedback kept in a delegated agent's working memory is cut on whole characters, so an emoji at the 500-character limit no longer breaks that agent's next request.
- Forensicate Scanner's check runs on this device and no longer contacts forensicate.ai. Like every agent, it sends what it reads to your AI model, and its description now says so.
- When every deployed agent is paused or resting, Run says that no deployed agent is active in this investigation.
- The AgentCaddy panel, its inbox and the sidebar's AgentCaddy status are in the analyst's language, including agent roles and statuses, counters with each language's plural forms, policy labels, refusals and the result of proposals rejected by a dismissal.

### AI routing and Settings

- The route Settings → AI shows is the route used by chat, agents, meetings and the supervisor. A local model with an endpoint is called directly, though chat titles and conversation summaries still go to it through the extension; Browser Extension and Team Server routing never fall back to the other; Auto uses the team server while signed in, otherwise the extension. With no route nothing is sent, and the reason is shown. The routing select shows "Auto" when no mode was chosen, and its help says that Auto uses the team server only while you are signed in and that a local model with an endpoint is always called directly.
- The chat status shows where this thread's prompts go: "Local LLM" for a local model with an endpoint, and "No connection" when there is no route.
- Settings → AI has a "Where AI data goes" section: the route for the local model and for cloud providers (naming the team server, and that its operator can read prompts, investigation content the AI reads and tool results, when requests go through it), whether web fetch is available, the agent bridge switch, and any named agent hosts with Remove.
- AgentCaddy shows its setup banner only when the agent cycle has no route for the model it will use, including an investigation's own agent model; with Team Server routing and no sign-in, it asks you to sign in.
- Supervisor, meeting and agent refusals, such as a missing API key or too few agents for a meeting, appear in the analyst's language.
- With the team-server route, chat thread titles and summaries of long conversations are skipped, because they can only use the extension. Requests to a local model with no API key carry no Authorization header.
- `/fetch` and `/stoploop` work with no AI route and over the thread's token budget. A `/loop` run with no route sends nothing, shows why, and runs again within the loop's interval once a route returns. `/loop` and `/stoploop` reply in the analyst's language.
- Settings → General → About shows the app version, and its local-first line says that AI requests also leave the browser, as Settings → AI shows.
- Local and agent-host skills no longer break Anthropic, OpenAI or Mistral requests: their names are aliased in transit.

### Web fetch, integrations and extension

- Web fetch (`fetch_url` and `/fetch`) refuses private, local, literal-IP, credentialed and over-2048-character addresses before contacting the extension, with translated messages.
- Web fetch needs the ThreatCaddy extension 1.1.3 or later, approved for this app, and is refused at once otherwise. ThreatCaddy checks the extension serving the page at every fetch, so a second, older ThreatCaddy extension that loaded first is refused too; the message says to keep only the newest and reload. The web fetch refusal and the Settings → AI fetch line say to install the extension from the ThreatCaddy releases on GitHub if the browser's store offers no update, and Settings → AI no longer shows an earlier result while the extension rechecks app approval.
- Extension 1.1.4 turns local-model text into tool calls only for an exact `<tool_call>` wrapper, advertises its guarded web fetch (`fetch_url_public_v1`), and leaves another ThreatCaddy extension's capabilities alone when that extension loaded first.
- Installing a team template creates it disabled and lists the domains it can contact.
- Integration runs by signed-in team users no longer post API keys to a missing team-server route; they use the extension or a direct request.
- The standalone file blocks remote images, audio and video in Chromium-based browsers.

### Agent bridge and agent hosts

- The agent bridge (`window.threatcaddy`, used by browser automation such as the Claude Code skill over CDP) is off by default; turn it on in Settings → AI. It works only in the investigation selected in ThreatCaddy (`setFolderId` now throws), offers 33 tools, and cannot fetch web pages, run enrichment, read or change other investigations, or change agents. `investigations()` lists every investigation's name, leaving out local-only ones while an investigation that can sync is selected, and now needs the nonce and the switch on. The bridge reports version 1.2.0; update copies of the Claude Code skill (`agents/claude-code`), because `tc investigations` from an older copy fails with "Invalid agent bridge nonce". `exec` refuses input that is not plain JSON.
- Named agent hosts can no longer be added or edited; Settings → AI lists them with Remove. Named hosts that use plain http on an address other than localhost, 127.0.0.1 or [::1] are no longer offered or called. Every agent-host or local-skill call that CaddyAI or an agent makes asks first, whatever action class the host declares. Skill descriptions and parameter schemas are sanitised and capped.
- CTI slash commands such as `/cti` and `/vt` need an agent host named `cti` kept from an earlier version; without one they say that no CTI sources are available. A `cti` host that uses plain http to another computer is not used, and they say it needs https.

### Offline use

- The hosted app no longer shows a permanent offline strip. A notice appears only while a slow first offline install runs ("Keep this tab open") or, dismissibly, when saving for offline use failed or is not possible in this browser. The notice for a browser that cannot keep ThreatCaddy offline says to export a JSON backup from Settings → Data.
- Settings → General has an "Offline use" row with the current status, and Settings → Data says that offline use is not a backup. The standalone file shows none of this.
- After an update, a view that can no longer load its code from the version the tab started with reloads the page once by itself, instead of staying on "Something went wrong". If it fails again, the error panel shows.

### Accessibility

- Screen readers announce approval cards and offline notices. The light-theme Approve label on approval cards is readable, raw tool input reads left to right in Arabic, Hebrew and Farsi, and agent proposal expand buttons have correct accessible names.
- The Ask/YOLO switch tells screen readers whether YOLO is on and what the current setting allows, not only through its hover tooltip.
- In Arabic, Hebrew and Farsi, @-mention prefixes and a sent `/fetch` command read left to right, and the investigation switches ("Keep on this device" and sync) move in the reading direction.

### Translation and layout

- Investigation details show their item counts and dates instead of raw `{{count}}` and `{{date}}` placeholders.
- The phone Analyst Mode banner, "Browse visible investigations" and "No tags yet" are translated.
- On phones, an agent proposal's header wraps instead of covering its status, the Approve all confirmation has its own row with larger buttons, and Settings → AI shows each configured agent host's URL on its own line.

## v2.0.2 — 2026-11-16

First release since 2.0.0. Version 2.0.1 was deployed to threatcaddy.com and published as the GHCR `latest` server image on 15 November 2026, but its downloads were never released; an independent review then found regressions in it, which this release fixes. 2.0.2 includes every 2.0.1 change. See the [upgrade and channel notes](docs/releases/v2.0.2.md). The extension remains independently versioned at 1.1.3.

### Backup, restore and data safety

- Backups work again in workspaces affected by non-numeric AI token usage, deleted meeting minutes or agent threads, workspace-recovery restores, or unsupported values written by AI tools (within the 50 MiB backup limit). A one-time local repair runs after unlock, never blocks the workspace from opening, and restored recovery archives are repaired immediately. An IOC whose stored type cannot be mapped is named in the backup error so the analyst can correct it.
- AI tools normalise spellings such as 'High' or 'lateral_movement' and refuse other unsupported priorities, statuses, confidence levels and event types instead of storing them. Export Investigation refuses to write a file its own import would refuse, including over 50 MiB.
- Restoring or importing a backup in a workspace connected to a team server never sends deletions or rollbacks to teammates. Sync pauses until the user reconciles in Settings → General → Sync history recovery; a restore that would delete records with unsent sync changes, or items sync is holding back on this device, is refused, names them and says how to proceed. The Sync history recovery panel and sync pause messages are translated.
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
- Sample tags and timelines stay on the device, including ones an older build had queued, and never become the default timeline for new events, clips or imports.

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

- Keyboard focus indicators reach 3:1 in every colour scheme and theme, and scheme-coloured text stays readable on selected items. In the light theme, amber notices and the sync banner are readable, and while the session-lock warning is shown, open dialogs stop hiding the rest of the page from assistive technology. Dialogs keep the cursor in their first field and return focus to the button that opened them.
- Contrast, quick-link targets, landmarks and headings are corrected; startup locales are bundled and unopened sharing UI is deferred.
- Returning visitors who open the Privacy Policy now see it (also offline) instead of the app, and translation updates reach non-English users after a deploy.
- Whiteboards drop generated-HTML `iframe` elements, and notes, clips and fetched pages can no longer inject `<style>` or arbitrary class names into the app.

### CI and release

- Browser acceptance runs as one job per browser with timing margin, keeps original failure traces and still fails when a test passes only on retry. The standalone file is tested in Chromium and WebKit. Verified client and server artifacts are kept for 90 days.
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
