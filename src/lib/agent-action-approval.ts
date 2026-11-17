/**
 * The analyst's decisions on queued agent actions. Only the agent panel imports
 * this module (approval-import-boundary.test.ts): approving here is the one
 * place outside chat that mints a HumanApproval, so the autonomous loops must
 * not be able to call it.
 */
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { AgentAction, Settings, ToolUseBlock } from '../types';
import { executeTool } from './llm-tools';
import { TOOL_DEFINITIONS, DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS } from './llm-tool-defs';
import { getToolActionClass } from './caddy-agent-policy';
import { buildAgentToolset } from './caddy-agent';
import { getHostToolDefinitions } from './agent-hosts';
import { resolveAgentProfile } from './agent-profile-resolver';
import { isShareableFolder } from './ai-scope';
import { mintHumanApproval } from './human-approval';
import { toolExecutionError, type ToolExecutionConstraints, type ToolExecutionResult } from './llm-tool-execution';
import { SUPERVISOR_ACTION_PROFILE, SUPERVISOR_TOOLS, getSupervisorToolPermission } from './supervisor-tool-policy';
import { classifyToolCall, isRoutineReach } from './tool-reach';
import { workspaceStorageKey } from './workspace-profiles';

function storedSettings(): Settings {
  try { return JSON.parse(localStorage.getItem(workspaceStorageKey('threatcaddy-settings')) || '{}'); } catch { return {} as Settings; }
}

/** Re-derive what the proposing agent may do today; the stored row is not trusted. */
async function approvalConstraints(action: AgentAction, toolUse: ToolUseBlock): Promise<ToolExecutionConstraints | string> {
  if (action.id.startsWith('srv:')) return 'Server proposals are history only and cannot be approved here.';
  const folder = await db.folders.get(action.investigationId);
  if (!folder || folder.status === 'archived') return 'Approved actions require an existing, non-archived investigation.';
  const approval = mintHumanApproval(toolUse, action.investigationId, 'action-queue');

  if (action.agentConfigId === SUPERVISOR_ACTION_PROFILE) {
    return {
      surface: 'supervisor', allowedTools: SUPERVISOR_TOOLS, approval,
      validateScope: async call => {
        const permission = await getSupervisorToolPermission(call, action.investigationId);
        if (permission.kind === 'denied') return permission.error;
        if (permission.investigationId !== action.investigationId) return 'The action target moved to another investigation. Review a new proposal before applying it.';
        // The analyst's explicit approval satisfies the remaining policy gate.
      },
    };
  }

  const profile = await resolveAgentProfile(action.agentConfigId);
  if (action.agentConfigId && !profile) return 'The agent profile is no longer available.';
  const { effectiveAllowedTools } = buildAgentToolset({
    profile, baseTools: TOOL_DEFINITIONS, delegationTools: DELEGATION_TOOL_DEFINITIONS, executiveTools: EXECUTIVE_TOOL_DEFINITIONS,
    hostTools: getHostToolDefinitions(storedSettings()), getActionClass: getToolActionClass,
    homeShareable: await isShareableFolder(action.investigationId),
  });
  if (!effectiveAllowedTools.has(action.toolName)) return `Tool "${action.toolName}" is not available to this agent.`;
  return { surface: 'agent', allowedTools: effectiveAllowedTools, toolBinding: action.toolBinding, approval };
}

/**
 * Execute an approved agent action that was previously proposed.
 */
export async function executeApprovedAction(action: AgentAction): Promise<ToolExecutionResult> {
  // Atomic compare-and-swap: only proceed if status is still 'pending'
  // Use Dexie's modify with a filter to prevent concurrent execution
  let claimed = false;
  await db.agentActions.where('id').equals(action.id).modify((a) => {
    if (a.status === 'pending') {
      a.status = 'approved';
      a.reviewedAt = Date.now();
      claimed = true;
    }
  });

  if (!claimed) {
    const fresh = await db.agentActions.get(action.id);
    return { result: fresh?.resultSummary || 'Already executed or no longer pending', isError: false };
  }

  const toolUse: ToolUseBlock = {
    type: 'tool_use',
    id: nanoid(),
    name: action.toolName,
    input: action.toolInput,
  };

  // An agent question has nothing to run: approving it acknowledges it.
  // Dispatching ask_human again would only queue the same question again.
  const acknowledged = action.toolName === 'ask_human' && !action.id.startsWith('srv:');
  const constraints = acknowledged ? undefined : await approvalConstraints(action, toolUse);
  const result = !constraints
    ? { result: 'Question acknowledged.', isError: false }
    : typeof constraints === 'string'
      ? toolExecutionError(constraints)
      : await executeTool(toolUse, action.investigationId,
        constraints.surface === 'agent' ? { profileId: action.agentConfigId } : undefined, constraints);

  await db.agentActions.update(action.id, {
    status: result.isError ? 'failed' : 'executed',
    resultSummary: result.result.substring(0, 500),
    executedAt: Date.now(),
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

const pendingActions = (investigationId: string) => db.agentActions
  .where('[investigationId+status]')
  .equals([investigationId, 'pending'])
  .toArray();

/** "Approve all" covers routine rows only: nothing that leaves this device,
 * changes agents, reaches another investigation or came from a server. A
 * supervisor row is filed under its target, not the supervisor's home, so
 * its reach cannot be read from the row: it always needs individual review. */
async function isRoutineAction(action: AgentAction, settings: Settings): Promise<boolean> {
  if (action.id.startsWith('srv:') || action.agentConfigId === SUPERVISOR_ACTION_PROFILE) return false;
  const call: ToolUseBlock = { type: 'tool_use', id: action.id, name: action.toolName, input: action.toolInput };
  try {
    return isRoutineReach(await classifyToolCall(call, { homeFolderId: action.investigationId, settings }));
  } catch {
    return false;
  }
}

/** How many pending rows "Approve all" would run, and how many need individual review. */
export async function previewBulkApprove(investigationId: string): Promise<{ routine: number; review: number }> {
  const settings = storedSettings();
  const pending = await pendingActions(investigationId);
  let routine = 0;
  for (const action of pending) if (await isRoutineAction(action, settings)) routine++;
  return { routine, review: pending.length - routine };
}

/**
 * Approve every routine pending action for an investigation; the rest stay
 * pending for individual review.
 */
export async function bulkApproveActions(investigationId: string): Promise<{ executed: number; failed: number; skipped: number }> {
  const settings = storedSettings();
  const pending = await pendingActions(investigationId);

  let executed = 0;
  let failed = 0;
  let skipped = 0;

  for (const action of pending) {
    if (!await isRoutineAction(action, settings)) {
      skipped++;
      continue;
    }
    try {
      const result = await executeApprovedAction(action);
      if (result.isError) failed++;
      else executed++;
    } catch (err) {
      console.error('[caddy-agent] executeApprovedAction failed:', err);
      failed++;
    }
  }

  // The investigation keeps waiting while anything is left for review.
  const remaining = await db.agentActions.where('[investigationId+status]').equals([investigationId, 'pending']).count();
  await db.folders.update(investigationId, { agentStatus: remaining > 0 ? 'waiting' : 'idle' });

  return { executed, failed, skipped };
}
