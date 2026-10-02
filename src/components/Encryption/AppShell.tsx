import { useState, useEffect } from 'react';
import App from '../../App';
import { PassphraseDialog } from './PassphraseDialog';
import { isEncryptionEnabled, getCachedSessionKey, clearSessionCache, encryptionStorageKey } from '../../lib/encryptionStore';
import { importSessionKey, base64ToArrayBuffer } from '../../lib/crypto';
import { setSessionKey, getSessionKey } from '../../lib/encryptionMiddleware';
import { initializeWorkspace } from '../../lib/workspace-initialization';

function getInitialState() {
  if (!isEncryptionEnabled()) return { unlocked: true, cachedKey: null as string | null };
  return { unlocked: false, cachedKey: getCachedSessionKey() };
}

export function AppShell() {
  const [{ unlocked: initialUnlocked, cachedKey }] = useState(getInitialState);
  const [ready, setReady] = useState(!initialUnlocked && !cachedKey);
  const [isUnlocked, setIsUnlocked] = useState(initialUnlocked);
  const [preparationError, setPreparationError] = useState('');

  // Try to restore session from cached key on mount
  useEffect(() => {
    if (isEncryptionEnabled() && !cachedKey) return;
    let active = true;

    (cachedKey ? importSessionKey(base64ToArrayBuffer(cachedKey)) : Promise.resolve(null))
      .then(async (key) => {
        if (!active) return;
        if (key && cachedKey) setSessionKey(key, cachedKey);
        await initializeWorkspace();
        if (active && (!isEncryptionEnabled() || getSessionKey())) setIsUnlocked(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSessionKey(null);
        clearSessionCache();
        setIsUnlocked(false);
        setPreparationError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [cachedKey]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== encryptionStorageKey) return;
      setSessionKey(null);
      clearSessionCache();
      setIsUnlocked(false);
      if (!isEncryptionEnabled()) setPreparationError('Encryption settings changed in another tab. Reload to prepare this workspace.');
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  if (!ready) {
    // Return a minimal placeholder that matches the app background to prevent a white flash
    return <div className="min-h-screen bg-gray-950 dark:bg-gray-950" />;
  }

  if (!isUnlocked) {
    if (!isEncryptionEnabled()) {
      return <div className="min-h-screen bg-gray-950 p-6 text-gray-100" role="alert">
        <p>{preparationError || 'The workspace could not be prepared.'}</p>
        <button className="mt-4 underline" onClick={() => window.location.reload()}>Reload to retry</button>
      </div>;
    }
    return <PassphraseDialog initialError={preparationError} onUnlocked={() => setIsUnlocked(true)} />;
  }

  return <App />;
}
