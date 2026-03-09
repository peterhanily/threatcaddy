interface PresenceEntry {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  view: string;
  entityId?: string;
  lastSeen: number;
}

// folderId → Map<userId, PresenceEntry>
const folderPresence = new Map<string, Map<string, PresenceEntry>>();

const STALE_TIMEOUT = 30_000; // 30 seconds

export function updatePresence(
  folderId: string,
  userId: string,
  displayName: string,
  avatarUrl: string | null,
  view: string,
  entityId?: string
) {
  let folder = folderPresence.get(folderId);
  if (!folder) {
    folder = new Map();
    folderPresence.set(folderId, folder);
  }
  folder.set(userId, {
    userId,
    displayName,
    avatarUrl,
    view,
    entityId,
    lastSeen: Date.now(),
  });
}

export function removePresence(folderId: string, userId: string) {
  const folder = folderPresence.get(folderId);
  if (folder) {
    folder.delete(userId);
    if (folder.size === 0) folderPresence.delete(folderId);
  }
}

export function removeUserFromAllFolders(userId: string) {
  for (const [folderId, folder] of folderPresence) {
    folder.delete(userId);
    if (folder.size === 0) folderPresence.delete(folderId);
  }
}

export function getPresence(folderId: string): Array<{
  id: string;
  displayName: string;
  avatarUrl: string | null;
  view: string;
  entityId?: string;
}> {
  const folder = folderPresence.get(folderId);
  if (!folder) return [];

  const now = Date.now();
  const result: Array<{ id: string; displayName: string; avatarUrl: string | null; view: string; entityId?: string }> = [];

  for (const [userId, entry] of folder) {
    if (now - entry.lastSeen > STALE_TIMEOUT) {
      folder.delete(userId);
      continue;
    }
    result.push({
      id: entry.userId,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
      view: entry.view,
      entityId: entry.entityId,
    });
  }

  return result;
}
