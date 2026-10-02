/** A tab selects one immutable workspace for its lifetime. Switching requires
 * a reload, so imported DB handles and delayed callbacks cannot change owners. */
const ACTIVE_KEY = 'threatcaddy-active-workspace';
const PROFILE_PREFIX = 'threatcaddy-workspace-profile:';
const validId = (id: string) => id === 'default' || /^[a-f\d]{64}$/.test(id);
const activeId = (() => {
  const value = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(ACTIVE_KEY);
  if (value && !validId(value)) throw new Error('Invalid workspace selection. Restore a valid workspace selection before opening data.');
  return value ?? 'default';
})();

export interface WorkspaceProfile {
  id: string;
  serverUrl?: string;
  userId?: string;
  label: string;
}

export const getActiveWorkspaceId = () => activeId;
export const getWorkspaceDatabaseName = () => activeId === 'default' ? 'ThreatCaddyDB' : `ThreatCaddyDB:${activeId}`;
export const workspaceStorageKey = (base: string, id = activeId) => id === 'default' ? base : `${base}:${id}`;

export function normalizedWorkspaceIdentity(serverUrl: string, userId: string) {
  const endpoint = new URL(serverUrl.trim());
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('Workspace requires an HTTP(S) server URL without credentials, query, or fragment and a nonempty account identity.');
  }
  return { serverUrl: endpoint.origin + endpoint.pathname.replace(/\/+$/, ''), userId };
}

export function listWorkspaceProfiles(): WorkspaceProfile[] {
  const profiles: WorkspaceProfile[] = [{ id: 'default', label: 'Local / original workspace' }];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PROFILE_PREFIX)) continue;
    try {
      const profile = JSON.parse(localStorage.getItem(key) ?? '') as WorkspaceProfile;
      if (!validId(profile.id) || key !== PROFILE_PREFIX + profile.id || typeof profile.label !== 'string') continue;
      if (profile.serverUrl && profile.userId) normalizedWorkspaceIdentity(profile.serverUrl, profile.userId);
      if (profile.id === 'default') profiles[0] = profile;
      else profiles.push(profile);
    } catch { /* A corrupt catalog entry is not authority to open another DB. */ }
  }
  return profiles;
}

/** Deterministic per-account database names avoid lost-update races in a shared
 * catalog. The original dataset is reused only with verified legacy ownership;
 * otherwise first login creates an empty profile, preserving offline content. */
export async function prepareAuthenticatedWorkspace(serverUrl: string, userId: string, label: string,
  originalIdentity?: { serverUrl: string; userId: string }): Promise<WorkspaceProfile> {
  const identity = normalizedWorkspaceIdentity(serverUrl, userId);
  const original = originalIdentity && normalizedWorkspaceIdentity(originalIdentity.serverUrl, originalIdentity.userId);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
  const derivedId = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  // A catalog entry is a label, never authority to select another account's DB.
  const id = original?.serverUrl === identity.serverUrl && original.userId === identity.userId ? activeId : derivedId;
  const profile = { id, ...identity, label: label.trim().slice(0, 200) || userId };
  localStorage.setItem(PROFILE_PREFIX + id, JSON.stringify(profile));
  return profile;
}

export function activateWorkspace(id: string): void {
  if (!validId(id) || !listWorkspaceProfiles().some(profile => profile.id === id)) throw new Error('Unknown workspace. Sign in to create it first.');
  sessionStorage.setItem(ACTIVE_KEY, id);
}

/** A fresh local workspace gives recovery a non-destructive destination. */
export async function createLocalWorkspace(): Promise<WorkspaceProfile> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`local:${crypto.randomUUID()}`));
  const id = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const profile = { id, label: `Local workspace — ${new Date().toLocaleString()}` };
  localStorage.setItem(PROFILE_PREFIX + id, JSON.stringify(profile));
  return profile;
}

/** New empty profiles inherit encryption protection, never settings/API keys or
 * existing entity data. Each profile keeps independent metadata thereafter. */
export function preserveEncryptionForNewWorkspace(id: string): void {
  if (id === activeId) return;
  const sourceKey = workspaceStorageKey('threatcaddy-encryption');
  const targetKey = workspaceStorageKey('threatcaddy-encryption', id);
  const metadata = localStorage.getItem(sourceKey);
  if (metadata && !localStorage.getItem(targetKey)) {
    const parsed = JSON.parse(metadata) as { version?: number; enabledAt?: number; transition?: string; [key: string]: unknown } | null;
    if (!parsed || parsed.version !== 1 || !Number.isFinite(parsed.enabledAt)
      || !['salt', 'wrappedKey', 'recoverySalt', 'recoveryWrappedKey'].every(key => typeof parsed[key] === 'string' && parsed[key])) {
      throw new Error('Repair encryption metadata before creating a workspace.');
    }
    if (parsed.transition) throw new Error('Finish encryption conversion before creating a workspace.');
    localStorage.setItem(targetKey, metadata);
  }
}
