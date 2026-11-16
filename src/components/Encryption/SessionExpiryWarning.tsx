import { useId, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { deriveWrappingKey, base64ToArrayBuffer, arrayBufferToBase64, exportKeyRaw } from '../../lib/crypto';
import { getEncryptionMeta } from '../../lib/encryptionStore';
import { getSessionExpiresAt, getSessionGeneration, renewSession, SESSION_WARNING_MS } from '../../lib/encryptionMiddleware';
import { useModalFocusExemptRegion } from '../../hooks/useModalFocusExemption';

function warningDeadline(): number {
  const expiresAt = getSessionExpiresAt();
  return expiresAt && Date.now() >= expiresAt - SESSION_WARNING_MS ? expiresAt : 0;
}

function subscribeToDeadline(onChange: () => void): () => void {
  window.addEventListener('workspace-session-deadline', onChange);
  return () => window.removeEventListener('workspace-session-deadline', onChange);
}

/** Non-modal: if it is ignored, or re-entry has not finished, the absolute
 * deadline still locks the workspace. An open form dialog keeps its trap but
 * includes this warning in its Tab cycle. */
export function SessionExpiryWarning() {
  const { t, i18n } = useTranslation('encryption');
  const titleId = useId();
  // React re-reads the deadline when it subscribes, so a deadline event that
  // fires between this render and the subscription is not lost.
  const deadline = useSyncExternalStore(subscribeToDeadline, warningDeadline);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [renewing, setRenewing] = useState(false);

  // Open dialogs drop aria-modal while this warning is shown.
  useModalFocusExemptRegion(!!deadline);

  if (!deadline) return null;

  const renew = async () => {
    if (renewing || !passphrase) return;
    const generation = getSessionGeneration();
    setRenewing(true);
    setError('');
    try {
      const meta = getEncryptionMeta();
      if (!meta) { setError(t('passphrase.metadataUnavailable')); return; }
      const wrappingKey = await deriveWrappingKey(passphrase, base64ToArrayBuffer(meta.salt));
      const key = await crypto.subtle.unwrapKey(
        'raw', base64ToArrayBuffer(meta.wrappedKey), wrappingKey, 'AES-KW',
        { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
      );
      if (!renewSession(arrayBufferToBase64(await exportKeyRaw(key)), generation)) setError(t('sessionWarning.renewFailed'));
      else setPassphrase('');
    } catch {
      setError(t('passphrase.wrongPassphrase'));
    } finally {
      setRenewing(false);
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      data-modal-focus-exempt=""
      // Escape here must not reach the app's global Escape shortcut (window
      // listener), which closes views such as Settings and loses open editors.
      onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation(); }}
      className="fixed bottom-4 end-4 z-[20000] w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-amber-600/50 bg-gray-900 p-4 text-gray-100 shadow-2xl"
    >
      <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold text-amber-400">
        <Clock size={16} /> {t('sessionWarning.title')}
      </h2>
      <p role="alert" className="mt-2 text-xs text-gray-300">
        {t('sessionWarning.message', { time: new Date(deadline).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
      </p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void renew(); }}>
        <input
          type="password"
          aria-label={t('settings.currentPassphrase')}
          autoComplete="current-password"
          value={passphrase}
          disabled={renewing}
          onChange={(e) => setPassphrase(e.target.value)}
          className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!passphrase || renewing}
          className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
        >
          {renewing ? t('sessionWarning.renewing') : t('sessionWarning.renew')}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
