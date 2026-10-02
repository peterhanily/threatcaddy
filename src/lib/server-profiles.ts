import { workspaceStorageKey } from './workspace-profiles';
export interface ServerProfile {
  id: string;
  label: string;
  url: string;
  email: string;
  displayName: string;
  lastConnected?: string;
}

const PROFILES_KEY = workspaceStorageKey('threatcaddy-server-profiles');

export function loadServerProfiles(): ServerProfile[] {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
  } catch { return []; }
}

export function saveServerProfiles(profiles: ServerProfile[]) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

/** Save or update a profile after successful connection */
export function upsertServerProfile(url: string, email: string, displayName: string, label?: string) {
  const profiles = loadServerProfiles();
  const existing = profiles.find(p => p.url === url && p.email === email);
  if (existing) {
    existing.displayName = displayName;
    existing.lastConnected = new Date().toISOString();
    if (label) existing.label = label;
  } else {
    profiles.push({
      id: crypto.randomUUID(),
      label: label || new URL(url).hostname,
      url,
      email,
      displayName,
      lastConnected: new Date().toISOString(),
    });
  }
  saveServerProfiles(profiles);
}
