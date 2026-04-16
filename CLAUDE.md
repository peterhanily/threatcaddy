# ThreatCaddy — Claude Code Guidelines

## What This Is

ThreatCaddy is a client-side threat intelligence and incident response platform. Chrome extension + React SPA + optional team server. All investigation data lives in IndexedDB via Dexie. The extension proxies LLM API calls and handles CORS-bypassing fetches.

## Architecture

- **SPA**: React + TypeScript + Vite + Tailwind. Entry: `src/App.tsx`
- **Database**: Dexie (IndexedDB). Schema: `src/db.ts`. Currently version 27.
- **Extension**: `extension/src/` — `background.js` (LLM streaming, fetch proxy, notifications), `bridge.js` (page↔extension message relay), `content.js` (capture UI)
- **Team Server**: `server/` — Hono + Drizzle + PostgreSQL. Syncs investigations, runs server-side agents, manages bots.
- **CaddyAI Chat**: `src/components/Chat/ChatView.tsx` + `src/hooks/useLLM.ts`. Human-driven conversational AI. Stays mounted in background when switching tabs.
- **AgentCaddy**: `src/components/Agent/` + `src/lib/caddy-agent*.ts` + `src/hooks/useCaddyAgent.ts`. Autonomous multi-agent system.

## Agent System

### 17 Builtin Profiles (`src/lib/builtin-agent-profiles.ts`)
**Executive (can dismiss/spawn agents):** CISO, Chief of Staff
**Leadership:** Lead Analyst
**Security Specialists:** IOC Enricher, Timeline Builder, Hypothesis Writer, Threat Hunter, Malware Analyst, Network Forensics, Digital Forensics, Vulnerability Analyst
**Business Stakeholders (observer):** Legal Counsel, Compliance Officer, Communications Lead, Business Continuity
**Cross-Case (specialist role):** Pattern Hunter, Reporter
**Security:** Forensicate Scanner

> Hypothesis Writer reuses the `ap-case-analyst` profile id (preserves user state). The 2026-04-16 audit (`claudewiki/wiki/concepts/agentcaddy-profile-audit.md`) walks the reasoning. Pattern Hunter dropped `lead` → `specialist` because `executeDelegateTask` is single-folder-scoped — the lead-only delegation tools couldn't usefully delegate cross-case findings.

### Key Concepts
- **Profiles** (`AgentProfile`): Reusable config with role (executive/lead/specialist/observer), systemPrompt, allowedTools, policy, readOnlyEntityTypes, optional `soul` (cross-investigation identity).
- **Deployments** (`AgentDeployment`): Profile assigned to an investigation. Each gets its own audit ChatThread. Supports competitiveness (cooperative/competitive/independent), shift state (active/resting), and explicit `handoffState` (client/handoff-pending/server/reclaim-pending).
- **Tool allowlist**: `buildAgentToolset` in `caddy-agent.ts` is the single source of truth for the LLM-visible tool list AND the runtime authorization gate — they can't drift. Locked down by 9 invariant tests in `src/__tests__/agent-toolset.test.ts`.
- **Execution**: `caddy-agent-manager.ts` runs deployments in parallel (max 5 concurrent) via `Promise.allSettled`. Skips deployments where `shouldBlockNewCycle()` is true (server owns it, or client hasn't reconciled). Falls back to legacy single-agent mode when no deployments exist.
- **Delegation**: Lead/executive agents get `delegate_task` + `list_agent_activity` + `review_completed_task` tools. `review_completed_task` requires a structured `requestedDelta` on reject and auto-escalates after 3 rejections (Task gains `rejectionCount`, `rejectionHistory`, `escalated`). Escalated tasks are frozen to all agents at the dispatcher layer in `llm-tools.ts`.
- **Meetings**: `caddy-agent-meeting.ts` — round-robin discussion with a `MeetingPurpose` (`redTeamReview` / `dissentSynthesis` / `signOff` / `freeform`). Structured purposes hard-cap at 2 rounds. Per-turn `[[confidence=N]]` tag drives early termination. Synthesizer emits a JSON artifact matching the purpose's schema, persisted on `AgentMeeting.structuredOutput`.
- **Handoffs**: `runHandoffCall` for shift swaps. Client↔server handoff goes through the explicit `handoffState` machine in `src/lib/agent-handoff.ts` (legal-edges table; transition helpers `markHandoffPending` / `markServerOwned` / `markReclaimPending` / `markClientRecovered` / `reconcileAfterHandoff` / `acknowledgeReconciliation`).
- **Idempotency**: auto-executed write tool calls carry an `idempotencyKey` (`${deploymentId}:${cycleStartedAt}:${toolName}:fnv1a(args)`) so client crashes and handoff boundaries can't double-write.
- **Supervisor**: `caddy-agent-supervisor.ts` — global cross-investigation analysis on a timer. Rolling retention of 200 newest notes; 3 `create_note` calls per cycle.
- **Server-Side**: `server/src/bots/caddy-agent-bridge.ts` converts profiles to BotConfig. `heartbeat-manager.ts` manages client→server handoff (30s heartbeat, 90s grace). Client-side `useServerAgents` (`src/hooks/useServerAgents.ts`) wires heartbeat success/failure into the handoff state machine. **Known gap:** the server bot manager only inserts into `bot_runs`, not `agent_actions`, so the client's "pull what the server did while away" loop currently reads an empty source — see `claudewiki/wiki/concepts/agentcaddy-server-action-gap.md`.
- **Policy**: 6 action classes (read/enrich/fetch/create/modify/delegate) with per-class auto-approve toggles. `delegate` is always auto-approved (covers `delegate_task`, `review_completed_task`, `reflect_on_performance`) so a locked-down policy can never silently break lead→specialist handoff. Runtime enforcement comes through `buildAgentToolset` (above) and `readOnlyEntityTypes` checks in `caddy-agent.ts`.
- **Metrics**: `AgentMetrics` on deployments tracks `cyclesRun`, `toolCallsExecuted/Proposed`, `tokensUsed` (in/out), `costUSD` (via `model-pricing.ts`), `toolCallHistogram`, `errorHistogram`, `cyclesByOutcome` (success/timeout/error/policyDenied), `tasksEscalated`. Per-cycle `AgentCycleSummary` is persisted on the audit `ChatMessage.agentCycleSummary` and rendered inline by `AgentCycleSummaryCard`.
- **Adaptive Scheduling**: High success rate = shorter intervals, low success = throttled.
- **Agent Hosts**: `src/lib/agent-hosts.ts` — external REST API endpoints exposing skills. Config in `Settings.agentHosts`. Skills discovered via `GET /skills`, executed via `POST /execute`. Dynamic tool names: `host:<name>:<skill>`. Policy integration via `getHostSkillActionClass`. UI in `Settings > AI > Agent Hosts`.

### Agent Prompts
Agent prompts must be lean (~500-800 chars). Do NOT use the full CaddyAI system prompt (6K+ chars). Agent-specific context is built in `buildAgentSystemPrompt` with investigation name/description and entity counts only.

## Notes
- Notes support sub-folders: `parentNoteId` (parent folder-note ID) and `isFolder` (marks as folder container)
- NoteList renders folders as expandable sections with drag-to-folder support

## Key Patterns

- **Entity types**: Note, Task, Folder (investigation), Tag, TimelineEvent, Timeline, Whiteboard, StandaloneIOC, ChatThread, AgentAction, AgentProfile, AgentDeployment, AgentMeeting
- **Hooks**: Each entity type has a `useX()` hook. Hooks own CRUD + reload logic.
- **Tools**: 46 LLM tools in `TOOL_DEFINITIONS` + 7 delegation tools in `DELEGATION_TOOL_DEFINITIONS` + 5 executive tools in `EXECUTIVE_TOOL_DEFINITIONS` = 58 total. Executor in `src/lib/llm-tools.ts`.
- **Backup/Export**: Every new Dexie table must be added to `backup-data.ts`, `backup-restore.ts`, `backup-crypto.ts`, and `export.ts` (including sanitizer + import).
- **Templates**: NoteTemplate, PlaybookTemplate, AgentProfile all follow the same pattern: builtin (source='builtin', read-only) + user (source='user', full CRUD).
- **Extension messaging**: Page posts `TC_*` messages → bridge.js relays to background.js via ports → background.js makes API calls → results flow back.
- **Local LLM**: `sendDirectToLocal` in `llm-router.ts` bypasses extension entirely for local endpoints (Ollama, vLLM, etc.). Handles SSE streaming + text-based tool parsing fallback.
- **ChatView persistence**: Always mounted (CSS hidden when not active) so streaming continues in background.

## Pre-Commit Checks

Always run `pnpm lint` and `pnpm build` before committing. Fix lint errors (especially unused imports). Run `pnpm test:run` if touching tests, exports, DB schema, or tool definitions. Server builds via `tsc` in the workspace build.

## When Adding New Dexie Tables

1. Add type to `src/types.ts`
2. Add EntityTable to `src/db.ts` type declaration
3. Add version N+1 with `.stores({})` in `src/db.ts`
4. Add to `backup-data.ts` (full, investigation, differential, count)
5. Add to `backup-restore.ts` (`SYNCED_TABLES`)
6. Add to `backup-crypto.ts` (`BackupPayload.data`)
7. Add to `export.ts` (`exportJSON`, `importJSON`, sanitizer, `ExportData` type)
8. Update `db.test.ts` version assertion
9. Update `export.test.ts` import count assertions
10. Add cascade cleanup in `useFolders.ts` `deleteFolderWithContents`

## When Modifying Builtin Agent Profiles

Builtin profile ids are stable user state — existing deployments reference them. **Never delete a builtin profile id** unless you've confirmed no user can have a deployment pointing to it (effectively never).

To "retire" a profile, **reframe it instead**: keep the id, change the i18n keys (or rename them and let the old keys fall through), update the `systemPrompt` / `allowedTools` / personality. Hypothesis Writer (`ap-case-analyst`) is the canonical example — see the audit at `claudewiki/wiki/concepts/agentcaddy-profile-audit.md`.

When changing a profile's persona:
1. Update or add new i18n keys in `public/locales/en/agent.json`
2. Patch the other 19 locales (`scripts/patch-hypothesis-writer-i18n.mjs` is the reference pattern when `ANTHROPIC_API_KEY` is unavailable)
3. Update the profile listing block in this file

## When Adding New Tools

1. Add definition to `src/lib/llm-tool-defs.ts` (`TOOL_DEFINITIONS`, `DELEGATION_TOOL_DEFINITIONS`, or `EXECUTIVE_TOOL_DEFINITIONS`)
2. Add action class mapping to `src/lib/caddy-agent-policy.ts`
3. Add executor case to `src/lib/llm-tools.ts` switch statement
4. Add to `WRITE_TOOLS` set if it modifies data
5. Update `llm-tools.test.ts` tool count assertion
6. Add to relevant agent profile `allowedTools` arrays in `builtin-agent-profiles.ts`

## When Adding New i18n Keys

The app is translated into 20 languages. Whenever you add new keys to any `public/locales/en/*.json` or `extension/src/_locales/en/messages.json`:

1. Add the English key/value as normal
2. Run `pnpm translate:sync` to fill in the new keys across all 20 languages (only adds missing keys, preserves existing translations)
3. Commit the updated locale files alongside your code change

To preview what's missing without translating: `pnpm translate:sync:dry`

To sync a single namespace only: `node scripts/translate-i18n.mjs --sync --ns <namespace>`

**Do not** run `pnpm translate` (without `--sync`) on existing locale directories — it will skip already-translated files by default, but `--force` would overwrite human-corrected translations.

Note: `pnpm translate:sync` requires `ANTHROPIC_API_KEY`. If unavailable, translate the new keys inline using agents (read the en file, write the translated values directly into each language file).

## Git Workflow

Commit and push after completing implementation unless told not to. When modifying `extension/src/`, rebuild extension zips via `pnpm build:extension` and commit the zips.

## Workflow Rules

Complete the current task fully before moving on. Don't stop mid-task for unrequested reviews.
