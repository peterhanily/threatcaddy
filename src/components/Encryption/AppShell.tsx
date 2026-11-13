import { useState, useEffect } from 'react';
import App from '../../App';
import { PassphraseDialog } from './PassphraseDialog';
import { isEncryptionEnabled, getEncryptionMeta, getCachedSession, encryptionStorageKey } from '../../lib/encryptionStore';
import { importSessionKey, base64ToArrayBuffer } from '../../lib/crypto';
import { setSessionKey, getSessionKey, getSessionGeneration, lockEncryptionSession } from '../../lib/encryptionMiddleware';
import { restoreWorkspaceRecovery, RECOVERY_WARNING } from '../../lib/workspace-lock';
import { initializeWorkspace } from '../../lib/workspace-initialization';

function getInitialState() {
  return { unlocked: !isEncryptionEnabled(), cached: isEncryptionEnabled() ? getCachedSession() : null };
}

export function AppShell() {
  const [{ unlocked: initialUnlocked, cached }] = useState(getInitialState);
  const [ready, setReady] = useState(!initialUnlocked && !cached);
  const [isUnlocked, setIsUnlocked] = useState(initialUnlocked);
  const [preparationError, setPreparationError] = useState('');

  useEffect(() => {
    const locked = (event: Event) => {
      setIsUnlocked(false); setReady(true);
      setPreparationError((event as CustomEvent<{ recoveryFailed?: boolean }>).detail?.recoveryFailed ? RECOVERY_WARNING : '');
    };
    const recoveryWarning = () => setPreparationError(RECOVERY_WARNING);
    const changed = (event: StorageEvent) => {
      if (event.key !== null && event.key !== encryptionStorageKey) return;
      lockEncryptionSession();
      if (!isEncryptionEnabled()) setPreparationError('Encryption settings changed in another tab. Reload to prepare this workspace.');
    };
    // Timers can be suspended by the OS. Recheck the absolute deadline before
    // resuming work, including a page restored from the browser's back cache.
    const resumed = () => { if (isEncryptionEnabled()) getSessionKey(); };
    window.addEventListener('workspace-locked', locked);
    window.addEventListener('workspace-recovery-warning', recoveryWarning);
    window.addEventListener('storage', changed);
    window.addEventListener('focus', resumed);
    window.addEventListener('pageshow', resumed);
    document.addEventListener('visibilitychange', resumed);
    return () => {
      window.removeEventListener('workspace-locked', locked);
      window.removeEventListener('workspace-recovery-warning', recoveryWarning);
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', resumed);
      window.removeEventListener('pageshow', resumed);
      document.removeEventListener('visibilitychange', resumed);
    };
  }, []);

  useEffect(() => {
    if (isEncryptionEnabled() && !cached) return;
    let active = true;
    let generation = getSessionGeneration();
    const current = () => active && getSessionGeneration() === generation;
    (cached ? importSessionKey(base64ToArrayBuffer(cached.key)) : Promise.resolve(null))
      .then(async (key) => {
        if (!current()) return;
        if (key && cached) {
          const currentCache = getCachedSession();
          if (!currentCache || currentCache.key !== cached.key || currentCache.encryptionId !== cached.encryptionId) {
            lockEncryptionSession(); return;
          }
          setSessionKey(key, currentCache.key, currentCache.unlockedAt, currentCache.expiresAt);
          generation = getSessionGeneration();
          if (!getSessionKey()) return;
        }
        const resumingDisable = getEncryptionMeta()?.transition === 'decrypting';
        await initializeWorkspace();
        // Completing an interrupted disable intentionally clears this key.
        if (resumingDisable && !isEncryptionEnabled() && getSessionGeneration() === generation + 1 && !getSessionKey()) generation = getSessionGeneration();
        if (key && current()) await restoreWorkspaceRecovery(key, () => current() && (getSessionKey() === key || (resumingDisable && !isEncryptionEnabled())));
        if (current() && (!isEncryptionEnabled() || getSessionKey())) setIsUnlocked(true);
      })
      .catch((error: unknown) => {
        if (!current()) return;
        lockEncryptionSession();
        setIsUnlocked(false);
        setPreparationError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [cached]);

  if (!ready) return <div className="min-h-screen bg-gray-950 dark:bg-gray-950" />;
  if (!isUnlocked) {
    if (!isEncryptionEnabled()) return <div className="min-h-screen bg-gray-950 p-6 text-gray-100" role="alert">
      <p>{preparationError || 'The workspace could not be prepared.'}</p>
      <button className="mt-4 underline" onClick={() => window.location.reload()}>Reload to retry</button>
    </div>;
    return <PassphraseDialog initialError={preparationError} onUnlocked={() => {
      if (!isEncryptionEnabled() || getSessionKey()) setIsUnlocked(true);
    }} />;
  }
  return <App />;
}
