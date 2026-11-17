import { nanoid } from 'nanoid';
import { db } from '../db';
import type { AgentAction } from '../types';

/** Shared approval queue for investigation agents and the supervisor. A call
 * parsed out of model text keeps the text_tc_ marker in its row id, so "Approve
 * all" still sees it as harvested; approving it alone runs it with a fresh id. */
export async function queueAgentAction(
  proposal: Omit<AgentAction, 'id' | 'status' | 'createdAt'>,
  options: { harvested?: boolean } = {},
): Promise<{ action: AgentAction; alreadyPending: boolean }> {
  return db.transaction('rw', db.agentActions, async () => {
    const inputJson = JSON.stringify(proposal.toolInput);
    const existing = await db.agentActions
      .where('[investigationId+status]').equals([proposal.investigationId, 'pending'])
      .filter(action => action.agentConfigId === proposal.agentConfigId && action.toolBinding === proposal.toolBinding && action.toolName === proposal.toolName && JSON.stringify(action.toolInput) === inputJson)
      .first();
    if (existing) return { action: existing, alreadyPending: true };

    const action: AgentAction = { ...proposal, id: `${options.harvested ? 'text_tc_' : ''}${nanoid()}`, status: 'pending', createdAt: Date.now() };
    await db.agentActions.add(action);
    return { action, alreadyPending: false };
  });
}
