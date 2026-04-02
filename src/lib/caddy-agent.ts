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
import type { AgentAction, AgentPolicy, ChatThread, ChatMessage, Folder, Settings, ContentBlock, ToolUseBlock, LLMProvider } from '../types';
import { DEFAULT_AGENT_POLICY } from '../types';
import { TOOL_DEFINITIONS } from './llm-tool-defs';
import { executeTool, buildSystemPrompt } from './llm-tools';
import { shouldAutoApprove, getToolActionClass } from './caddy-agent-policy';
import { resolveRoutingMode, sendViaExtension, sendViaServer } from './llm-router';

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
async function buildAgentSystemPrompt(folder: Folder, settings: Settings): Promise<string> {
  const basePrompt = await buildSystemPrompt(folder, settings.llmSystemPrompt);

  const policy = folder.agentPolicy ?? DEFAULT_AGENT_POLICY;
  const focusAreas = policy.focusAreas?.length
    ? `\n\nFocus areas for this investigation: ${policy.focusAreas.join(', ')}`
    : '';

  return `${basePrompt}

## CaddyAgent Instructions

You are CaddyAgent, an autonomous threat intelligence analyst assistant. You are running a single analysis cycle on the investigation described above.

Your job:
1. Assess the current state of the investigation by reading existing data (notes, tasks, IOCs, timeline events).
2. Identify gaps: unenriched IOCs, missing timeline events, unlinked entities, open questions.
3. Take action: enrich IOCs, create notes with findings, create tasks for follow-up, build timeline entries, link related entities.
4. Be thorough but focused. Each cycle should make meaningful progress.

Guidelines:
- Start by reading the investigation summary and listing existing entities.
- For each unenriched IOC, attempt enrichment via fetch_url or note your findings.
- Create notes summarizing your analysis and findings.
- Create tasks for work that requires human judgment or access you don't have.
- Always explain your reasoning when creating or modifying entities.
- Do NOT repeat work that has already been done — check existing notes and IOCs first.
${focusAreas}`;
}

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
): Promise<AgentCycleResult> {
  const policy: AgentPolicy = folder.agentPolicy ?? DEFAULT_AGENT_POLICY;
  const provider = (policy.model?.includes('/') ? policy.model.split('/')[0] : settings.llmDefaultProvider || 'anthropic') as LLMProvider;
  const model = policy.model || settings.llmDefaultModel || 'claude-sonnet-4-6';
  const serverConnected = !!settings.serverUrl;
  const routingMode = resolveRoutingMode(settings.llmRoutingMode, extensionAvailable, serverConnected);
  const useServerProxy = routingMode === 'server';

  if (!useServerProxy) {
    const apiKey = getApiKeyForProvider(provider, settings);
    if (!apiKey) {
      return { autoExecuted: [], proposed: [], threadId: '', error: `No API key configured for ${provider}` };
    }
  }

  const apiKey = useServerProxy ? 'server-proxy' : (getApiKeyForProvider(provider, settings) || '');
  const endpoint = provider === 'local' ? settings.llmLocalEndpoint : undefined;

  // Ensure agent has an audit trail thread
  let threadId = folder.agentThreadId;
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

  onProgress?.('Building context...');

  const systemPrompt = await buildAgentSystemPrompt(folder, settings);

  // Load working memory from previous cycles
  let workingMemoryContext = '';
  if (threadId) {
    const thread = await db.chatThreads.get(threadId);
    if (thread?.contextSummary) {
      workingMemoryContext = `\n\n## Working Memory (from previous cycles)\n${thread.contextSummary}`;
    }
  }

  const userPrompt = workingMemoryContext
    ? `Begin your analysis cycle. Here is your working memory from previous cycles:${workingMemoryContext}\n\nContinue your analysis. Check what has changed since your last cycle, avoid repeating completed work, and make new progress.`
    : 'Begin your analysis cycle. Start by reading the investigation summary and listing existing entities, then identify gaps and take action.';

  const messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = [
    { role: 'user', content: userPrompt },
  ];

  const autoExecuted: AgentAction[] = [];
  const proposed: AgentAction[] = [];

  try {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      onProgress?.(`Agent thinking (turn ${turn + 1})...`);

      const response = await callLLM({
        provider,
        model,
        messages,
        apiKey,
        systemPrompt,
        tools: TOOL_DEFINITIONS,
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
          const result = await executeTool(toolCall, folder.id);

          const action: AgentAction = {
            id: nanoid(),
            investigationId: folder.id,
            threadId,
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
    const result = await executeApprovedAction(action);
    if (result.isError) failed++;
    else executed++;
  }

  // Update agent status — reflect failures
  await db.folders.update(investigationId, { agentStatus: failed > 0 ? 'error' : 'idle' });

  return { executed, failed };
}
