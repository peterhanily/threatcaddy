/**
 * useServerAgents — manages the heartbeat handoff protocol with the team server.
 * When enabled, sends heartbeats every 30s. When the tab closes, the server
 * takes over running agents after a 90s grace period.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentDeployment, AgentProfile } from '../types';
import { db } from '../db';
import { useAuth } from '../contexts/AuthContext';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

interface UseServerAgentsOptions {
  investigationId?: string;
  deployments: AgentDeployment[];
  profiles: AgentProfile[];
  enabled: boolean;
}

interface UseServerAgentsResult {
  serverRegistered: boolean;
  serverRunning: boolean;
  registering: boolean;
  error: string | null;
  registerServerAgents: () => Promise<void>;
  unregisterServerAgents: () => Promise<void>;
}

export function useServerAgents({ investigationId, deployments, profiles, enabled }: UseServerAgentsOptions): UseServerAgentsResult {
  const { serverUrl, getAccessToken } = useAuth();
  const [serverRegistered, setServerRegistered] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const apiCall = useCallback(async (path: string, method: string, body?: unknown) => {
    if (!serverUrl) throw new Error('No server connection');
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');
    const resp = await fetch(`${serverUrl}/api/caddy-agents${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Server ${resp.status}: ${text.substring(0, 200)}`);
    }
    return resp.json();
  }, [serverUrl, getAccessToken]);

  const registerServerAgents = useCallback(async () => {
    if (!investigationId || deployments.length === 0) return;
    setRegistering(true);
    setError(null);
    try {
      const body = {
        investigationId,
        deployments: deployments.map(d => {
          const profile = profiles.find(p => p.id === d.profileId);
          if (!profile) return null;
          return {
            deploymentId: d.id,
            profile: {
              id: profile.id,
              name: profile.name,
              description: profile.description,
              role: profile.role,
              systemPrompt: profile.systemPrompt,
              allowedTools: profile.allowedTools,
              readOnlyEntityTypes: profile.readOnlyEntityTypes,
              policy: profile.policy,
              model: profile.model,
            },
            policyOverrides: d.policyOverrides,
            order: d.order,
          };
        }).filter(Boolean),
      };
      const result = await apiCall('/register', 'POST', body);
      if (mountedRef.current) {
        setServerRegistered(true);
        // Store botConfigIds on deployments
        for (const { deploymentId, botConfigId } of result.botConfigs || []) {
          await db.agentDeployments.update(deploymentId, { serverBotConfigId: botConfigId, serverSideEnabled: true });
        }
      }
    } catch (err) {
      if (mountedRef.current) setError((err as Error).message);
    } finally {
      if (mountedRef.current) setRegistering(false);
    }
  }, [investigationId, deployments, profiles, apiCall]);

  const unregisterServerAgents = useCallback(async () => {
    if (!investigationId) return;
    try {
      await apiCall('/unregister', 'POST', { investigationId });
      if (mountedRef.current) {
        setServerRegistered(false);
        setServerRunning(false);
        // Clear server fields on deployments
        for (const d of deployments) {
          await db.agentDeployments.update(d.id, { serverBotConfigId: undefined, serverSideEnabled: false });
        }
      }
    } catch (err) {
      if (mountedRef.current) setError((err as Error).message);
    }
  }, [investigationId, deployments, apiCall]);

  // Heartbeat loop
  useEffect(() => {
    if (!enabled || !serverRegistered || !investigationId || !serverUrl) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    const sendHeartbeat = async () => {
      try {
        const result = await apiCall('/heartbeat', 'POST', { investigationId });
        if (!mountedRef.current) return;
        if (result.serverWasRunning) {
          setServerRunning(false);
          // Pull server-created actions
          try {
            const actionsResult = await apiCall(`/actions/${investigationId}`, 'GET');
            if (actionsResult.actions?.length > 0) {
              // Merge into local agentActions
              for (const action of actionsResult.actions) {
                const existing = await db.agentActions.get(action.id);
                if (!existing) {
                  await db.agentActions.add({
                    id: action.id,
                    investigationId: action.investigationId,
                    threadId: action.threadId || '',
                    agentConfigId: action.botConfigId,
                    toolName: action.toolName,
                    toolInput: action.toolInput || {},
                    rationale: action.rationale || '',
                    status: action.status,
                    resultSummary: action.resultSummary,
                    severity: action.severity,
                    createdAt: new Date(action.createdAt).getTime(),
                    executedAt: action.executedAt ? new Date(action.executedAt).getTime() : undefined,
                    reviewedAt: action.reviewedAt ? new Date(action.reviewedAt).getTime() : undefined,
                  });
                }
              }
            }
          } catch { /* non-critical */ }
        }
      } catch (err) {
        if (mountedRef.current) setError((err as Error).message);
      }
    };

    // Send first heartbeat immediately
    sendHeartbeat();
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [enabled, serverRegistered, investigationId, serverUrl, apiCall]);

  // Check initial status
  useEffect(() => {
    if (!investigationId || !serverUrl) return;
    apiCall(`/status/${investigationId}`, 'GET')
      .then(result => {
        if (mountedRef.current) {
          setServerRegistered(result.registered);
          setServerRunning(result.serverRunning);
        }
      })
      .catch(() => {});
  }, [investigationId, serverUrl, apiCall]);

  return {
    serverRegistered,
    serverRunning,
    registering,
    error,
    registerServerAgents,
    unregisterServerAgents,
  };
}
