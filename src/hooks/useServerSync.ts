import { useState, useEffect, useRef, useCallback } from 'react';
import type { PresenceUser } from '../types';
import type { SyncResult } from '../lib/server-api';
import { configureServerApi } from '../lib/server-api';
import { syncEngine } from '../lib/sync-engine';
import { enableSync, disableSync } from '../lib/sync-middleware';
import { WSClient } from '../lib/ws-client';

interface AuthState {
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
  chats: () => void;
  folders: () => void;
  tags: () => void;
}

/**
 * Manages server sync engine, WebSocket connection, presence, and conflict state.
 * Extracted from App.tsx to isolate sync concerns.
 */
export function useServerSync(auth: AuthState, reloadFns: ReloadFns, onFolderInvite?: (folderId: string) => void) {
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncResult[]>([]);
  const wsClientRef = useRef<WSClient | null>(null);

  useEffect(() => {
    let active = true;

    if (auth.serverUrl && auth.connected) {
      configureServerApi(auth.serverUrl, auth.getAccessToken, auth.invalidateAccessToken);
      enableSync();
      syncEngine.setConflictHandler((conflicts) => setSyncConflicts(conflicts));
      syncEngine.setRemoteChangeHandler((_changes, tables) => {
        // Batch all reloads in a single microtask to coalesce React renders
        // and reduce the jarring state cascade from sync pull
        queueMicrotask(() => {
          if (tables.has('notes')) reloadFns.notes();
          if (tables.has('tasks')) reloadFns.tasks();
          if (tables.has('timelineEvents')) reloadFns.timeline();
          if (tables.has('timelines')) reloadFns.timelines();
          if (tables.has('whiteboards')) reloadFns.whiteboards();
          if (tables.has('standaloneIOCs')) reloadFns.standaloneIOCs();
          if (tables.has('chatThreads')) reloadFns.chats();
          if (tables.has('folders')) reloadFns.folders();
          if (tables.has('tags')) reloadFns.tags();
        });
      });
      syncEngine.start();

      auth.getAccessToken().then((token) => {
        if (!active) return;  // Effect was cleaned up — discard stale token
        if (token && auth.serverUrl) {
          const ws = new WSClient(auth.serverUrl, token);
          ws.onStatusChange((ok) => auth.setReachable(ok));
          ws.connect();
          syncEngine.setWSClient(ws);
          ws.on('entity-change', (msg) => {
            const { table, op, entityId, data } = msg as { table: string; op: 'put' | 'delete'; entityId: string; data?: Record<string, unknown> };
            if (table && op && entityId) {
              syncEngine.applyRemoteChange(table, op, entityId, data).catch(() => {
                syncEngine.sync();
              });
            } else {
              syncEngine.sync();
            }
          });
          ws.on('presence', (msg) => {
            setPresenceUsers((msg.users as PresenceUser[]) || []);
          });
          ws.on('notification', () => {
            window.dispatchEvent(new CustomEvent('ws-notification'));
          });
          ws.on('folder-invite', (msg) => {
            // New investigation shared with us — refresh the remote list so user can choose to sync
            const inviteFolderId = (msg as { folderId?: string }).folderId;
            if (inviteFolderId && onFolderInvite) {
              onFolderInvite(inviteFolderId);
            }
          });
          ws.on('access-revoked', (msg) => {
            const { folderId: revokedId } = msg as { folderId?: string };
            if (revokedId) {
              reloadFns.folders();
            }
          });
          wsClientRef.current = ws;
        }
      }).catch((err) => {
        console.warn('[sync] Failed to get access token for WebSocket:', err);
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
      setPresenceUsers([]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on scalar values, not object identity
  }, [auth.serverUrl, auth.connected]);

  const handleResolveConflict = useCallback(async (entityId: string, choice: 'mine' | 'theirs') => {
    const conflict = syncConflicts.find((c) => c.entityId === entityId);
    if (conflict) {
      await syncEngine.resolveConflicts([conflict], choice);
    }
    setSyncConflicts((prev) => prev.filter((c) => c.entityId !== entityId));
  }, [syncConflicts]);

  const handleResolveAllConflicts = useCallback(async (choice: 'mine' | 'theirs') => {
    await syncEngine.resolveConflicts(syncConflicts, choice);
    setSyncConflicts([]);
  }, [syncConflicts]);

  return {
    presenceUsers,
    syncConflicts,
    setSyncConflicts,
    handleResolveConflict,
    handleResolveAllConflicts,
  };
}
