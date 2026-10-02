import type { TeamUser } from '../types';
import { normalizedWorkspaceIdentity, workspaceStorageKey } from './workspace-profiles';

export const authStorageKey = workspaceStorageKey('threatcaddy-auth');
export interface StoredAuth {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  user: TeamUser;
}

export function readStoredAuth(key = authStorageKey): StoredAuth | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as StoredAuth | null;
    if (!value || typeof value.accessToken !== 'string' || !value.accessToken
      || typeof value.refreshToken !== 'string' || !value.refreshToken
      || typeof value.user?.id !== 'string' || typeof value.user.email !== 'string'
      || typeof value.user.displayName !== 'string') return null;
    return { ...value, serverUrl: normalizedWorkspaceIdentity(value.serverUrl, value.user.id).serverUrl };
  } catch { return null; }
}

/** Refresh tokens rotate once. All tabs sharing this workspace must serialize
 * their refresh and reread durable credentials inside this lock. Unsupported
 * contexts fail closed instead of replaying a token and revoking its family. */
export async function withAuthRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return Promise.reject(new Error('Session refresh requires a secure browser context with Web Locks. Sign in again.'));
  return await navigator.locks.request(`${authStorageKey}:refresh`, work);
}
