/**
 * useServerAgents — retains the client handoff protocol for compatibility.
 * Current team servers explicitly disable AgentCaddy execution until server
 * tool restrictions, read-only policies and durable approvals have parity.
 * The unavailable response must leave ownership with the open client; this
 * hook does not provide background takeover when a tab closes.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentActionStatus, AgentDeployment, AgentProfile } from '../types';
import { db } from '../db';
import { useAuth } from '../contexts/AuthContext';
import { TOOL_DEFINITIONS, DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS } from '../lib/llm-tool-defs';
import {
  markHandoffPending,
  markReclaimPending,
  markClientRecovered,
  reconcileAfterHandoff,
} from '../lib/agent-handoff';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
/** Legacy protocol threshold for compatible servers: two missed heartbeats
 *  precede the proposed 90s takeover grace. Current servers disable takeover. */
const HEARTBEAT_FAIL_THRESHOLD = 2;

/** Server rows are stored as terminal history only (srv: ids), never as approvable proposals. */
const STATIC_TOOL_NAMES: ReadonlySet<string> = new Set(
  [...TOOL_DEFINITIONS, ...DELEGATION_TOOL_DEFINITIONS, ...EXECUTIVE_TOOL_DEFINITIONS].map(tool => tool.name));
const TERMINAL_STATUSES: ReadonlySet<string> = new Set<AgentActionStatus>(['executed', 'failed', 'rejected']);
/** Milliseconds for a server timestamp; NaN when present but unparseable. */
const serverTime = (value: unknown) => value ? new Date(value as string).getTime() : undefined;

interface UseServerAgentsOptions {
  investigationId?: string;
  deployments: AgentDeployment[];
  profiles: AgentProfile[];
  enabled: boolean;
}

interface UseServerAgentsResult {
  serverRegistered: boolean;
  serverRunning: boolean;
  /** True only after the server said it can run agents; no 2.0.x server does. */
  serverExecutionAvailable: boolean;
  /** Deployments an unavailable answer paused, for the panel to name in the analyst's language. */
  pausedDeploymentIds: string[];
  registering: boolean;
  error: string | null;
  registerServerAgents: () => Promise<void>;
  unregisterServerAgents: () => Promise<void>;
}

export function useServerAgents({ investigationId, deployments, profiles, enabled }: UseServerAgentsOptions): UseServerAgentsResult {
  const { serverUrl, getAccessToken } = useAuth();
  const [serverRegistered, setServerRegistered] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverExecutionAvailable, setServerExecutionAvailable] = useState(false);
  const [pausedDeploymentIds, setPausedDeploymentIds] = useState<string[]>([]);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  /** Consecutive heartbeat failures — resets on success. */
  const failureCountRef = useRef(0);
  /** Deployment IDs that we last flipped into handoff-pending, so we know
   *  which ones to recover when a heartbeat succeeds. */
  const pendingHandoffIdsRef = useRef<Set<string>>(new Set());
  const deploymentsRef = useRef(deployments);

  useEffect(() => { deploymentsRef.current = deployments; }, [deployments]);

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
      try {
        const unavailable = JSON.parse(text);
        if (unavailable.serverExecutionAvailable === false) return unavailable;
      } catch { /* ordinary error response below */ }
      throw new Error(`Server ${resp.status}: ${text.substring(0, 200)}`);
    }
    return resp.json();
  }, [serverUrl, getAccessToken]);

  const handleUnavailable = useCallback(async (result: { serverExecutionAvailable?: boolean; reason?: string; error?: string }) => {
    if (result.serverExecutionAvailable !== false) return false;
    if (mountedRef.current) {
      setServerRegistered(false);
      setServerRunning(false);
      setServerExecutionAvailable(false);
    }
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    failureCountRef.current = 0;
    pendingHandoffIdsRef.current.clear();
    // An unavailable server must not implicitly hand an active deployment back
    // to the browser. Preserve its ownership state and require an explicit run.
    const paused: string[] = [];
    await db.transaction('rw', db.agentDeployments, async () => {
      for (const deployment of deploymentsRef.current) {
        const current = await db.agentDeployments.get(deployment.id);
        if (!current) continue;
        if (!current.serverSideEnabled && (!current.handoffState || current.handoffState === 'client')) continue;
        // Repeated unavailable responses (including stale in-flight requests)
        // must not keep rewriting already-paused deployments or restart effects.
        if (!current.serverSideEnabled && current.status === 'paused') continue;
        await db.agentDeployments.update(current.id, { serverSideEnabled: false, status: 'paused', updatedAt: Date.now() });
        paused.push(current.id);
      }
    });
    // Every 2.0.x server answers unavailable, so the answer itself is no error;
    // only a pause is news, and the panel says it in the analyst's language.
    if (paused.length && mountedRef.current) setPausedDeploymentIds(ids => [...new Set([...ids, ...paused])]);
    return true;
  }, []);

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
      if (await handleUnavailable(result)) return;
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
  }, [investigationId, deployments, profiles, apiCall, handleUnavailable]);

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
        if (await handleUnavailable(result)) return;

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
                // History only: a srv: id, the requested investigation and a
                // terminal status, so no server row can be approved here.
                const id = `srv:${action.id}`;
                const createdAt = serverTime(action.createdAt);
                const executedAt = serverTime(action.executedAt);
                const reviewedAt = serverTime(action.reviewedAt);
                if (!STATIC_TOOL_NAMES.has(action.toolName)) continue;
                if (!Number.isFinite(createdAt) || [executedAt, reviewedAt].some(time => time !== undefined && !Number.isFinite(time))) continue;
                const terminal = TERMINAL_STATUSES.has(action.status);
                const existing = await db.agentActions.get(id);
                if (!existing) {
                  await db.agentActions.add({
                    id,
                    investigationId,
                    threadId: action.threadId || '',
                    // Nullable server columns are absent fields locally (backup shape).
                    agentConfigId: action.botConfigId ?? undefined,
                    toolName: action.toolName,
                    toolInput: action.toolInput || {},
                    rationale: action.rationale || '',
                    status: terminal ? action.status : 'rejected',
                    resultSummary: terminal ? action.resultSummary ?? undefined : 'Server proposal not imported',
                    severity: action.severity ?? undefined,
                    createdAt: createdAt as number,
                    executedAt,
                    reviewedAt,
                  });
                  newServerActionIds.push(id);
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
        // local loop stops before a compatible server's proposed 90s grace.
        // Current servers reject registration and do not enter this protocol.
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
  }, [enabled, serverRegistered, investigationId, serverUrl, apiCall, handleUnavailable]);

  // Check initial status
  useEffect(() => {
    if (!investigationId || !serverUrl) return;
    apiCall(`/status/${investigationId}`, 'GET')
      .then(async result => {
        if (await handleUnavailable(result)) return;
        if (mountedRef.current) {
          setServerRegistered(result.registered);
          setServerRunning(result.serverRunning);
          setServerExecutionAvailable(result.serverExecutionAvailable === true);
        }
      })
      .catch(() => {});
  }, [investigationId, serverUrl, apiCall, handleUnavailable]);

  return {
    serverRegistered,
    serverRunning,
    serverExecutionAvailable,
    pausedDeploymentIds,
    registering,
    error,
    registerServerAgents,
    unregisterServerAgents,
  };
}
