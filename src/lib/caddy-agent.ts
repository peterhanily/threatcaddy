/**
 * CaddyAgent — single-cycle agent loop for autonomous investigation work.
 *
 * Phase 1: manual trigger ("Run Agent" button) → one cycle of:
 *   1. Read investigation state (summary, open tasks, unenriched IOCs)
 *   2. Build system prompt with investigation context
 *   3. Call LLM with investigation-scoped tools
 *   4. Categorize tool calls by action class (read/enrich/create/modify)
 *   5. Auto-execute approved actions, propose others to the inbox
 *   6. Log all actions to the agent's audit trail chat thread
 */

import { db } from '../db';
import { nanoid } from 'nanoid';
import type { AgentAction, AgentPolicy, AgentProfile, AgentDeployment, ChatThread, ChatMessage, Folder, Settings, ContentBlock, ToolUseBlock, LLMProvider } from '../types';
import { DEFAULT_AGENT_POLICY } from '../types';
import { TOOL_DEFINITIONS, DELEGATION_TOOL_DEFINITIONS } from './llm-tool-defs';
import { executeTool } from './llm-tools';
import { shouldAutoApprove, getToolActionClass } from './caddy-agent-policy';
import { resolveRoutingMode, sendViaExtension, sendViaServer } from './llm-router';
import { DEFAULT_MODEL_PER_PROVIDER, MODEL_PROVIDER_MAP } from './models';

// ── Provider Resolution ─────────────────────────────────────────────────

const PROVIDER_KEY_MAP: { provider: LLMProvider; keyField: keyof Settings }[] = [
  { provider: 'anthropic', keyField: 'llmAnthropicApiKey' },
  { provider: 'openai', keyField: 'llmOpenAIApiKey' },
  { provider: 'gemini', keyField: 'llmGeminiApiKey' },
  { provider: 'mistral', keyField: 'llmMistralApiKey' },
];

function getConfiguredProviderNames(settings: Settings): string[] {
  const names: string[] = [];
  for (const { provider, keyField } of PROVIDER_KEY_MAP) {
    if ((settings[keyField] as string | undefined)?.trim()) names.push(provider);
  }
  if (settings.llmLocalEndpoint?.trim()) names.push('local');
  return names;
}

function resolveConfiguredProvider(settings: Settings): { resolvedProvider: LLMProvider; resolvedModel: string } {
  // Try the user's default first
  const defaultProvider = (settings.llmDefaultProvider || 'anthropic') as LLMProvider;
  if (getApiKeyForProvider(defaultProvider, settings)) {
    return {
      resolvedProvider: defaultProvider,
      resolvedModel: settings.llmDefaultModel || DEFAULT_MODEL_PER_PROVIDER[defaultProvider] || 'claude-sonnet-4-6',
    };
  }

  // Fallback to first provider that has a key
  for (const { provider } of PROVIDER_KEY_MAP) {
    if (getApiKeyForProvider(provider, settings)) {
      return {
        resolvedProvider: provider,
        resolvedModel: DEFAULT_MODEL_PER_PROVIDER[provider] || 'claude-sonnet-4-6',
      };
    }
  }

  // Try local
  if (settings.llmLocalEndpoint?.trim()) {
    return {
      resolvedProvider: 'local',
      resolvedModel: settings.llmLocalModelName || 'llama3',
    };
  }

  // Nothing configured — will fail with helpful error downstream
  return { resolvedProvider: defaultProvider, resolvedModel: settings.llmDefaultModel || 'claude-sonnet-4-6' };
}

// ── Types ───────────────────────────────────────────────────────────────

export interface AgentCycleResult {
  autoExecuted: AgentAction[];
  proposed: AgentAction[];
  threadId: string;
  error?: string;
}

interface LLMResponse {
  content: string;
  toolCalls: ToolUseBlock[];
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

/** Build a lean agent system prompt — NOT the full CaddyAI prompt (which is too large). */
async function buildAgentSystemPrompt(folder: Folder, _settings: Settings, provider?: string, profile?: AgentProfile): Promise<string> {
  // Build lean investigation context (skip the massive CaddyAI base prompt)
  let context = 'You are a threat intelligence agent in ThreatCaddy.';

  // Add local tool format instructions for local LLMs
  if (provider === 'local') {
    context += `\n\nTo call tools, use: <tool_call>{"name":"tool_name","arguments":{"param":"value"}}</tool_call>`;
  }

  // Add investigation context
  if (folder) {
    context += `\n\nInvestigation: "${folder.name}"`;
    if (folder.description) context += `\nDescription: ${folder.description}`;
    if (folder.status) context += ` | Status: ${folder.status}`;

    // Quick entity counts
    const [noteCount, taskCount, iocCount, eventCount] = await Promise.all([
      db.notes.where('folderId').equals(folder.id).and(n => !n.trashed).count(),
      db.tasks.where('folderId').equals(folder.id).and(t => !t.trashed).count(),
      db.standaloneIOCs.where('folderId').equals(folder.id).and(i => !i.trashed).count(),
      db.timelineEvents.where('folderId').equals(folder.id).and(e => !e.trashed).count(),
    ]);
    context += `\nEntities: ${noteCount} notes, ${taskCount} tasks, ${iocCount} IOCs, ${eventCount} timeline events`;
  }

  const policy = folder.agentPolicy ?? DEFAULT_AGENT_POLICY;
  const focusAreas = policy.focusAreas?.length ? `\nFocus: ${policy.focusAreas.join(', ')}` : '';

  // Task consumption instructions
  const taskInstructions = `
TASK WORKFLOW: Check list_tasks for todo/in-progress tasks. Claim a todo task by updating it to in-progress, do the work described, then mark it done. Prioritize tasks assigned to you or tagged agent-delegated.`;

  // Read-only entity constraints
  const readOnlyNote = profile?.readOnlyEntityTypes?.length
    ? `\nRESTRICTION: You CANNOT modify these entity types: ${profile.readOnlyEntityTypes.join(', ')}. Only read them.`
    : '';

  if (profile) {
    return `${context}

## ${profile.name} (${profile.role})

${profile.systemPrompt}
${taskInstructions}${readOnlyNote}

Be PROACTIVE. Always produce output. ${MAX_AGENT_TURNS} turns max.${profile.role === 'lead' ? ' Use delegate_task and list_agent_activity. Review completed tasks for quality.' : ''}${focusAreas}`;
  }

  return `${context}

## CaddyAgent

Autonomous threat analyst. Be PROACTIVE:
- Check list_tasks for todo tasks — claim them (update to in-progress), do the work, mark done.
- get_investigation_summary first, then ACT.
- Empty case? Research via fetch_url. Create notes, IOCs, tasks, timeline events.
- Has data? Enrich IOCs (enrich_ioc or fetch_url). Fill gaps. Create analysis notes.
- Every cycle MUST produce output. Never just read and report.
- enrich_ioc for vendor integrations, fetch_url for OSINT. Don't repeat work.${focusAreas}`;
}

/**
 * Parse tool calls from LLM text output when structured tool_use blocks aren't returned.
 * Supports: <tool_call>JSON</tool_call>, ```json blocks, and bare JSON with name+arguments.
 */
export function parseToolCallsFromText(text: string, toolNames: string[]): ToolUseBlock[] {
  const calls: ToolUseBlock[] = [];
  const nameSet = new Set(toolNames);
  let idx = 0;

  // Pattern 1: <tool_call>JSON</tool_call>
  const tagPattern = /<(?:tool_call|function_call)>\s*([\s\S]*?)\s*<\/(?:tool_call|function_call)>/gi;
  let match;
  while ((match = tagPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      const name = obj.name || obj.function;
      const args = obj.arguments || obj.parameters || obj.input || {};
      if (name && nameSet.has(name)) {
        calls.push({
          type: 'tool_use',
          id: `text_tc_${Date.now()}_${idx++}`,
          name,
          input: typeof args === 'string' ? JSON.parse(args) : args,
        });
      }
    } catch { /* skip malformed */ }
  }
  if (calls.length > 0) return calls;

  // Pattern 2: ```json blocks with name+arguments
  const jsonBlockPattern = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;
  while ((match = jsonBlockPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      const name = obj.name || obj.function;
      const args = obj.arguments || obj.parameters || obj.input || {};
      if (name && nameSet.has(name)) {
        calls.push({
          type: 'tool_use',
          id: `text_tc_${Date.now()}_${idx++}`,
          name,
          input: typeof args === 'string' ? JSON.parse(args) : args,
        });
      }
    } catch { /* skip malformed */ }
  }

  return calls;
}

const LLM_TIMEOUT_MS = 120_000; // 2 minutes per LLM call

/** Send an LLM request and wait for the complete response (non-streaming). */
function callLLM(opts: {
  provider: LLMProvider;
  model: string;
  messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[];
  apiKey: string;
  systemPrompt: string;
  tools: typeof TOOL_DEFINITIONS;
  useServerProxy: boolean;
  endpoint?: string;
}): Promise<LLMResponse> {
  const llmPromise = new Promise<LLMResponse>((resolve, reject) => {
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
        let toolCalls = blocks.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use' && !!b.id && !!b.name && typeof b.input === 'object'
        );

        // Fallback: if no structured tool calls but text contains tool_call patterns, parse them
        if (toolCalls.length === 0 && accumulated) {
          const parsed = parseToolCallsFromText(accumulated, opts.tools.map(t => t.name));
          if (parsed.length > 0) {
            toolCalls = parsed;
          }
        }

        resolve({ content: accumulated, toolCalls });
      },
      onError: (error: string) => {
        reject(new Error(`LLM request failed (${opts.provider}/${opts.model}${opts.useServerProxy ? ' via server' : ''}): ${error || 'unknown error'}`));
      },
    };

    if (opts.useServerProxy) {
      sendViaServer(request, callbacks);
    } else {
      sendViaExtension(request, callbacks);
    }
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`LLM request timed out after ${LLM_TIMEOUT_MS / 1000}s (${opts.provider}/${opts.model})`)), LLM_TIMEOUT_MS);
  });

  return Promise.race([llmPromise, timeoutPromise]);
}

// ── Main Cycle ──────────────────────────────────────────────────────────

const MAX_AGENT_TURNS = 6;

/**
 * Run a single agent cycle for an investigation.
 * Reads state, calls LLM, processes tool calls, returns results.
 */
export async function runAgentCycle(
  folder: Folder,
  settings: Settings,
  extensionAvailable: boolean,
  onProgress?: (status: string) => void,
  profile?: AgentProfile,
  deployment?: AgentDeployment,
): Promise<AgentCycleResult> {
  // Merge policies: profile policy > deployment overrides > folder policy > defaults
  const basePolicy = folder.agentPolicy ?? DEFAULT_AGENT_POLICY;
  const profilePolicy = profile?.policy;
  const deployOverrides = deployment?.policyOverrides;
  const policy: AgentPolicy = { ...basePolicy, ...profilePolicy, ...deployOverrides };
  const serverConnected = !!settings.serverUrl;
  const routingMode = resolveRoutingMode(settings.llmRoutingMode, extensionAvailable, serverConnected);
  const useServerProxy = routingMode === 'server';

  // Resolve provider + model: policy override > global default > first configured
  let provider: LLMProvider;
  let model: string;

  if (policy.model) {
    // Policy has an explicit model set
    const entry = MODEL_PROVIDER_MAP[policy.model];
    provider = entry ? entry : (policy.model === settings.llmLocalModelName ? 'local' : (settings.llmDefaultProvider || 'anthropic')) as LLMProvider;
    model = policy.model;
  } else {
    // Find first configured provider
    const { resolvedProvider, resolvedModel } = resolveConfiguredProvider(settings);
    provider = resolvedProvider;
    model = resolvedModel;
  }

  if (!useServerProxy) {
    const apiKey = getApiKeyForProvider(provider, settings);
    if (!apiKey) {
      const configured = getConfiguredProviderNames(settings);
      const hint = configured.length > 0
        ? `Configured providers: ${configured.join(', ')}. Set the agent model in AgentCaddy settings.`
        : 'Add an API key in Settings > AI/LLM.';
      return { autoExecuted: [], proposed: [], threadId: '', error: `No API key for ${provider}. ${hint}` };
    }
  }

  const apiKey = useServerProxy ? 'server-proxy' : (getApiKeyForProvider(provider, settings) || '');
  const endpoint = provider === 'local' ? settings.llmLocalEndpoint : undefined;

  // Ensure agent has an audit trail thread (deployment thread > folder thread)
  let threadId = deployment?.threadId || folder.agentThreadId;
  if (!threadId) {
    threadId = nanoid();
    const agentThread: ChatThread = {
      id: threadId,
      title: `Agent: ${folder.name}`,
      messages: [],
      model,
      provider,
      folderId: folder.id,
      tags: [],
      source: 'agent',
      trashed: false,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.chatThreads.add(agentThread);
    await db.folders.update(folder.id, { agentThreadId: threadId, agentStatus: 'running', agentLastRunAt: Date.now() });
  } else {
    await db.folders.update(folder.id, { agentStatus: 'running', agentLastRunAt: Date.now() });
  }

  const agentName = profile?.name || 'CaddyAgent';
  onProgress?.(`${agentName}: ${provider}/${model}...`);

  const systemPrompt = await buildAgentSystemPrompt(folder, settings, provider, profile);

  // Load working memory from previous cycles
  let workingMemoryContext = '';
  if (threadId) {
    const thread = await db.chatThreads.get(threadId);
    if (thread?.contextSummary) {
      workingMemoryContext = `\n\n## Working Memory (from previous cycles)\n${thread.contextSummary}`;
    }
  }

  const desc = folder.description ? ` — ${folder.description}` : '';

  const userPrompt = workingMemoryContext
    ? `Cycle for "${folder.name}"${desc}. Memory:${workingMemoryContext}\n\nContinue — make new progress, don't repeat.`
    : `Cycle for "${folder.name}"${desc}. Start with get_investigation_summary, then act immediately.`;

  const messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = [
    { role: 'user', content: userPrompt },
  ];

  const autoExecuted: AgentAction[] = [];
  const proposed: AgentAction[] = [];

  // Filter tools by profile's allowedTools (if set), add delegation tools for lead agents
  let availableTools = profile?.allowedTools?.length
    ? TOOL_DEFINITIONS.filter(t => profile.allowedTools!.includes(t.name))
    : [...TOOL_DEFINITIONS];

  if (profile?.role === 'lead') {
    availableTools = [...availableTools, ...DELEGATION_TOOL_DEFINITIONS] as typeof TOOL_DEFINITIONS;
  } else if (profile?.role === 'observer') {
    // Observer agents only get read tools
    availableTools = availableTools.filter(t => {
      const cls = getToolActionClass(t.name);
      return cls === 'read';
    });
  }

  try {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      onProgress?.(`${agentName} thinking (turn ${turn + 1})...`);

      const response = await callLLM({
        provider,
        model,
        messages,
        apiKey,
        systemPrompt,
        tools: availableTools,
        useServerProxy,
        endpoint,
      });

      // Log the assistant's response to the audit thread
      const assistantMessage: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: response.content,
        createdAt: Date.now(),
      };
      await db.chatThreads.where('id').equals(threadId).modify((thread: ChatThread) => {
        thread.messages.push(assistantMessage);
        thread.updatedAt = Date.now();
      });

      if (response.toolCalls.length === 0) {
        // No tool calls — agent is done
        onProgress?.(`${agentName}: finished (${response.content ? response.content.substring(0, 60) + '...' : 'no output'})`);
        break;
      }

      onProgress?.(`${agentName}: ${response.toolCalls.length} tool call(s)...`);

      // Process tool calls
      const toolResults: ContentBlock[] = [];
      const assistantContent: ContentBlock[] = [];

      // Add text block if present
      if (response.content) {
        assistantContent.push({ type: 'text', text: response.content });
      }

      for (const toolCall of response.toolCalls) {
        assistantContent.push(toolCall);

        const actionClass = getToolActionClass(toolCall.name);
        const autoApprove = shouldAutoApprove(toolCall.name, policy);

        if (autoApprove) {
          // Auto-execute
          onProgress?.(`Executing ${toolCall.name}...`);
          let result: { result: string; isError: boolean };
          try {
            result = await executeTool(toolCall, folder.id);
          } catch (toolErr) {
            result = { result: JSON.stringify({ error: String((toolErr as Error).message || toolErr) }), isError: true };
          }

          const action: AgentAction = {
            id: nanoid(),
            investigationId: folder.id,
            threadId,
            agentConfigId: profile?.id,
            toolName: toolCall.name,
            toolInput: toolCall.input as Record<string, unknown>,
            rationale: response.content || 'Auto-approved by policy',
            status: result.isError ? 'failed' : 'executed',
            resultSummary: result.result.substring(0, 500),
            severity: 'info',
            createdAt: Date.now(),
            executedAt: Date.now(),
          };
          await db.agentActions.add(action);
          autoExecuted.push(action);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: result.result,
            is_error: result.isError,
          });
        } else {
          // Check for duplicate pending action (same tool + same input)
          const inputJson = JSON.stringify(toolCall.input);
          const existingDup = await db.agentActions
            .where('[investigationId+status]')
            .equals([folder.id, 'pending'])
            .filter(a => a.toolName === toolCall.name && JSON.stringify(a.toolInput) === inputJson)
            .first();

          if (existingDup) {
            // Skip duplicate — tell the LLM it's already pending
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: JSON.stringify({ status: 'already_pending', message: 'An identical action is already pending review.' }),
              is_error: false,
            });
            continue;
          }

          // Propose for human approval
          const action: AgentAction = {
            id: nanoid(),
            investigationId: folder.id,
            threadId,
            agentConfigId: profile?.id,
            toolName: toolCall.name,
            toolInput: toolCall.input as Record<string, unknown>,
            rationale: response.content || 'Agent proposed action',
            status: 'pending',
            severity: actionClass === 'modify' ? 'warning' : 'info',
            createdAt: Date.now(),
          };
          await db.agentActions.add(action);
          proposed.push(action);

          // Return a "pending approval" result so the LLM knows
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify({ status: 'pending_approval', message: 'This action requires human approval. It has been queued for review.' }),
            is_error: false,
          });
        }
      }

      // Continue the conversation with tool results
      messages.push(
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResults },
      );
    }

    await db.folders.update(folder.id, {
      agentStatus: proposed.length > 0 ? 'waiting' : 'idle',
      agentLastRunAt: Date.now(),
    });

    onProgress?.('Cycle complete');
    return { autoExecuted, proposed, threadId };
  } catch (err) {
    const errorMsg = String((err as Error).message || err);
    await db.folders.update(folder.id, { agentStatus: 'error' });
    return { autoExecuted, proposed, threadId, error: errorMsg };
  }
}

/**
 * Execute an approved agent action that was previously proposed.
 */
export async function executeApprovedAction(action: AgentAction): Promise<{ result: string; isError: boolean }> {
  const toolUse: ToolUseBlock = {
    type: 'tool_use',
    id: nanoid(),
    name: action.toolName,
    input: action.toolInput,
  };

  const result = await executeTool(toolUse, action.investigationId);

  await db.agentActions.update(action.id, {
    status: result.isError ? 'failed' : 'executed',
    resultSummary: result.result.substring(0, 500),
    executedAt: Date.now(),
    reviewedAt: Date.now(),
  });

  return result;
}

/**
 * Reject a proposed agent action.
 */
export async function rejectAction(actionId: string): Promise<void> {
  await db.agentActions.update(actionId, {
    status: 'rejected',
    reviewedAt: Date.now(),
  });
}

/**
 * Bulk approve all pending actions for an investigation.
 */
export async function bulkApproveActions(investigationId: string): Promise<{ executed: number; failed: number }> {
  const pending = await db.agentActions
    .where('[investigationId+status]')
    .equals([investigationId, 'pending'])
    .toArray();

  let executed = 0;
  let failed = 0;

  for (const action of pending) {
    try {
      const result = await executeApprovedAction(action);
      if (result.isError) failed++;
      else executed++;
    } catch {
      failed++;
    }
  }

  // Update agent status — reflect failures
  await db.folders.update(investigationId, { agentStatus: failed > 0 ? 'error' : 'idle' });

  return { executed, failed };
}
