import { db } from '../db';
import type { AgentPolicy, AgentProfile } from '../types';
import { BUILTIN_AGENT_PROFILES } from './builtin-agent-profiles';
import { resolveEffectivePolicy } from './caddy-agent-policy';

// Static import: these readers run inside the dispatcher's Dexie transaction,
// where awaiting a dynamic import would commit it early.
const builtinById = new Map(BUILTIN_AGENT_PROFILES.map(profile => [profile.id, profile]));

/** Code wins for builtins: a materialised row (persistSoul) contributes only its soul. */
export async function resolveAgentProfile(id: string | undefined): Promise<AgentProfile | undefined> {
  if (!id) return undefined;
  const row = await db.agentProfiles.get(id);
  const builtin = builtinById.get(id);
  if (!builtin) return row;
  return row?.soul ? { ...builtin, soul: row.soul } : builtin;
}

/** The builtins (with their souls) followed by user rows that are not builtin ids. */
export async function listAgentProfiles(): Promise<AgentProfile[]> {
  const rows = await db.agentProfiles.toArray();
  const soulById = new Map(rows.map(row => [row.id, row.soul]));
  return [
    ...BUILTIN_AGENT_PROFILES.map(builtin => {
      const soul = soulById.get(builtin.id);
      return soul ? { ...builtin, soul } : builtin;
    }),
    ...rows.filter(row => !builtinById.has(row.id)),
  ];
}

export async function loadAgentPolicy(folderId: string | undefined, ctx?: { profileId?: string; deploymentId?: string }): Promise<AgentPolicy> {
  const folder = folderId ? await db.folders.get(folderId) : undefined;
  const profile = await resolveAgentProfile(ctx?.profileId);
  const deployment = ctx?.deploymentId ? await db.agentDeployments.get(ctx.deploymentId) : undefined;
  return resolveEffectivePolicy(folder?.agentPolicy, profile?.policy, deployment?.policyOverrides, !!profile);
}
