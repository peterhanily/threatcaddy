/**
 * useAgentProfiles — CRUD hook for agent profiles, following useNoteTemplates pattern.
 * Merges builtin profiles with user-created ones.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { AgentProfile } from '../types';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';

export function useAgentProfiles() {
  const [userProfiles, setUserProfiles] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const profiles = await db.agentProfiles.orderBy('name').toArray();
    setUserProfiles(profiles);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** All profiles: builtins first, then user-created (memoized). */
  const profiles = useMemo(() => [...BUILTIN_AGENT_PROFILES, ...userProfiles], [userProfiles]);

  const createProfile = useCallback(async (partial: Partial<AgentProfile> & { name: string; systemPrompt: string }) => {
    const profile: AgentProfile = {
      id: nanoid(),
      name: partial.name,
      description: partial.description,
      icon: partial.icon,
      role: partial.role || 'specialist',
      systemPrompt: partial.systemPrompt,
      allowedTools: partial.allowedTools,
      policy: partial.policy || {
        autoApproveReads: true,
        autoApproveEnrich: true,
        autoApproveFetch: true,
        autoApproveCreate: false,
        autoApproveModify: false,
        intervalMinutes: 5,
      },
      model: partial.model,
      priority: partial.priority ?? 10,
      source: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.agentProfiles.add(profile);
    await reload();
    return profile;
  }, [reload]);

  const updateProfile = useCallback(async (id: string, updates: Partial<AgentProfile>) => {
    await db.agentProfiles.update(id, { ...updates, updatedAt: Date.now() });
    await reload();
  }, [reload]);

  const deleteProfile = useCallback(async (id: string) => {
    // Guard: check for active deployments referencing this profile
    const activeDeployments = await db.agentDeployments.where('profileId').equals(id).count();
    if (activeDeployments > 0) {
      throw new Error(`Cannot delete: ${activeDeployments} active deployment(s) use this profile. Remove them first.`);
    }
    await db.agentProfiles.delete(id);
    await reload();
  }, [reload]);

  const duplicateBuiltin = useCallback(async (builtinId: string) => {
    const builtin = BUILTIN_AGENT_PROFILES.find(p => p.id === builtinId);
    if (!builtin) return null;
    return createProfile({
      name: `${builtin.name} (Custom)`,
      description: builtin.description,
      icon: builtin.icon,
      role: builtin.role,
      systemPrompt: builtin.systemPrompt,
      allowedTools: builtin.allowedTools ? [...builtin.allowedTools] : undefined,
      policy: { ...builtin.policy },
      model: builtin.model,
      priority: builtin.priority,
    });
  }, [createProfile]);

  return {
    profiles,
    userProfiles,
    builtinProfiles: BUILTIN_AGENT_PROFILES,
    loading,
    reload,
    createProfile,
    updateProfile,
    deleteProfile,
    duplicateBuiltin,
  };
}
