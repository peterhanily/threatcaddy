/**
 * CaddyAgent Supervisor — cross-investigation analysis agent.
 *
 * Runs on a global schedule (not per-investigation). Uses cross-investigation
 * tools to detect shared IOCs, stale cases, and patterns across the caseload.
 * Writes findings as notes in a dedicated "Supervisor" system investigation.
 */

import { db } from '../db';
import { nanoid } from 'nanoid';
import type { Folder, Settings, ChatThread, ChatMessage, ContentBlock, ToolUseBlock, LLMProvider } from '../types';
import { TOOL_DEFINITIONS } from './llm-tool-defs';
import { executeTool, buildSystemPrompt } from './llm-tools';
import { resolveRoutingMode, sendViaExtension, sendViaServer } from './llm-router';

// ── Constants ───────────────────────────────────────────────────────────

const SUPERVISOR_FOLDER_NAME = 'CaddyAgent Supervisor';
const SUPERVISOR_THREAD_TITLE = 'Supervisor Audit Trail';
const MAX_SUPERVISOR_TURNS = 5;

/** Tools the supervisor is allowed to use. */
const SUPERVISOR_TOOLS = new Set([
  'list_investigations',
  'get_investigation_details',
  'search_across_investigations',
  'compare_investigations',
  'get_investigation_summary',
  'list_iocs',
  'search_notes',
  'create_note',
]);

const SUPERVISOR_TOOL_DEFS = TOOL_DEFINITIONS.filter(t => SUPERVISOR_TOOLS.has(t.name));

// ── Types ───────────────────────────────────────────────────────────────

export interface SupervisorResult {
  findings: string[];
  escalations: EscalationEvent[];
  error?: string;
}

export interface EscalationEvent {
  type: 'shared_iocs' | 'stale_case' | 'critical_ioc' | 'pattern_match';
  title: string;
  detail: string;
  investigationIds?: string[];
  severity: 'warning' | 'critical';
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getApiKeyForProvider(provider: LLMProvider, settings: Settings): string | undefined {
  switch (provider) {
    case 'anthropic': return settings.llmAnthropicApiKey?.trim();
    case 'openai':    return settings.llmOpenAIApiKey?.trim();
    case 'gemini':    return settings.llmGeminiApiKey?.trim();
    case 'mistral':   return settings.llmMistralApiKey?.trim();
    case 'local':     return settings.llmLocalApiKey?.trim() || 'local';
    default:          return undefined;
  }
}

function callLLM(opts: {
  provider: LLMProvider;
  model: string;
  messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[];
  apiKey: string;
  systemPrompt: string;
  tools: typeof SUPERVISOR_TOOL_DEFS;
  useServerProxy: boolean;
  endpoint?: string;
}): Promise<{ content: string; toolCalls: ToolUseBlock[] }> {
  return new Promise((resolve, reject) => {
    let accumulated = '';
    const request = {
      provider: opts.provider,
      model: opts.model,
      messages: opts.messages as unknown[],
      apiKey: opts.apiKey,
      systemPrompt: opts.systemPrompt,
      tools: opts.tools,
      endpoint: opts.endpoint,
    };
    const callbacks = {
      onChunk: (content: string) => { accumulated += content; },
      onDone: (_stopReason: string, contentBlocks: unknown[]) => {
        const blocks = contentBlocks as ContentBlock[];
        const toolCalls = blocks.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use' && !!b.id && !!b.name && typeof b.input === 'object'
        );
        resolve({ content: accumulated, toolCalls });
      },
      onError: (error: string) => reject(new Error(error || 'LLM request failed')),
    };
    if (opts.useServerProxy) sendViaServer(request, callbacks);
    else sendViaExtension(request, callbacks);
  });
}

const SUPERVISOR_SYSTEM_PROMPT = `You are the CaddyAgent Supervisor — a cross-investigation analyst that monitors all active investigations in a threat intelligence platform.

Your job:
1. List all active investigations and assess their status.
2. Compare investigations to find shared IOCs (IP addresses, domains, hashes that appear in multiple cases).
3. Identify stale investigations (no updates in 7+ days, open tasks with no progress).
4. Detect cross-case patterns (shared TTPs, overlapping infrastructure, common threat actors).
5. Write a summary note with your findings.

Guidelines:
- Start by listing all investigations to understand the caseload.
- If there are 2+ active investigations, compare them for shared IOCs and TTPs.
- For each finding, explain why it matters and what the analyst should do.
- Create a note in the current investigation (the Supervisor investigation) with your findings.
- Be concise. Flag only actionable findings.
- When you find shared IOCs across cases, this is HIGH PRIORITY — it may indicate a coordinated campaign.
- Mark stale cases that haven't been updated in 7+ days.

IMPORTANT: You can only READ from other investigations. You can only CREATE notes in the Supervisor investigation (your current investigation).`;

// ── Main ────────────────────────────────────────────────────────────────

/** Get or create the Supervisor system investigation. */
async function ensureSupervisorFolder(): Promise<Folder> {
  const existing = await db.folders
    .where('name')
    .equals(SUPERVISOR_FOLDER_NAME)
    .first();

  if (existing) return existing;

  const folder: Folder = {
    id: nanoid(),
    name: SUPERVISOR_FOLDER_NAME,
    icon: '🤖',
    order: 9999,
    createdAt: Date.now(),
    description: 'Automated cross-investigation findings from CaddyAgent Supervisor',
    status: 'active',
  };
  await db.folders.add(folder);
  return folder;
}

/** Run a single supervisor cycle. */
export async function runSupervisorCycle(
  settings: Settings,
  extensionAvailable: boolean,
  onProgress?: (status: string) => void,
): Promise<SupervisorResult> {
  const provider = (settings.llmDefaultProvider || 'anthropic') as LLMProvider;
  const model = settings.llmDefaultModel || 'claude-sonnet-4-6';
  const serverConnected = !!settings.serverUrl;
  const routingMode = resolveRoutingMode(settings.llmRoutingMode, extensionAvailable, serverConnected);
  const useServerProxy = routingMode === 'server';

  const apiKey = useServerProxy ? 'server-proxy' : (getApiKeyForProvider(provider, settings) || '');
  if (!useServerProxy && !apiKey) {
    return { findings: [], escalations: [], error: `No API key configured for ${provider}` };
  }

  const endpoint = provider === 'local' ? settings.llmLocalEndpoint : undefined;

  onProgress?.('Preparing supervisor...');

  // Ensure supervisor investigation exists
  const supervisorFolder = await ensureSupervisorFolder();

  // Ensure audit trail thread
  let threadId = supervisorFolder.agentThreadId;
  if (!threadId) {
    threadId = nanoid();
    const thread: ChatThread = {
      id: threadId,
      title: SUPERVISOR_THREAD_TITLE,
      messages: [],
      model,
      provider,
      folderId: supervisorFolder.id,
      tags: [],
      source: 'agent',
      trashed: false,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.chatThreads.add(thread);
    await db.folders.update(supervisorFolder.id, { agentThreadId: threadId });
  }

  // Check how many active investigations there are — skip if only 0-1
  const activeFolders = await db.folders
    .filter(f => f.status !== 'archived' && !f.name.startsWith('CaddyAgent') && f.name !== SUPERVISOR_FOLDER_NAME)
    .count();

  if (activeFolders < 2) {
    return { findings: ['Skipped: fewer than 2 active investigations to compare.'], escalations: [] };
  }

  const systemPrompt = SUPERVISOR_SYSTEM_PROMPT + await buildInvestigationContext(supervisorFolder);

  const messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = [
    { role: 'user', content: 'Run your cross-investigation analysis cycle. List investigations, compare them for shared IOCs and patterns, identify stale cases, and write a summary note with your findings.' },
  ];

  const findings: string[] = [];
  const escalations: EscalationEvent[] = [];

  try {
    for (let turn = 0; turn < MAX_SUPERVISOR_TURNS; turn++) {
      onProgress?.(`Supervisor thinking (turn ${turn + 1})...`);

      const response = await callLLM({
        provider, model, messages, apiKey,
        systemPrompt,
        tools: SUPERVISOR_TOOL_DEFS,
        useServerProxy,
        endpoint,
      });

      // Log to audit thread
      const assistantMsg: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: response.content,
        createdAt: Date.now(),
      };
      await db.chatThreads.where('id').equals(threadId).modify((t: ChatThread) => {
        t.messages.push(assistantMsg);
        t.updatedAt = Date.now();
      });

      if (response.content) {
        findings.push(response.content);
      }

      if (response.toolCalls.length === 0) break;

      // Execute all tool calls (supervisor only uses read tools + create_note)
      const toolResults: ContentBlock[] = [];
      const assistantContent: ContentBlock[] = [];
      if (response.content) assistantContent.push({ type: 'text', text: response.content });

      for (const toolCall of response.toolCalls) {
        assistantContent.push(toolCall);
        onProgress?.(`Executing ${toolCall.name}...`);

        const result = await executeTool(toolCall, supervisorFolder.id);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result.result,
          is_error: result.isError,
        });

        // Detect escalation-worthy results from compare_investigations
        if (toolCall.name === 'compare_investigations' && !result.isError) {
          try {
            const data = JSON.parse(result.result);
            if (data.overlap?.sharedIOCCount > 0) {
              escalations.push({
                type: 'shared_iocs',
                title: `${data.overlap.sharedIOCCount} shared IOCs across investigations`,
                detail: `Investigations share IOC values: ${data.sharedIOCs?.slice(0, 5).map((i: { value: string }) => i.value).join(', ')}`,
                investigationIds: data.investigations?.map((i: { id: string }) => i.id),
                severity: data.overlap.sharedIOCCount >= 3 ? 'critical' : 'warning',
              });
            }
          } catch { /* ignore parse errors */ }
        }
      }

      messages.push(
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResults },
      );
    }

    return { findings, escalations };
  } catch (err) {
    return { findings, escalations, error: String((err as Error).message || err) };
  }
}

async function buildInvestigationContext(folder: Folder): Promise<string> {
  const base = await buildSystemPrompt(folder);
  // Strip the base system prompt (we have our own) — just want entity counts
  const contextStart = base.indexOf('## Current Investigation Context');
  if (contextStart >= 0) return '\n\n' + base.substring(contextStart);
  return '';
}

/**
 * Send a desktop notification via the Chrome extension.
 * Falls back silently if extension is not available.
 */
export function sendEscalationNotification(escalation: EscalationEvent): void {
  try {
    window.postMessage({
      type: 'TC_SEND_NOTIFICATION',
      payload: {
        title: `CaddyAgent: ${escalation.title}`,
        message: escalation.detail,
        severity: escalation.severity,
      },
    }, window.location.origin);
  } catch {
    // Extension not available — silently fail
  }
}
