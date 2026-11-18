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
import { agentRefusal } from './llm-router';
import { resolveAgentProfile } from './agent-profile-resolver';
import { isShareableFolder } from './ai-scope';
import { mintHumanApproval } from './human-approval';
import { toolExecutionError, type ToolExecutionConstraints, type ToolExecutionResult } from './llm-tool-execution';
import { SUPERVISOR_ACTION_PROFILE, SUPERVISOR_TOOLS, getSupervisorToolPermission } from './supervisor-tool-policy';
import { classifyToolCall, isRoutineReach } from './tool-reach';
import { getToolBinding, isDynamicTool } from './tool-binding';
import { getReadOnlyEntityError } from './tool-entity-policy';
import { workspaceStorageKey } from './workspace-profiles';

function storedSettings(): Settings {
  try { return JSON.parse(localStorage.getItem(workspaceStorageKey('threatcaddy-settings')) || '{}'); } catch { return {} as Settings; }
}

/** The proposing agent has no deployment left in the action's investigation: it
 * was dismissed or removed. Legacy rows name no profile, supervisor rows name
 * the supervisor, and a paused or resting agent keeps its deployment. */
async function proposerRemoved(action: AgentAction): Promise<boolean> {
  if (!action.agentConfigId || action.agentConfigId === SUPERVISOR_ACTION_PROFILE) return false;
  return !await db.agentDeployments.where('investigationId').equals(action.investigationId)
    .filter(deployment => deployment.profileId === action.agentConfigId).first();
}

/** These return what a remote system answered, which can read like any refusal
 * below although the request was sent: their result is never reworded. */
const passesRemoteAnswer = (tool: string) => isDynamicTool(tool) || tool === 'query_siem';

/** The supervisor's refusals (supervisor-tool-policy.ts) that an approval meets
 * when its target changed after the proposal. approvalConstraints refuses a
 * missing or archived home first, and every supervisor write tool has a scope. */
const SUPERVISOR_REFUSALS: ReadonlyMap<string, string> = new Map([
  ['Supervisor IOC updates require an existing IOC in an investigation.', 'refusal.supervisorIocGone'],
  ['Supervisor links require existing note, task or timeline entities in investigations.', 'refusal.supervisorLinkGone'],
  ['Supervisor writes require an existing, non-archived investigation.', 'refusal.targetInvestigationUnavailable'],
]);

/** Re-derive what the proposing agent may do today; the stored row is not trusted.
 * A refusal is the failed row's reason in the inbox, so it is in the analyst's language. */
async function approvalConstraints(action: AgentAction, toolUse: ToolUseBlock): Promise<ToolExecutionConstraints | string> {
  if (action.id.startsWith('srv:')) return await agentRefusal('refusal.serverProposal');
  const folder = await db.folders.get(action.investigationId);
  if (!folder || folder.status === 'archived') return await agentRefusal('refusal.investigationUnavailable');
  if (await proposerRemoved(action)) return await agentRefusal('refusal.proposerRemoved');
  const approval = mintHumanApproval(toolUse, action.investigationId, 'action-queue');

  if (action.agentConfigId === SUPERVISOR_ACTION_PROFILE) {
    return {
      surface: 'supervisor', allowedTools: SUPERVISOR_TOOLS, approval,
      validateScope: async call => {
        const permission = await getSupervisorToolPermission(call, action.investigationId);
        if (permission.kind === 'denied') {
          const key = SUPERVISOR_REFUSALS.get(permission.error);
          return key ? await agentRefusal(key) : permission.error;
        }
        if (permission.investigationId !== action.investigationId) return await agentRefusal('refusal.targetMoved');
        // The analyst's explicit approval satisfies the remaining policy gate.
      },
    };
  }

  const profile = await resolveAgentProfile(action.agentConfigId);
  if (action.agentConfigId && !profile) return await agentRefusal('refusal.profileGone');
  const settings = storedSettings();
  const { effectiveAllowedTools } = buildAgentToolset({
    profile, baseTools: TOOL_DEFINITIONS, delegationTools: DELEGATION_TOOL_DEFINITIONS, executiveTools: EXECUTIVE_TOOL_DEFINITIONS,
    hostTools: getHostToolDefinitions(settings), getActionClass: getToolActionClass,
    homeShareable: await isShareableFolder(action.investigationId),
  });
  if (!effectiveAllowedTools.has(action.toolName)) return await agentRefusal('refusal.toolNotAllowed', { tool: action.toolName });
  if (passesRemoteAnswer(action.toolName)) {
    // Their failed result is the remote answer, so the dispatcher's checks before
    // the request (llm-tools.ts) are made here too, and said in the analyst's language.
    if (isDynamicTool(action.toolName)) {
      const binding = await getToolBinding(toolUse, action.investigationId, 'act', settings).catch(() => undefined);
      if (!action.toolBinding || action.toolBinding !== binding) return await agentRefusal('refusal.toolChanged', { tool: action.toolName });
    }
    if (getReadOnlyEntityError(toolUse, profile?.readOnlyEntityTypes)) return await agentRefusal('refusal.readOnlyEntity');
  }
  return { surface: 'agent', allowedTools: effectiveAllowedTools, toolBinding: action.toolBinding, approval };
}

/** The dispatcher's refusals stay English for the model (tool-reach.ts,
 * llm-tools.ts). A failed row is the analyst's to read, so the ones an
 * approval can meet are stored in the analyst's language. */
const DISPATCH_REFUSALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Agents cannot change another investigation\.$/, 'refusal.otherInvestigationChange'],
  [/^Agents cannot read other investigations from this investigation\.$/, 'refusal.otherInvestigationRead'],
  [/^Not found in this investigation\.$/, 'refusal.notInInvestigation'],
  [/^Cannot modify ".*" entities — read-only restriction\.$|^Tool ".*" cannot guarantee this agent's read-only entity restrictions\.$/, 'refusal.readOnlyEntity'],
];
/** The dispatcher refuses these before running anything once their task is escalated
 * (for link_entities, a link whose source is that task). */
const ESCALATION_GUARDED_TOOLS: ReadonlySet<string> = new Set(['update_task', 'delete_task', 'review_completed_task', 'link_entities']);

async function inAnalystLanguage(result: ToolExecutionResult, tool: string): Promise<ToolExecutionResult> {
  if (!result.isError || passesRemoteAnswer(tool)) return result;
  let refusal: { error?: unknown; escalated?: unknown } | null;
  try { refusal = JSON.parse(result.result); } catch { return result; }
  if (refusal?.escalated === true && ESCALATION_GUARDED_TOOLS.has(tool)) return toolExecutionError(await agentRefusal('refusal.taskEscalated'));
  const error = typeof refusal?.error === 'string' ? refusal.error : '';
  const key = DISPATCH_REFUSALS.find(([pattern]) => pattern.test(error))?.[1];
  return key ? toolExecutionError(await agentRefusal(key, { tool })) : result;
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
    ? { result: await agentRefusal('action.questionAcknowledged'), isError: false }
    : typeof constraints === 'string'
      ? toolExecutionError(constraints)
      : await inAnalystLanguage(await executeTool(toolUse, action.investigationId,
        constraints.surface === 'agent' ? { profileId: action.agentConfigId } : undefined, constraints), action.toolName);

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
 * changes agents, reaches another investigation, came from a server or from an
 * agent no longer deployed here. A supervisor row is filed under its target,
 * not the supervisor's home, so its reach cannot be read from the row: it
 * always needs individual review. */
async function isRoutineAction(action: AgentAction, settings: Settings): Promise<boolean> {
  if (action.id.startsWith('srv:') || action.agentConfigId === SUPERVISOR_ACTION_PROFILE) return false;
  const call: ToolUseBlock = { type: 'tool_use', id: action.id, name: action.toolName, input: action.toolInput };
  try {
    if (await proposerRemoved(action)) return false;
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
