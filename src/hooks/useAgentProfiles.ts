/**
 * useAgentProfiles — CRUD hook for agent profiles, following useNoteTemplates pattern.
 * Merges builtin profiles with user-created ones.
 */

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { AgentProfile } from '../types';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { listAgentProfiles } from '../lib/agent-profile-resolver';

const BUILTIN_IDS = new Set(BUILTIN_AGENT_PROFILES.map(profile => profile.id));

export function useAgentProfiles() {
  // Builtins (with stored souls) first, then user-created profiles.
  const [profiles, setProfiles] = useState<AgentProfile[]>(BUILTIN_AGENT_PROFILES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  useLayoutEffect(() => {
    ++requestVersion.current;
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++requestVersion.current;
    const current = () => mounted.current && requestVersion.current === request;
    setLoading(true);
    setError(null);
    try {
      // A stored builtin row contributes only its soul, so each builtin appears once.
      const all = await listAgentProfiles();
      if (!current()) return;
      const user = all.filter(profile => !BUILTIN_IDS.has(profile.id));
      // Names are encrypted at rest and cannot be sorted by an IndexedDB index.
      user.sort((a, b) => a.name.localeCompare(b.name));
      setProfiles([...all.filter(profile => BUILTIN_IDS.has(profile.id)), ...user]);
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : 'Failed to load agent profiles');
      throw err;
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload().catch(() => {}); // Error is exposed; mutation callers retain rejection semantics.
  }, [reload]);

  // Reload when agent tools create/modify profiles (define_specialist, soul updates)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void reload().catch(() => {}); }, 200);
    };
    window.addEventListener('tc-folders-changed', handler);
    return () => { clearTimeout(timer); window.removeEventListener('tc-folders-changed', handler); };
  }, [reload]);

  const userProfiles = useMemo(() => profiles.filter(profile => !BUILTIN_IDS.has(profile.id)), [profiles]);
  const builtinProfiles = useMemo(() => profiles.filter(profile => BUILTIN_IDS.has(profile.id)), [profiles]);

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
    builtinProfiles,
    loading,
    error,
    reload,
    createProfile,
    updateProfile,
    deleteProfile,
    duplicateBuiltin,
  };
}
