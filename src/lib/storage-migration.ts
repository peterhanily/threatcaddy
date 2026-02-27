/**
 * Synchronous migration of localStorage/sessionStorage keys
 * from BrowserNotes → ThreatCaddy. Runs before React renders.
 */

const KEY_MAP: Array<{ old: string; new: string; storage: 'local' | 'session' }> = [
  { old: 'browsernotes-encryption', new: 'threatcaddy-encryption', storage: 'local' },
  { old: 'browsernotes-session-cache', new: 'threatcaddy-session-cache', storage: 'session' },
  { old: 'browsernotes-settings', new: 'threatcaddy-settings', storage: 'local' },
  { old: 'browsernotes-saved-searches', new: 'threatcaddy-saved-searches', storage: 'local' },
];

export function migrateStorageKeys(): void {
  for (const entry of KEY_MAP) {
    const store = entry.storage === 'local' ? localStorage : sessionStorage;
    const oldVal = store.getItem(entry.old);
    if (oldVal !== null && store.getItem(entry.new) === null) {
      store.setItem(entry.new, oldVal);
      store.removeItem(entry.old);
    }
  }
}
