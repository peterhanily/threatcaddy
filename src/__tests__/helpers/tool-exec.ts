/**
 * Calls the real dispatcher the way a decision site does. By default it acts as
 * an analyst who approved the call on a chat card (surface chat-act, a fresh
 * token, every tool allowed). Pass approve: false to prove the backstop refuses.
 */
import type { ToolUseBlock } from '../../types';
import { executeTool, TOOL_DEFINITIONS } from '../../lib/llm-tools';
import { DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS } from '../../lib/llm-tool-defs';
import type { ToolExecutionConstraints, ToolExecutionResult } from '../../lib/llm-tool-execution';
import type { ToolSurface } from '../../lib/tool-reach';
import { mintHumanApproval } from '../../lib/human-approval';

export const ALL_STATIC_TOOLS: ReadonlySet<string> = new Set(
  [...TOOL_DEFINITIONS, ...DELEGATION_TOOL_DEFINITIONS, ...EXECUTIVE_TOOL_DEFINITIONS].map(tool => tool.name));

export interface ExecToolOptions {
  surface?: ToolSurface;
  agentContext?: { profileId?: string; deploymentId?: string };
  approve?: boolean;
  allowedTools?: ReadonlySet<string>;
  signal?: AbortSignal;
  toolBinding?: string;
  validateScope?: ToolExecutionConstraints['validateScope'];
}

export function execTool(toolUse: ToolUseBlock, folderId?: string, options: ExecToolOptions = {}): Promise<ToolExecutionResult> {
  const { surface = 'chat-act', agentContext, approve = true, allowedTools, signal, toolBinding, validateScope } = options;
  return executeTool(toolUse, folderId, agentContext, {
    surface,
    allowedTools: allowedTools ?? new Set([...ALL_STATIC_TOOLS, toolUse.name]),
    approval: approve ? mintHumanApproval(toolUse, folderId, surface === 'agent' ? 'action-queue' : 'chat-card') : undefined,
    signal, toolBinding, validateScope,
  });
}
