/**
 * useAgentDeployments — manages agent profile assignments to investigations.
 */

import { useState, useEffect, useCallback } from 'react';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { AgentDeployment, AgentProfile, ChatThread, LLMProvider } from '../types';

export function useAgentDeployments(investigationId?: string) {
  const [deployments, setDeployments] = useState<AgentDeployment[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!investigationId) {
      setDeployments([]);
      setLoading(false);
      return;
    }
    const results = await db.agentDeployments
      .where('[investigationId+order]')
      .between([investigationId, -Infinity], [investigationId, Infinity])
      .toArray();
    setDeployments(results);
    setLoading(false);
  }, [investigationId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Reload when deployments change from tool calls (deploy_agent, stop_agent, etc.)
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener('tc-folders-changed', handler);
    return () => window.removeEventListener('tc-folders-changed', handler);
  }, [reload]);

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
    await db.agentDeployments.delete(deploymentId);
    await reload();
  }, [reload]);

  const updateDeployment = useCallback(async (deploymentId: string, updates: Partial<AgentDeployment>) => {
    await db.agentDeployments.update(deploymentId, { ...updates, updatedAt: Date.now() });
    await reload();
  }, [reload]);

  return {
    deployments,
    loading,
    reload,
    deployProfile,
    removeDeployment,
    updateDeployment,
  };
}
