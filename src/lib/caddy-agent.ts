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
import { executeTool, buildSystemPrompt } from './llm-tools';
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

/** Build the agent-specific system prompt wrapping the base investigation prompt. */
async function buildAgentSystemPrompt(folder: Folder, settings: Settings, provider?: string, profile?: AgentProfile): Promise<string> {
  const basePrompt = await buildSystemPrompt(folder, settings.llmSystemPrompt, provider);

  const policy = folder.agentPolicy ?? DEFAULT_AGENT_POLICY;
  const focusAreas = policy.focusAreas?.length
    ? `\n\nFocus areas for this investigation: ${policy.focusAreas.join(', ')}`
    : '';

  const proactiveBlock = `
## Being Proactive

You are an ACTIVE researcher, not a passive reader. On every cycle:
- If the case is EMPTY or NEW: immediately start working. Use fetch_url to research the investigation topic. Create IOCs from any indicators you find. Create notes with your findings. Create tasks for follow-up. Build a timeline of known events.
- If the case has data: look for gaps. Enrich unenriched IOCs via fetch_url. Research related threats. Build out the timeline. Create analysis notes.
- ALWAYS take concrete actions. Reading and reporting "nothing to do" is NOT acceptable.
- For IOCs: use enrich_ioc first (auto-runs VirusTotal, AbuseIPDB, Shodan, etc. if configured). Use list_integrations to see available vendor enrichment sources.
- Use fetch_url proactively for additional OSINT research, threat intelligence, and manual lookups.
- Create notes documenting what you found, what you searched for, and what your analysis suggests.
- Create tasks for work that requires human access or judgment.
- You have ${MAX_AGENT_TURNS} turns — use them productively.`;

  // If a profile is provided, use its specialized prompt
  if (profile) {
    return `${basePrompt}

## Agent Profile: ${profile.name}

${profile.systemPrompt}

${proactiveBlock}

${profile.role === 'lead' ? `
You have access to delegation tools:
- delegate_task: Create a task assigned to a specific specialist agent
- list_agent_activity: View what other agents have done recently
Use these proactively — don't wait to be asked. Assess the case and immediately delegate work.
` : ''}
${focusAreas}`;
  }

  // Default generic agent prompt (backward compat)
  return `${basePrompt}

## CaddyAgent Instructions

You are CaddyAgent, an autonomous threat intelligence analyst assistant. You are running a single analysis cycle on the investigation described above.

Your job:
1. Quickly assess the current state — read the investigation summary.
2. If the case is new/empty: start researching immediately. Use fetch_url to gather intelligence on the investigation topic.
3. If the case has data: identify gaps — unenriched IOCs, missing timeline events, unlinked entities, open questions.
4. Take action every cycle: enrich IOCs via fetch_url, create notes with findings, create tasks for follow-up, build timeline entries, link related entities.
5. Be thorough and PROACTIVE. Each cycle MUST produce tangible output.

${proactiveBlock}

Guidelines:
- Start with get_investigation_summary for a quick overview, then ACT.
- For IOCs: use fetch_url to query reputation services, WHOIS, threat intel feeds.
- Create notes summarizing your analysis, findings, and sources.
- Create tasks for work that requires human judgment or access you don't have.
- Always explain your reasoning when creating or modifying entities.
- Do NOT just read and report — take concrete actions.
- Do NOT repeat work that has already been done — check existing notes first.
${focusAreas}`;
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
        const toolCalls = blocks.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use' && !!b.id && !!b.name && typeof b.input === 'object'
        );
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

  const investigationHint = folder.description
    ? `\n\nInvestigation: "${folder.name}"\nDescription: ${folder.description}`
    : `\n\nInvestigation: "${folder.name}"`;

  const userPrompt = workingMemoryContext
    ? `Begin your analysis cycle.${investigationHint}\n\nWorking memory from previous cycles:${workingMemoryContext}\n\nContinue your analysis. Check what has changed, avoid repeating completed work, and make NEW progress. Use fetch_url to research and create notes with your findings.`
    : `Begin your analysis cycle.${investigationHint}\n\nStart by quickly checking the investigation summary (get_investigation_summary), then IMMEDIATELY start working:\n- If the case is empty: use fetch_url to research the topic, create notes with findings, extract IOCs, build timeline events.\n- If the case has data: identify gaps, enrich IOCs via fetch_url, create analysis notes, build the timeline.\n\nBe proactive — don't just read, ACT.`;

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
        break;
      }

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
