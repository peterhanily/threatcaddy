import { db } from '../db';
import { DEFAULT_AGENT_POLICY, type ToolUseBlock } from '../types';
import { shouldAutoApprove } from './caddy-agent-policy';
import { getToolExecutionError } from './llm-tool-execution';
import { isWriteTool } from './llm-tool-defs';

/** The supervisor's existing advertised capabilities; enforced at dispatch too. */
export const SUPERVISOR_TOOLS: ReadonlySet<string> = new Set([
  'list_investigations', 'get_investigation_details', 'search_across_investigations',
  'compare_investigations', 'get_investigation_summary', 'list_iocs', 'search_notes',
  'create_note', 'create_task', 'link_entities', 'update_ioc',
]);
export const SUPERVISOR_ACTION_PROFILE = 'caddy-supervisor';

type SupervisorPermission =
  | { kind: 'allowed' | 'approval-required'; investigationId: string }
  | { kind: 'denied'; error: string };

/** Resolve actual write targets before applying each investigation's policy. */
export async function getSupervisorToolPermission(
  toolUse: ToolUseBlock,
  supervisorFolderId: string,
): Promise<SupervisorPermission> {
  const inputError = getToolExecutionError(toolUse, { allowedTools: SUPERVISOR_TOOLS });
  if (inputError) return { kind: 'denied', error: inputError };
  if (!isWriteTool(toolUse.name)) {
    const supervisor = await db.folders.get(supervisorFolderId);
    if (!supervisor) return { kind: 'denied', error: 'Supervisor investigation no longer exists.' };
    const crossInvestigationRead = ['list_investigations', 'get_investigation_details', 'search_across_investigations', 'compare_investigations'].includes(toolUse.name);
    // Cross-case queries can reveal multiple investigations. Require approval if
    // any source disallows automatic reads, rather than relying on model scope.
    const sources = crossInvestigationRead ? await db.folders.toArray() : [supervisor];
    return {
      kind: sources.every(folder => shouldAutoApprove(toolUse.name, folder.agentPolicy ?? DEFAULT_AGENT_POLICY)) ? 'allowed' : 'approval-required',
      investigationId: supervisorFolderId,
    };
  }

  const input = toolUse.input as Record<string, unknown>;
  const targetFolders = new Set<string>();
  const addTarget = (entity: { folderId?: string; trashed?: boolean } | undefined): boolean => {
    if (!entity?.folderId || entity.trashed) return false;
    targetFolders.add(entity.folderId);
    return true;
  };

  if (toolUse.name === 'create_note' || toolUse.name === 'create_task') {
    targetFolders.add(supervisorFolderId);
  } else if (toolUse.name === 'update_ioc') {
    if (!addTarget(await db.standaloneIOCs.get(String(input.id || '')))) {
      return { kind: 'denied', error: 'Supervisor IOC updates require an existing IOC in an investigation.' };
    }
  } else if (toolUse.name === 'link_entities') {
    if (!Array.isArray(input.links) || input.links.length === 0) return { kind: 'denied', error: 'links array is required.' };
    for (const link of input.links) {
      if (!link || typeof link !== 'object') return { kind: 'denied', error: 'Each link must identify existing entities.' };
      for (const end of ['source', 'target'] as const) {
        const type = link[`${end}Type`];
        const id = String(link[`${end}Id`] || '');
        const entity = type === 'note' ? await db.notes.get(id)
          : type === 'task' ? await db.tasks.get(id)
          : type === 'timeline-event' ? await db.timelineEvents.get(id)
          : undefined;
        if (!addTarget(entity)) return { kind: 'denied', error: 'Supervisor links require existing note, task or timeline entities in investigations.' };
      }
    }
  } else {
    return { kind: 'denied', error: 'Supervisor write scope is not supported for this tool.' };
  }

  let autoApprove = true;
  for (const id of targetFolders) {
    const folder = await db.folders.get(id);
    if (!folder || folder.status === 'archived') return { kind: 'denied', error: 'Supervisor writes require an existing, non-archived investigation.' };
    if (!shouldAutoApprove(toolUse.name, folder.agentPolicy ?? DEFAULT_AGENT_POLICY)) autoApprove = false;
  }
  return {
    kind: autoApprove ? 'allowed' : 'approval-required',
    investigationId: [...targetFolders][0],
  };
}

/** Repeat target/policy checks at the dispatch boundary after asynchronous work. */
export async function validateSupervisorDispatch(toolUse: ToolUseBlock, supervisorFolderId: string): Promise<string | undefined> {
  const permission = await getSupervisorToolPermission(toolUse, supervisorFolderId);
  if (permission.kind === 'denied') return permission.error;
  if (permission.kind === 'approval-required') return 'This supervisor action requires analyst approval.';
}
