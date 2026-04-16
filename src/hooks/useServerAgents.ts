/**
 * useServerAgents — manages the heartbeat handoff protocol with the team server.
 * When enabled, sends heartbeats every 30s. When the tab closes, the server
 * takes over running agents after a 90s grace period.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentDeployment, AgentProfile } from '../types';
import { db } from '../db';
import { useAuth } from '../contexts/AuthContext';
import {
  markHandoffPending,
  markReclaimPending,
  markClientRecovered,
  reconcileAfterHandoff,
} from '../lib/agent-handoff';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
/** Consecutive heartbeat failures before we flip deployments to handoff-pending.
 *  Two misses = ~60s gap, well under the server's 90s grace so we stop the
 *  local loop *before* the server starts its takeover. */
const HEARTBEAT_FAIL_THRESHOLD = 2;

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
  /** Consecutive heartbeat failures — resets on success. */
  const failureCountRef = useRef(0);
  /** Deployment IDs that we last flipped into handoff-pending, so we know
   *  which ones to recover when a heartbeat succeeds. */
  const pendingHandoffIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const apiCall = useCallback(async (path: string, method: string, body?: unknown) => {
    if (!serverUrl) throw new Error('No server connection');
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const resp = await fetch(`${serverUrl}/api/caddy-agents${path}`, {
      method,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    clearTimeout(timer);
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

        // Heartbeat succeeded — reset failure counter.
        failureCountRef.current = 0;

        // Recover any deployments we pre-emptively flipped to handoff-pending
        // during the prior failure window but that the server never claimed.
        if (pendingHandoffIdsRef.current.size > 0 && !result.serverWasRunning) {
          for (const id of pendingHandoffIdsRef.current) {
            await markClientRecovered(id).catch(err => console.warn('[useServerAgents] markClientRecovered failed:', err));
          }
          pendingHandoffIdsRef.current.clear();
        }

        if (result.serverWasRunning) {
          setServerRunning(false);
          // Handoff happened: deployments are implicitly in 'server' (or should
          // be). We must pull server-created actions BEFORE reconciling so the
          // reconcile summary has the right IDs to display.
          const currentDeployments = await db.agentDeployments
            .where('investigationId').equals(investigationId)
            .toArray();

          // Pull server-created actions first and remember their IDs so we can
          // attribute them to the reconcile summary below.
          const newServerActionIds: string[] = [];
          try {
            const actionsResult = await apiCall(`/actions/${investigationId}`, 'GET');
            if (actionsResult.actions?.length > 0) {
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
                  newServerActionIds.push(action.id);
                }
              }
            }
          } catch { /* non-critical — reconcile will fall back to the time-window path */ }

          for (const d of currentDeployments) {
            // Drive through the state machine. If we were tracking a pre-emptive
            // handoff-pending, the normal transitions apply; otherwise fabricate
            // the server-ownership bit since we never saw the real edge.
            if (d.handoffState !== 'server') {
              if (!d.handoffState || d.handoffState === 'client') {
                await markHandoffPending(d.id).catch(() => {});
              }
              if ((await db.agentDeployments.get(d.id))?.handoffState === 'handoff-pending') {
                await db.agentDeployments.update(d.id, { handoffState: 'server', updatedAt: Date.now() });
              }
            }
            await markReclaimPending(d.id).catch(() => {});
            // Attribute each deployment's share of the pulled actions to its
            // reconciliation. If the server API didn't disambiguate per
            // deployment, pass the full set — the summary is per-deployment but
            // the actions are scoped to the investigation anyway.
            await reconcileAfterHandoff(d.id, { serverActionIds: newServerActionIds })
              .catch(err => console.warn('[useServerAgents] reconcile failed:', err));
          }
          pendingHandoffIdsRef.current.clear();
        }
      } catch (err) {
        if (mountedRef.current) setError((err as Error).message);
        // Consecutive-failure tracking: after HEARTBEAT_FAIL_THRESHOLD misses
        // (~60s), pre-emptively flip deployments into handoff-pending so the
        // local cycle loop stops before the server's 90s grace elapses.
        failureCountRef.current += 1;
        if (failureCountRef.current >= HEARTBEAT_FAIL_THRESHOLD) {
          try {
            const currentDeployments = await db.agentDeployments
              .where('investigationId').equals(investigationId)
              .toArray();
            for (const d of currentDeployments) {
              if ((d.handoffState ?? 'client') === 'client') {
                const ok = await markHandoffPending(d.id);
                if (ok) pendingHandoffIdsRef.current.add(d.id);
              }
            }
          } catch (hfErr) {
            console.warn('[useServerAgents] failed to mark handoff-pending:', hfErr);
          }
        }
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
