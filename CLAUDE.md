# ThreatCaddy — Claude Code Guidelines

## What This Is

ThreatCaddy is a client-side threat intelligence and incident response platform. Chrome extension + React SPA + optional team server. All investigation data lives in IndexedDB via Dexie. The extension proxies LLM API calls and handles CORS-bypassing fetches.

## Architecture

- **SPA**: React + TypeScript + Vite + Tailwind. Entry: `src/App.tsx`
- **Database**: Dexie (IndexedDB). Schema: `src/db.ts`. Currently version 25.
- **Extension**: `extension/src/` — `background.js` (LLM streaming, fetch proxy, notifications), `bridge.js` (page↔extension message relay), `content.js` (capture UI)
- **Team Server**: `server/` — Fastify + SQLite. Syncs investigations across users.
- **CaddyAI Chat**: `src/components/Chat/ChatView.tsx` + `src/hooks/useLLM.ts`. Human-driven conversational AI.
- **AgentCaddy**: `src/components/Agent/` + `src/lib/caddy-agent*.ts` + `src/hooks/useCaddyAgent.ts`. Autonomous multi-agent system with profiles, parallel execution, delegation, and meetings.

## Key Patterns

- **Entity types**: Note, Task, Folder (investigation), Tag, TimelineEvent, Timeline, Whiteboard, StandaloneIOC, ChatThread, AgentAction, AgentProfile, AgentDeployment, AgentMeeting. All defined in `src/types.ts`.
- **Hooks**: Each entity type has a `useX()` hook (e.g., `useNotes`, `useTasks`, `useFolders`). Hooks own CRUD + reload logic.
- **Tools**: 31 LLM tools in `src/lib/llm-tool-defs.ts`. Executor in `src/lib/llm-tools.ts`. Read tools in `llm-tools-read.ts`, write tools in `llm-tools-write.ts`.
- **Backup/Export**: Every new Dexie table must be added to `backup-data.ts`, `backup-restore.ts`, `backup-crypto.ts`, and `export.ts` (including sanitizer + import).
- **Templates**: NoteTemplate, PlaybookTemplate, AgentProfile all follow the same pattern: builtin (source='builtin', read-only) + user (source='user', full CRUD). See `src/lib/builtin-agent-profiles.ts`.
- **Activity logging**: `useActivityLog` hook. Category + action + detail + optional entity reference.
- **Extension messaging**: Page posts `TC_*` messages → bridge.js relays to background.js via ports → background.js makes API calls → results flow back.

## Agent System

- **Profiles**: `AgentProfile` with role (lead/specialist/observer), systemPrompt, allowedTools, policy. 5 builtins.
- **Deployments**: `AgentDeployment` assigns a profile to an investigation. Each deployment gets its own audit ChatThread.
- **Execution**: `caddy-agent-manager.ts` runs all deployments in parallel via `Promise.allSettled`. Falls back to legacy single-agent mode when no deployments exist.
- **Delegation**: Lead agents get `delegate_task` + `list_agent_activity` tools.
- **Meetings**: `caddy-agent-meeting.ts` — round-robin discussion, produces meeting minutes Note.
- **Supervisor**: `caddy-agent-supervisor.ts` — global cross-investigation analysis on a timer.
- **Policy**: 5 action classes (read/enrich/fetch/create/modify) with per-class auto-approve toggles.
- **Tool parsing**: Agents parse tool calls from both structured `tool_use` blocks AND text fallback (`<tool_call>` tags, JSON blocks).
- **Prompt size**: Agent prompts must be lean (~500-800 chars). Do NOT use the full CaddyAI system prompt — it's 6K+ chars and blows the context with 31 tool schemas.

## Pre-Commit Checks

Always run `pnpm lint` and `pnpm build` before committing. Fix lint errors (especially unused imports). Run `pnpm test:run` if touching tests, exports, DB schema, or tool definitions.

## When Adding New Dexie Tables

1. Add type to `src/types.ts`
2. Add EntityTable to `src/db.ts` type declaration
3. Add version N+1 with `.stores({})` in `src/db.ts`
4. Add to `backup-data.ts` (full, investigation, differential, count)
5. Add to `backup-restore.ts` (`SYNCED_TABLES`)
6. Add to `backup-crypto.ts` (`BackupPayload.data`)
7. Add to `export.ts` (`exportJSON`, `importJSON`, `ExportData` type)
8. Update `db.test.ts` version assertion
9. Update `export.test.ts` import count assertions

## When Adding New Tools

1. Add definition to `src/lib/llm-tool-defs.ts` (`TOOL_DEFINITIONS` or `DELEGATION_TOOL_DEFINITIONS`)
2. Add action class mapping to `src/lib/caddy-agent-policy.ts`
3. Add executor case to `src/lib/llm-tools.ts` switch statement
4. Add to `WRITE_TOOLS` set if it modifies data
5. Update `llm-tools.test.ts` tool count assertion
6. Add to relevant agent profile `allowedTools` arrays in `builtin-agent-profiles.ts`

## Git Workflow

Commit and push after completing implementation unless told not to. When modifying `extension/src/`, rebuild extension zips via `pnpm build:extension` and commit the zips.

## Workflow Rules

Complete the current task fully before moving on. Don't stop mid-task for unrequested reviews.
