import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, type AgentProfile, type AgentSoul } from '../types';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { listAgentProfiles, loadAgentPolicy, resolveAgentProfile } from '../lib/agent-profile-resolver';

const soul: AgentSoul = {
  identity: 'I hunt.', lessons: ['Check DNS first.'], strengths: [], weaknesses: [],
  lifetimeMetrics: { investigationsWorked: 1, totalCycles: 1, totalToolCalls: 1, tasksCompleted: 0, tasksRejected: 0, meetingsAttended: 0, performanceScore: 50 },
  updatedAt: 1,
};
const hunter = BUILTIN_AGENT_PROFILES.find(profile => profile.id === 'ap-threat-hunter') as AgentProfile;
/** The row a 2.0.2 persistSoul wrote: a frozen copy of every field plus the soul. */
const staleHunterRow: AgentProfile = {
  id: hunter.id, name: 'Old name', role: 'executive', systemPrompt: 'Old prompt', allowedTools: undefined,
  readOnlyEntityTypes: [], policy: { ...DEFAULT_AGENT_POLICY, autoApproveFetch: true, autoApproveCreate: true, autoApproveModify: true },
  soul, source: 'builtin', createdAt: 1, updatedAt: 1,
};
const userProfile: AgentProfile = { id: 'user-1', name: 'Custom', role: 'specialist', systemPrompt: 'Custom.', policy: DEFAULT_AGENT_POLICY, source: 'user', createdAt: 1, updatedAt: 1 };

beforeEach(async () => {
  await Promise.all([db.agentProfiles.clear(), db.folders.clear(), db.agentDeployments.clear()]);
});

describe('agent profile resolver', () => {
  it('returns the builtin from code when no row exists', async () => {
    const resolved = await resolveAgentProfile(hunter.id);
    expect(resolved?.systemPrompt).toBe(hunter.systemPrompt);
    expect(resolved?.soul).toBeUndefined();
  });

  it('takes only the soul from a materialised builtin row', async () => {
    await db.agentProfiles.put(staleHunterRow);
    const resolved = await resolveAgentProfile(hunter.id);
    expect(resolved).toMatchObject({ id: hunter.id, role: hunter.role, systemPrompt: hunter.systemPrompt, policy: hunter.policy, soul });
    expect(resolved?.name).toBe(hunter.name);
    expect(resolved?.allowedTools).toEqual(hunter.allowedTools);
    expect(resolved?.readOnlyEntityTypes).toEqual(hunter.readOnlyEntityTypes);
  });

  it('returns user profiles from the database and nothing for unknown ids', async () => {
    await db.agentProfiles.put(userProfile);
    expect(await resolveAgentProfile('user-1')).toEqual(userProfile);
    expect(await resolveAgentProfile('missing')).toBeUndefined();
    expect(await resolveAgentProfile(undefined)).toBeUndefined();
  });

  it('lists every builtin once, with its soul, then user profiles', async () => {
    await db.agentProfiles.bulkPut([staleHunterRow, userProfile]);
    const profiles = await listAgentProfiles();
    expect(profiles).toHaveLength(BUILTIN_AGENT_PROFILES.length + 1);
    expect(profiles.filter(profile => profile.id === hunter.id)).toHaveLength(1);
    expect(profiles.find(profile => profile.id === hunter.id)).toMatchObject({ systemPrompt: hunter.systemPrompt, soul });
    expect(profiles.at(-1)).toEqual(userProfile);
  });

  it('loads the effective policy with the investigation as ceiling and overrides that only clear', async () => {
    await db.agentProfiles.put(staleHunterRow);
    await db.folders.add({ id: 'case', name: 'Case', order: 0, createdAt: 1, agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveFetch: false, autoApproveCreate: true } });
    await db.agentDeployments.add({ id: 'dep', investigationId: 'case', profileId: hunter.id, status: 'idle', order: 0, createdAt: 1, updatedAt: 1,
      policyOverrides: { autoApproveCreate: false, autoApproveModify: true } });
    const policy = await loadAgentPolicy('case', { profileId: hunter.id, deploymentId: 'dep' });
    expect(policy.autoApproveFetch).toBe(false);   // folder ceiling
    expect(policy.autoApproveCreate).toBe(false);  // override clears
    expect(policy.autoApproveModify).toBe(false);  // stale row cannot grant; override cannot raise
  });
});
