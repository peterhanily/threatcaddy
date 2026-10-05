import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import type { PresenceUser } from '../types';
import type { SyncResult } from '../lib/server-api';
import { configureServerApi } from '../lib/server-api';
import { syncEngine } from '../lib/sync-engine';
import { enableSync, disableSync } from '../lib/sync-middleware';
import { WSClient } from '../lib/ws-client';

interface AuthState {
  user?: { id: string } | null;
  serverUrl: string | null;
  connected: boolean;
  getAccessToken: () => Promise<string | null>;
  invalidateAccessToken?: () => void;
  setReachable: (ok: boolean) => void;
}

interface ReloadFns {
  notes: () => void;
  tasks: () => void;
  timeline: () => void;
  timelines: () => void;
  whiteboards: () => void;
  standaloneIOCs: () => void;
  evidenceItems?: () => void;
  chats: () => void;
  folders: () => void;
  tags: () => void;
  /** Called after any sync pull that wrote changes — used to refresh remote state */
  onSyncPullComplete?: () => void;
}

/**
 * Manages server sync engine, WebSocket connection, presence, and conflict state.
 * Extracted from App.tsx to isolate sync concerns.
 */
export function useServerSync(auth: AuthState, reloadFns: ReloadFns, onFolderInvite?: (folderId: string) => void) {
  const scope = useMemo(() => ({ serverUrl: auth.serverUrl, connected: auth.connected, userId: auth.user?.id }), [auth.serverUrl, auth.connected, auth.user?.id]);
  const activeScope = useRef<typeof scope | null>(null);
  const callbacks = useRef({ auth, reloadFns, onFolderInvite });
  const [stateScope, setStateScope] = useState(scope);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncResult[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const wsClientRef = useRef<WSClient | null>(null);

  useLayoutEffect(() => {
    callbacks.current = { auth, reloadFns, onFolderInvite };
  }, [auth, reloadFns, onFolderInvite]);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => { activeScope.current = null; };
  }, [scope]);

  useEffect(() => {
    let active = true;
    const current = () => active && activeScope.current === scope;
    const { serverUrl, connected, userId } = scope;
    const currentAuth = callbacks.current.auth;
    setStateScope(scope);
    setPresenceUsers([]);
    setSyncConflicts([]);
    setSyncError(null);

    if (serverUrl && (connected || userId)) {
      configureServerApi(serverUrl, currentAuth.getAccessToken, currentAuth.invalidateAccessToken);
      // Capture offline edits for a signed-in account even while transport is
      // unreachable. Reconnection can then deliver the same durable queue.
      enableSync();
      syncEngine.setErrorHandler(message => { if (current()) setSyncError(message); });
      syncEngine.setWorkspaceIdentity(serverUrl, userId ?? '');
      syncEngine.setConflictHandler((conflicts) => { if (current()) setSyncConflicts(conflicts); });
      syncEngine.setReadyHandler(() => {
        // Hooks already loaded local data on mount — just signal that
        // sync is active.  Actual server data triggers reloads via
        // onRemoteChange as it arrives from the background pull.
        if (current()) callbacks.current.reloadFns.onSyncPullComplete?.();
      });
      syncEngine.setRemoteChangeHandler((_changes, tables) => {
        if (!current()) return;
        // Batch all reloads in a single microtask to coalesce React renders
        // and reduce the jarring state cascade from sync pull
        queueMicrotask(() => {
          if (!current()) return;
          const { reloadFns } = callbacks.current;
          if (tables.has('notes')) reloadFns.notes();
          if (tables.has('tasks')) reloadFns.tasks();
          if (tables.has('timelineEvents')) reloadFns.timeline();
          if (tables.has('timelines')) reloadFns.timelines();
          if (tables.has('whiteboards')) reloadFns.whiteboards();
          if (tables.has('standaloneIOCs')) reloadFns.standaloneIOCs();
          if (tables.has('evidenceItems')) reloadFns.evidenceItems?.();
          if (tables.has('chatThreads')) reloadFns.chats();
          if (tables.has('folders')) reloadFns.folders();
          if (tables.has('tags')) reloadFns.tags();
          reloadFns.onSyncPullComplete?.();
        });
      });
      syncEngine.start();

      currentAuth.getAccessToken().then((token) => {
        if (!current()) return;  // Effect was cleaned up — discard stale token
        if (token) {
          const ws = new WSClient(serverUrl, token);
          ws.onStatusChange((ok) => { if (current()) callbacks.current.auth.setReachable(ok); });
          ws.connect();
          syncEngine.setWSClient(ws);
          ws.on('entity-change', (msg) => {
            if (!current()) return;
            const { table, op, entityId, data } = msg as { table: string; op: 'put' | 'delete'; entityId: string; data?: Record<string, unknown> };
            if (table && op && entityId) {
              syncEngine.applyRemoteChange(table, op, entityId, data).catch(() => {
                if (current()) syncEngine.sync();
              });
            } else {
              syncEngine.sync();
            }
          });
          ws.on('presence', (msg) => {
            if (current()) setPresenceUsers((msg.users as PresenceUser[]) || []);
          });
          ws.on('notification', () => {
            if (current()) window.dispatchEvent(new CustomEvent('ws-notification'));
          });
          ws.on('folder-invite', (msg) => {
            if (!current()) return;
            // New investigation shared with us — refresh the remote list so user can choose to sync
            const inviteFolderId = (msg as { folderId?: string }).folderId;
            if (inviteFolderId) {
              callbacks.current.onFolderInvite?.(inviteFolderId);
            }
          });
          ws.on('access-revoked', (msg) => {
            if (!current()) return;
            const { folderId: revokedId } = msg as { folderId?: string };
            if (revokedId) {
              callbacks.current.reloadFns.folders();
            }
          });
          wsClientRef.current = ws;
        }
      }).catch((err) => {
        if (current()) console.warn('[sync] Failed to get access token for WebSocket:', err);
      });
    } else {
      disableSync();
      syncEngine.stop();
      syncEngine.setWSClient(null);
      configureServerApi(null, async () => null);
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
    }

    return () => {
      active = false;
      syncEngine.stop();
      syncEngine.setWSClient(null);
      disableSync();
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
    };
  }, [scope]);

  const handleResolveConflict = useCallback(async (entityId: string, choice: 'mine' | 'theirs', table?: string) => {
    if (activeScope.current !== scope || stateScope !== scope) return;
    const matches = syncConflicts.filter(c => c.entityId === entityId && (table === undefined || c.table === table));
    if (matches.length > 1) throw new Error('Choose a conflict by both entity type and identity.');
    const conflict = matches[0];
    if (conflict) {
      await syncEngine.resolveConflicts([conflict], choice);
    }
    if (activeScope.current === scope) setSyncConflicts((prev) => prev.filter(c => c !== conflict));
  }, [syncConflicts, scope, stateScope]);

  const handleResolveAllConflicts = useCallback(async (choice: 'mine' | 'theirs') => {
    if (activeScope.current !== scope || stateScope !== scope) return;
    const resolvable = syncConflicts.filter(c => c.status === 'conflict');
    await syncEngine.resolveConflicts(resolvable, choice);
    if (activeScope.current === scope) setSyncConflicts(previous => previous.filter(c => !resolvable.includes(c)));
  }, [syncConflicts, scope, stateScope]);

  return {
    presenceUsers: stateScope === scope ? presenceUsers : [],
    syncConflicts: stateScope === scope ? syncConflicts : [],
    syncError: stateScope === scope ? syncError : null,
    setSyncConflicts,
    handleResolveConflict,
    handleResolveAllConflicts,
  };
}
