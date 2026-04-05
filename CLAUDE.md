# ThreatCaddy — Claude Code Guidelines

## What This Is

ThreatCaddy is a client-side threat intelligence and incident response platform. Chrome extension + React SPA + optional team server. All investigation data lives in IndexedDB via Dexie. The extension proxies LLM API calls and handles CORS-bypassing fetches.

## Architecture

- **SPA**: React + TypeScript + Vite + Tailwind. Entry: `src/App.tsx`
- **Database**: Dexie (IndexedDB). Schema: `src/db.ts`. Currently version 25.
- **Extension**: `extension/src/` — `background.js` (LLM streaming, fetch proxy, notifications), `bridge.js` (page↔extension message relay), `content.js` (capture UI)
- **Team Server**: `server/` — Hono + Drizzle + PostgreSQL. Syncs investigations, runs server-side agents, manages bots.
- **CaddyAI Chat**: `src/components/Chat/ChatView.tsx` + `src/hooks/useLLM.ts`. Human-driven conversational AI. Stays mounted in background when switching tabs.
- **AgentCaddy**: `src/components/Agent/` + `src/lib/caddy-agent*.ts` + `src/hooks/useCaddyAgent.ts`. Autonomous multi-agent system.

## Agent System

### 17 Builtin Profiles (`src/lib/builtin-agent-profiles.ts`)
**Executive (can dismiss/spawn agents):** CISO, Chief of Staff
**Leadership:** Lead Analyst
**Security Specialists:** IOC Enricher, Timeline Builder, Case Analyst, Threat Hunter, Malware Analyst, Network Forensics, Digital Forensics, Vulnerability Analyst
**Business Stakeholders (observer):** Legal Counsel, Compliance Officer, Communications Lead, Business Continuity
**Cross-Case:** Pattern Hunter, Reporter
**Security:** Forensicate Scanner

### Key Concepts
- **Profiles** (`AgentProfile`): Reusable config with role (lead/specialist/observer), systemPrompt, allowedTools, policy, readOnlyEntityTypes
- **Deployments** (`AgentDeployment`): Profile assigned to an investigation. Each gets its own audit ChatThread. Supports competitiveness (cooperative/competitive/independent) and shift state (active/resting).
- **Execution**: `caddy-agent-manager.ts` runs deployments in parallel (max 5 concurrent) via `Promise.allSettled`. Falls back to legacy single-agent mode when no deployments exist.
- **Delegation**: Lead agents get `delegate_task` + `list_agent_activity` + `review_completed_task` tools.
- **Meetings**: `caddy-agent-meeting.ts` — round-robin discussion, produces meeting minutes Note.
- **Handoffs**: `runHandoffCall` — outgoing agents brief incoming agents, shift states swap.
- **Supervisor**: `caddy-agent-supervisor.ts` — global cross-investigation analysis on a timer.
- **Server-Side**: `server/src/bots/caddy-agent-bridge.ts` converts profiles to BotConfig. `heartbeat-manager.ts` manages client→server handoff (30s heartbeat, 90s grace).
- **Policy**: 5 action classes (read/enrich/fetch/create/modify) with per-class auto-approve toggles. Runtime enforcement of allowedTools and readOnlyEntityTypes in caddy-agent.ts.
- **Metrics**: `AgentMetrics` on deployments tracks cycles, tool calls, tokens.
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

## When Adding New Tools

1. Add definition to `src/lib/llm-tool-defs.ts` (`TOOL_DEFINITIONS`, `DELEGATION_TOOL_DEFINITIONS`, or `EXECUTIVE_TOOL_DEFINITIONS`)
2. Add action class mapping to `src/lib/caddy-agent-policy.ts`
3. Add executor case to `src/lib/llm-tools.ts` switch statement
4. Add to `WRITE_TOOLS` set if it modifies data
5. Update `llm-tools.test.ts` tool count assertion
6. Add to relevant agent profile `allowedTools` arrays in `builtin-agent-profiles.ts`

## Git Workflow

Commit and push after completing implementation unless told not to. When modifying `extension/src/`, rebuild extension zips via `pnpm build:extension` and commit the zips.

## Workflow Rules

Complete the current task fully before moving on. Don't stop mid-task for unrequested reviews.
