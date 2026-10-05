/**
 * useAgentDeployments — manages agent profile assignments to investigations.
 */

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { AgentDeployment, AgentProfile, ChatThread, LLMProvider } from '../types';

export function useAgentDeployments(investigationId?: string) {
  const scope = useMemo(() => ({ investigationId }), [investigationId]);
  const activeScope = useRef<typeof scope | null>(null);
  const requestVersion = useRef(0);
  const [snapshot, setSnapshot] = useState<{ scope: typeof scope; deployments: AgentDeployment[]; loading: boolean; error: string | null }>(
    { scope, deployments: [], loading: !!investigationId, error: null },
  );
  const deployments = useMemo(() => snapshot.scope === scope ? snapshot.deployments : [], [snapshot, scope]);
  const loading = !!investigationId && (snapshot.scope !== scope || snapshot.loading);
  const error = snapshot.scope === scope ? snapshot.error : null;

  useLayoutEffect(() => {
    ++requestVersion.current;
    activeScope.current = scope;
    return () => { activeScope.current = null; };
  }, [scope]);

  const reload = useCallback(async () => {
    if (!investigationId || activeScope.current !== scope) return;
    const request = ++requestVersion.current;
    const current = () => activeScope.current === scope && requestVersion.current === request;
    setSnapshot(previous => ({ scope, deployments: previous.scope === scope ? previous.deployments : [], loading: true, error: null }));
    try {
      const results = await db.agentDeployments
        .where('[investigationId+order]')
        .between([investigationId, -Infinity], [investigationId, Infinity])
        .toArray();
      if (current()) setSnapshot({ scope, deployments: results, loading: false, error: null });
    } catch (err) {
      if (!current()) return;
      setSnapshot(previous => ({ ...previous, loading: false, error: err instanceof Error ? err.message : 'Failed to load agent deployments' }));
      throw err;
    }
  }, [investigationId, scope]);

  useEffect(() => {
    void reload().catch(() => {}); // Exposed through error; explicit callers still receive the rejection.
  }, [reload]);

  // Reload when deployments change from tool calls (deploy_agent, stop_agent, etc.)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void reload().catch(() => {}); }, 200);
    }; // slight delay for Dexie write to commit
    window.addEventListener('tc-folders-changed', handler);
    return () => { clearTimeout(timer); window.removeEventListener('tc-folders-changed', handler); };
  }, [reload]);

  // Periodic poll as fallback — catches deployments created by agents or other tabs
  useEffect(() => {
    if (!investigationId) return;
    const timer = setInterval(() => { void reload().catch(() => {}); }, 10_000);
    return () => clearInterval(timer);
  }, [investigationId, reload]);

  const deployProfile = useCallback(async (profile: AgentProfile, settings?: { model?: string; provider?: LLMProvider }) => {
    if (!investigationId) return null;

    // Determine next order
    const maxOrder = deployments.reduce((max, d) => Math.max(max, d.order), -1);

    // Create audit trail thread
    const threadId = nanoid();
    const thread: ChatThread = {
      id: threadId,
      title: `Agent: ${profile.name}`,
      messages: [],
      model: settings?.model || profile.model || 'claude-sonnet-4-6',
      provider: (settings?.provider || 'anthropic') as LLMProvider,
      folderId: investigationId,
      tags: [],
      source: 'agent',
      trashed: false,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.chatThreads.add(thread);

    const deployment: AgentDeployment = {
      id: nanoid(),
      investigationId,
      profileId: profile.id,
      threadId,
      status: 'idle',
      order: maxOrder + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.agentDeployments.add(deployment);
    await reload();
    return deployment;
  }, [investigationId, deployments, reload]);

  const removeDeployment = useCallback(async (deploymentId: string) => {
    // Cascade: delete the deployment's audit thread and associated actions
    const deployment = await db.agentDeployments.get(deploymentId);
    await db.transaction('rw', [db.agentDeployments, db.chatThreads, db.agentActions], async () => {
      await db.agentDeployments.delete(deploymentId);
      if (deployment?.threadId) {
        await db.chatThreads.delete(deployment.threadId);
        await db.agentActions.where('threadId').equals(deployment.threadId).delete();
      }
    });
    await reload();
  }, [reload]);

  const updateDeployment = useCallback(async (deploymentId: string, updates: Partial<AgentDeployment>) => {
    await db.agentDeployments.update(deploymentId, { ...updates, updatedAt: Date.now() });
    await reload();
  }, [reload]);

  return {
    deployments,
    loading,
    error,
    reload,
    deployProfile,
    removeDeployment,
    updateDeployment,
  };
}
