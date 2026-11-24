/**
 * The chat decision site (2.0.3 design, section 7). It runs the decision table
 * the dispatcher re-runs as its backstop, and picks the UX: run, refuse, or put
 * a card in front of the analyst. Only ChatView's approve handler turns a card
 * into a HumanApproval (approval-import-boundary.test.ts).
 */
import i18n from '../i18n';
import type { Settings, ToolUseBlock } from '../types';
import type { HumanApproval } from './human-approval';
import { executeTool } from './llm-tools';
import { getToolExecutionError, toolExecutionError, truncateToolResult, type ToolExecutionResult } from './llm-tool-execution';
import { getToolBinding, isDynamicTool } from './tool-binding';
import { classifyToolCall, decideToolCall, type AskReason, type ToolReach, type ToolSurface } from './tool-reach';

/** What a card shows. readForeignThisRequest is display-only: this request already
 * ran a read of another investigation, so this call may carry its data. */
export interface ApprovalItem {
  toolUse: ToolUseBlock;
  reach: ToolReach;
  reason: AskReason;
  readForeignThisRequest: boolean;
}

/** Skill and agent-host results are capped before they reach the model and the saved thread. */
const MAX_DYNAMIC_RESULT_CHARS = 50_000;
/** As agents cap a tool result (caddy-agent.ts). */
const MAX_BUILTIN_RESULT_CHARS = 50_000;
/** Chat tools that find or name agent profiles by name (llm-tools.ts). */
const PROFILE_NAME_TOOLS: ReadonlySet<string> = new Set(['deploy_agent', 'stop_agent', 'list_deployed_agents']);

export function createChatToolExecutor(deps: {
  homeFolderId?: string;
  mode: 'act' | 'plan';
  isYolo: () => boolean;
  settings: Settings;
  allowedTools: ReadonlySet<string>;
  /** Resolves null when the analyst rejects, the request is aborted or the thread changes. */
  requestApproval: (item: ApprovalItem, signal: AbortSignal) => Promise<HumanApproval | null>;
  runCheckpointed: (fn: () => Promise<ToolExecutionResult>, signal: AbortSignal, toolUse: ToolUseBlock) => Promise<ToolExecutionResult>;
}): (toolUse: ToolUseBlock, signal: AbortSignal) => Promise<ToolExecutionResult> {
  const { homeFolderId, mode, settings, allowedTools } = deps;
  let readForeignThisRequest = false;

  return async (toolUse, signal) => {
    if (signal.aborted) return toolExecutionError('Tool execution was cancelled.');
    const surface: ToolSurface = mode === 'plan' ? 'chat-plan' : deps.isYolo() ? 'chat-yolo' : 'chat-act';
    const permissionError = getToolExecutionError(toolUse, { surface, allowedTools });
    if (permissionError) return toolExecutionError(permissionError);
    let toolBinding: string | undefined;
    try { toolBinding = await getToolBinding(toolUse, homeFolderId, mode, settings); }
    catch (error) { return toolExecutionError(error instanceof Error ? error.message : 'Tool configuration is unavailable.'); }

    let reach: ToolReach;
    // An enrichment card names builtin lookups from this namespace, which the hosted build loads on demand.
    if (toolUse.name === 'enrich_ioc') await i18n.loadNamespaces('integrations');
    // These match builtin agent profiles by their names, which come from this namespace.
    if (PROFILE_NAME_TOOLS.has(toolUse.name)) await i18n.loadNamespaces('agent');
    try { reach = await classifyToolCall(toolUse, { homeFolderId, settings }); }
    catch { return toolExecutionError('The reach of this tool call could not be checked, so it was not run.'); }
    const verdict = decideToolCall(reach, { surface });
    if (verdict.kind === 'deny') return toolExecutionError(verdict.message);

    let approval: HumanApproval | undefined;
    if (verdict.kind === 'ask') {
      approval = await deps.requestApproval({ toolUse, reach, reason: verdict.reason, readForeignThisRequest }, signal) ?? undefined;
      if (!approval) return toolExecutionError(signal.aborted ? 'Tool execution was cancelled.' : 'Tool execution rejected by analyst');
    }
    if (signal.aborted) return toolExecutionError('Tool execution was cancelled.');

    const result = await deps.runCheckpointed(
      () => executeTool(toolUse, homeFolderId, undefined, { surface, allowedTools, signal, toolBinding, approval }), signal, toolUse);
    if (reach.crossRead && !result.isError) readForeignThisRequest = true;
    // Every result is capped, built-in ones too: it is resent on each later turn of the request.
    return { ...result, result: truncateToolResult(result.result, isDynamicTool(toolUse.name) ? MAX_DYNAMIC_RESULT_CHARS : MAX_BUILTIN_RESULT_CHARS) };
  };
}
