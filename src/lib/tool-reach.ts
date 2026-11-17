/**
 * Where a tool call reaches, and the one decision table every surface uses.
 * Decision sites run decideToolCall to pick the UX; dispatchTool runs it again
 * as the mandatory backstop. classifyToolCall runs inside the dispatcher's
 * Dexie transaction: Dexie reads only, no fetch, timers or dynamic imports.
 */
import { db } from '../db';
import type { AgentPolicy, Settings, ToolUseBlock } from '../types';
import {
  AGENT_AUTO_FETCH_HOSTS, AGENT_CONTROL_TOOLS, AGENT_NEVER_TOOLS, CROSS_CASE_READ_TOOLS,
  isEgressToolName, isTrustedFetchUrl, shouldAutoApprove,
} from './caddy-agent-policy';
import { isWriteTool } from './llm-tool-defs';
import { isDynamicTool } from './tool-binding';
import { isFolderLocalOnly, isShareableFolder } from './ai-scope';
import { BUILTIN_INTEGRATIONS } from './builtin-integrations';

export type ToolSurface = 'chat-act' | 'chat-yolo' | 'chat-plan' | 'agent' | 'supervisor' | 'bridge';
export type EgressKind = 'none' | 'trusted-fetch' | 'open-fetch' | 'vendor' | 'configured';
export type ReachFlag = 'untrusted-host' | 'url-carries-data' | 'host-is-ioc' | 'target-synced' | 'unfiled-sink';
export interface ToolReach {
  name: string;
  write: boolean;                 // isWriteTool(name)
  homeFolderId?: string;
  homeShareable: boolean;         // isShareableFolder(home)
  crossRead: boolean;             // cross-case reader, or a by-id read whose entity folder !== home (home defined)
  crossWrite: boolean;            // a write whose resolved target folder !== home ('' for unfiled)
  targetFolderIds: string[];      // resolved folders other than home (cards, tests)
  hidden: boolean;                // a resolved target is local-only (or trashed, for reads) while homeShareable
  egress: EgressKind;
  destinations: string[];         // fetch host; "VirusTotal (www.virustotal.com)"; siem/ticket/skill host
  agentControl?: 'never' | 'ask'; // AGENT_NEVER_TOOLS / AGENT_CONTROL_TOOLS
  harvested: boolean;             // toolUse.id starts with 'text_tc_' (calls parsed out of model text)
  flags: ReachFlag[];             // display only; never an input to decideToolCall
}
export type AskReason = 'write' | 'egress' | 'cross-read' | 'cross-write' | 'agent-control' | 'harvested' | 'policy';
export type Verdict = { kind: 'run' } | { kind: 'ask'; reason: AskReason } | { kind: 'deny'; message: string };

type EntityRow = { folderId?: string; trashed?: boolean } | undefined;

const READ_BY_ID: Record<string, 'notes' | 'tasks' | 'standaloneIOCs' | 'timelineEvents'> = {
  read_note: 'notes', read_task: 'tasks', read_ioc: 'standaloneIOCs', read_timeline_event: 'timelineEvents',
};
const UPDATE_BY_ID: Record<string, 'notes' | 'tasks' | 'standaloneIOCs' | 'timelineEvents'> = {
  update_note: 'notes', update_task: 'tasks', update_ioc: 'standaloneIOCs', update_timeline_event: 'timelineEvents',
};
const LINK_TABLE: Record<string, 'notes' | 'tasks' | 'timelineEvents'> = { note: 'notes', task: 'tasks', 'timeline-event': 'timelineEvents' };

const text = (value: unknown) => typeof value === 'string' ? value : '';
const getRow = async (table: 'notes' | 'tasks' | 'standaloneIOCs' | 'timelineEvents', id: unknown): Promise<EntityRow> =>
  text(id) ? await db.table(table).get(text(id)) as EntityRow : undefined;

/** Exact, case-insensitive name, as executeCreateInInvestigation resolves it. */
async function findInvestigationByExactName(name: string) {
  const lower = name.toLowerCase();
  if (!lower) return undefined;
  return (await db.folders.toArray()).find(folder => folder.name.toLowerCase() === lower);
}

/** Entity rows a call reads or writes by id, and investigations it names directly. */
async function resolveTargets(name: string, input: Record<string, unknown>): Promise<{ rows: EntityRow[]; folders: string[] }> {
  const rows: EntityRow[] = [];
  const folders: string[] = [];
  if (READ_BY_ID[name]) rows.push(await getRow(READ_BY_ID[name], input.id));
  else if (UPDATE_BY_ID[name]) rows.push(await getRow(UPDATE_BY_ID[name], input.id));
  else if (name === 'review_completed_task') rows.push(await getRow('tasks', input.taskId));
  else if (name === 'enrich_ioc') rows.push(await getRow('standaloneIOCs', input.iocId));
  else if (name === 'delete_note_folder') rows.push(await getRow('notes', input.folderId));
  else if (name === 'move_to_folder') rows.push(await getRow('notes', input.noteId), await getRow('notes', input.parentFolderId));
  else if (name === 'link_entities' && Array.isArray(input.links)) {
    for (const link of input.links as unknown[]) {
      if (!link || typeof link !== 'object') continue;
      const { sourceType, sourceId, targetType, targetId } = link as Record<string, unknown>;
      if (LINK_TABLE[text(sourceType)]) rows.push(await getRow(LINK_TABLE[text(sourceType)], sourceId));
      if (LINK_TABLE[text(targetType)]) rows.push(await getRow(LINK_TABLE[text(targetType)], targetId));
    }
  } else if (name === 'create_in_investigation') {
    const folder = text(input.investigationId) ? await db.folders.get(text(input.investigationId))
      : await findInvestigationByExactName(text(input.investigationName));
    if (folder) folders.push(folder.id);
  } else if (name === 'get_investigation_details') {
    const folder = text(input.id) ? await db.folders.get(text(input.id)) : await findInvestigationByExactName(text(input.name));
    if (folder) folders.push(folder.id);
  } else if (name === 'compare_investigations' && Array.isArray(input.investigationIds)) {
    for (const id of input.investigationIds as unknown[]) if (text(id) && await db.folders.get(text(id))) folders.push(text(id));
  }
  return { rows: rows.filter(Boolean), folders };
}

function hostOf(url: string): string | undefined {
  try { return new URL(url).hostname.toLowerCase(); } catch { return undefined; }
}

async function enrichDestinations(input: Record<string, unknown>, homeFolderId: string | undefined): Promise<string[]> {
  const ioc = text(input.iocId) ? await db.standaloneIOCs.get(text(input.iocId)) : undefined;
  if (!ioc) return [];
  const templates = new Map([...await db.integrationTemplates.toArray(), ...BUILTIN_INTEGRATIONS].map(t => [t.id, t]));
  const destinations: string[] = [];
  for (const installation of await db.installedIntegrations.filter(i => i.enabled).toArray()) {
    const template = templates.get(installation.templateId);
    if (!template) continue;
    if (installation.scopeType === 'investigation' && !installation.scopeFolderIds?.includes(homeFolderId ?? '')) continue;
    if (!template.triggers.some(t => (t.type === 'manual' || t.type === 'on-entity-create') && (!t.iocTypes?.length || t.iocTypes.includes(ioc.type)))) continue;
    destinations.push(template.requiredDomains?.length ? `${template.name} (${template.requiredDomains.join(', ')})` : template.name);
  }
  return destinations;
}

async function hostIsHomeIOC(host: string, homeFolderId: string | undefined): Promise<boolean> {
  if (!homeFolderId) return false;
  const iocs = await db.standaloneIOCs.where('folderId').equals(homeFolderId).toArray();
  return iocs.some(ioc => {
    if (ioc.trashed) return false;
    const value = ioc.type === 'url' ? hostOf(ioc.value) : ['domain', 'ipv4', 'ipv6'].includes(ioc.type) ? ioc.value.trim().toLowerCase().replace(/\.$/, '') : undefined;
    return !!value && (value === host || `[${value}]` === host);
  });
}

export async function classifyToolCall(call: ToolUseBlock, ctx: { homeFolderId?: string; settings: Settings }): Promise<ToolReach> {
  const { name } = call;
  const input = (call.input && typeof call.input === 'object' ? call.input : {}) as Record<string, unknown>;
  const home = ctx.homeFolderId;
  const homeShareable = await isShareableFolder(home);
  const write = isWriteTool(name);
  const flags: ReachFlag[] = [];
  const configured = ctx.settings as Settings & Record<string, unknown>;

  // Scope
  let crossRead = CROSS_CASE_READ_TOOLS.has(name);
  let crossWrite = false;
  let hidden = false;
  const others = new Set<string>();
  const { rows, folders } = await resolveTargets(name, input);
  const targets = [...rows.map(row => ({ folderId: row?.folderId ?? '', trashed: !!row?.trashed })), ...folders.map(folderId => ({ folderId, trashed: false }))];
  for (const target of targets) {
    if (!write && target.trashed) hidden = true;
    if (homeShareable && target.folderId && await isFolderLocalOnly(target.folderId)) hidden = true;
    if (target.folderId === (home ?? '')) continue;
    if (write) crossWrite = true;
    else if (home) crossRead = true;
    if (target.folderId) others.add(target.folderId);
    else if (write) flags.push('unfiled-sink');
  }
  for (const folderId of others) {
    if (await isShareableFolder(folderId)) { flags.push('target-synced'); break; }
  }

  // Egress
  let egress: EgressKind = 'none';
  let destinations: string[] = [];
  if (name === 'fetch_url') {
    const url = text(input.url);
    const host = hostOf(url);
    egress = isTrustedFetchUrl(url) ? 'trusted-fetch' : 'open-fetch';
    destinations = [host ?? url.slice(0, 200)];
    if (!host || !AGENT_AUTO_FETCH_HOSTS.includes(host)) flags.push('untrusted-host');
    try {
      const parsed = new URL(url);
      let carried = parsed.pathname + parsed.search;
      try { carried = decodeURIComponent(carried); } catch { /* Keep the encoded length. */ }
      if (carried.length > 256) flags.push('url-carries-data');
    } catch { /* Unparseable URLs are refused by the fetch path. */ }
    if (host && await hostIsHomeIOC(host, home)) flags.push('host-is-ioc');
  } else if (name === 'enrich_ioc') {
    egress = 'vendor';
    destinations = await enrichDestinations(input, home);
  } else if (name === 'query_siem') {
    egress = 'configured';
    destinations = [hostOf(text(configured.siemEndpoint)) ?? 'SIEM'];
  } else if (name === 'create_ticket') {
    if (text(configured.ticketEndpoint)) {
      egress = 'configured';
      destinations = [hostOf(text(configured.ticketEndpoint)) ?? 'ticketing system'];
    }
  } else if (isDynamicTool(name)) {
    // Whatever class a host declares for its skill, the call leaves this device.
    egress = 'configured';
    const host = name.startsWith('local:') ? undefined : ctx.settings.agentHosts?.find(h => h.name === name.split(':')[1]);
    destinations = [hostOf(name.startsWith('local:') ? text(ctx.settings.llmLocalEndpoint) : text(host?.url)) ?? name];
  }

  return {
    name, write, homeFolderId: home, homeShareable, crossRead, crossWrite,
    targetFolderIds: [...others], hidden, egress, destinations,
    agentControl: AGENT_NEVER_TOOLS.has(name) ? 'never' : AGENT_CONTROL_TOOLS.has(name) ? 'ask' : undefined,
    harvested: typeof call.id === 'string' && call.id.startsWith('text_tc_'),
    flags,
  };
}

const NOT_FOUND = 'Not found in this investigation.';

/** Section 2.4 of the 2.0.3 design, first matching row wins. Pure and synchronous.
 * A decision site may be stricter than this table, never looser. */
export function decideToolCall(reach: ToolReach, ctx: { surface: ToolSurface; policy?: AgentPolicy }): Verdict {
  const { surface, policy } = ctx;
  const chat = surface === 'chat-act' || surface === 'chat-yolo';
  const run: Verdict = { kind: 'run' };
  const ask = (reason: AskReason): Verdict => ({ kind: 'ask', reason });
  const deny = (message: string): Verdict => ({ kind: 'deny', message });
  // Agent rows that consult the policy ask when none was supplied.
  const byPolicy = (allows: (p: AgentPolicy) => boolean | undefined, reason: AskReason): Verdict => policy && allows(policy) ? run : ask(reason);
  const egress = reach.egress !== 'none';

  if (reach.hidden) return deny(NOT_FOUND);                                                       // 1
  if (surface === 'chat-plan') {                                                                   // 2
    return !reach.write && !egress && !reach.agentControl && !reach.crossRead ? run : deny('Plan mode only reads this investigation.');
  }
  if (reach.agentControl === 'never') {                                                            // 3
    return chat ? ask('agent-control') : deny(`Tool "${reach.name}" is not available ${surface === 'bridge' ? 'through the agent bridge' : 'to agents'}.`);
  }
  if (surface === 'bridge' && (reach.crossRead || reach.crossWrite || egress || reach.agentControl)) { // 4
    return deny('The agent bridge only works inside the selected investigation and cannot reach the network.');
  }
  if (reach.harvested && (reach.write || egress || reach.agentControl || reach.crossRead)) return ask('harvested'); // 5
  if (reach.agentControl === 'ask') return surface === 'supervisor' ? deny('The supervisor cannot change agents.') : ask('agent-control'); // 6
  if (reach.crossWrite) return surface === 'agent' ? deny('Agents cannot change another investigation.') : ask('cross-write'); // 7
  if (reach.crossRead) {                                                                           // 8
    if (chat) return reach.homeShareable ? ask('cross-read') : run;
    if (surface === 'agent') {
      return CROSS_CASE_READ_TOOLS.has(reach.name) && !reach.homeShareable
        ? byPolicy(p => p.autoApproveReads, 'cross-read')
        : deny('Agents cannot read other investigations from this investigation.');
    }
    return run;
  }
  if (egress && surface === 'supervisor') return deny('The supervisor cannot reach the network.');  // 9-12
  if (reach.egress === 'open-fetch' || reach.egress === 'configured') return ask('egress');        // 9, 12
  if (reach.egress === 'trusted-fetch') return surface === 'agent' ? byPolicy(p => p.autoApproveFetch, 'egress') : ask('egress'); // 10
  if (reach.egress === 'vendor') {                                                                 // 11
    if (surface === 'agent') return byPolicy(p => p.autoApproveEnrich, 'egress');
    return surface === 'chat-yolo' ? run : ask('egress');
  }
  if (reach.write) {                                                                               // 13
    if (surface === 'chat-act') return ask('write');
    if (surface === 'agent') return byPolicy(p => shouldAutoApprove(reach.name, p), 'policy');
    return run;
  }
  return surface === 'agent' ? byPolicy(p => shouldAutoApprove(reach.name, p), 'policy') : run;   // 14
}

/** Static: a tool Plan mode may offer and run. */
export function isPlanModeTool(name: string): boolean {
  return !isWriteTool(name) && !isEgressToolName(name) && !AGENT_NEVER_TOOLS.has(name) && !AGENT_CONTROL_TOOLS.has(name)
    && !CROSS_CASE_READ_TOOLS.has(name) && !isDynamicTool(name);
}

/** No egress, no agent change, nothing outside the home investigation, not harvested. */
export function isRoutineReach(reach: ToolReach): boolean {
  return reach.egress === 'none' && !reach.agentControl && !reach.crossRead && !reach.crossWrite && !reach.harvested && !reach.hidden;
}
