import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react';
import { deriveWrappingKey, unwrapMasterKey, base64ToArrayBuffer, arrayBufferToBase64, exportKeyRaw } from '../../lib/crypto';
import { getEncryptionMeta, getSessionDuration, cacheSessionKey, clearEncryptionMeta, clearSessionCache, isEncryptionEnabled } from '../../lib/encryptionStore';
import { setSessionKey } from '../../lib/encryptionMiddleware';
import { initializeWorkspace } from '../../lib/workspace-initialization';
import { db } from '../../db';

interface PassphraseDialogProps {
  onUnlocked: () => void;
  initialError?: string;
}

export function PassphraseDialog({ onUnlocked, initialError = '' }: PassphraseDialogProps) {
  const { t } = useTranslation('encryption');
  const resetId = useId();
  const resetInFlight = useRef(false);
  const unlockInFlight = useRef(false);
  const [passphrase, setPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState(initialError);
  const [unlocking, setUnlocking] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(false);

  const handleUnlock = async () => {
    if (unlockInFlight.current || resetInFlight.current || !passphrase.trim()) return;
    unlockInFlight.current = true;
    setError('');
    setUnlocking(true);
    let keyVerified = false;
    try {
      const meta = getEncryptionMeta();
      if (!meta) {
        setError(t('passphrase.metadataUnavailable', { defaultValue: 'Encryption metadata could not be read. Restore it from a backup before opening this workspace.' }));
        return;
      }
      const saltB64 = useRecovery ? meta.recoverySalt : meta.salt;
      const wrappedB64 = useRecovery ? meta.recoveryWrappedKey : meta.wrappedKey;
      const salt = base64ToArrayBuffer(saltB64);
      const wrappedKey = base64ToArrayBuffer(wrappedB64);
      const wrappingKey = await deriveWrappingKey(useRecovery ? passphrase.trim() : passphrase, salt);

      // Unwrap as extractable so we can cache the raw bytes
      const extractableKey = await crypto.subtle.unwrapKey(
        'raw', wrappedKey, wrappingKey, 'AES-KW',
        { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
      );
      const rawBytes = await exportKeyRaw(extractableKey);

      const rawB64 = arrayBufferToBase64(rawBytes);

      // Import as non-extractable for actual use
      const sessionKey = await unwrapMasterKey(wrappedKey, wrappingKey);
      keyVerified = true;
      setSessionKey(sessionKey, rawB64);
      await initializeWorkspace();
      if (isEncryptionEnabled()) cacheSessionKey(rawB64, getSessionDuration());
      onUnlocked();
    } catch (err) {
      setSessionKey(null);
      clearSessionCache();
      setError(keyVerified
        ? t('passphrase.prepareFailed', { defaultValue: 'Your key was accepted, but preparing the workspace failed: {{error}}. Unlock again to retry.', error: err instanceof Error ? err.message : String(err) })
        : useRecovery ? t('passphrase.invalidRecoveryKey') : t('passphrase.wrongPassphrase'));
    } finally {
      unlockInFlight.current = false;
      setUnlocking(false);
    }
  };

  const toggleMode = () => {
    if (unlockInFlight.current) return;
    setUseRecovery(!useRecovery);
    setPassphrase('');
    setError('');
  };

  const handleReset = async () => {
    if (resetInFlight.current || unlockInFlight.current || confirmText !== 'DELETE') return;
    resetInFlight.current = true;
    setResetError(false);
    setResetting(true);
    try {
      await db.delete();
      clearEncryptionMeta();
      clearSessionCache();
      window.location.reload();
    } catch {
      resetInFlight.current = false;
      setResetError(true);
      setResetting(false);
    }
  };

  if (showReset) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-full max-w-md p-6">
          <div className="flex items-center gap-3 mb-6">
            <AlertTriangle className="text-red-400" size={24} />
            <h2 className="text-xl font-bold text-gray-100">{t('passphrase.startFresh')}</h2>
          </div>

          <p className="text-sm text-red-400 mb-4 font-medium">
            {t('passphrase.startFreshWarning')}
          </p>

          <label htmlFor={resetId} className="block text-sm text-gray-400 mb-3">{t('passphrase.confirmDelete', { confirmation: 'DELETE' })}</label>

          <input
            id={resetId}
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={t('passphrase.typeDeletePlaceholder')}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-red-500 mb-3"
            autoFocus
          />
          {resetError && <p role="alert" className="mb-3 text-sm text-red-400">{t('passphrase.resetFailed')}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => { setShowReset(false); setConfirmText(''); }}
              disabled={resetting}
              className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              onClick={handleReset}
              disabled={confirmText !== 'DELETE' || resetting}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {resetting ? t('passphrase.deleting') : t('passphrase.deleteAllData')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-6">
          <Lock className="text-accent" size={24} />
          <h2 className="text-xl font-bold text-gray-100">{t('passphrase.unlockThreatCaddy')}</h2>
        </div>

        <p className="text-sm text-gray-400 mb-4">
          {useRecovery
            ? t('passphrase.enterRecoveryKey')
            : t('passphrase.enterPassphrase')}
        </p>

        {useRecovery ? (
          <>
            <textarea
              aria-label={t('passphrase.enterRecoveryKey')}
              disabled={unlocking}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t('passphrase.recoveryKeyPlaceholder')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent min-h-[80px] mb-3 resize-none"
              autoFocus
            />
          </>
        ) : (
          <div className="relative mb-3">
            <input
              aria-label={t('passphrase.enterPassphrase')}
              disabled={unlocking}
              type={showPassword ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && passphrase && handleUnlock()}
              placeholder={t('passphrase.passphrasePlaceholder')}
              className="w-full min-h-11 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pe-12 text-sm text-gray-200 focus:outline-none focus:border-accent"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={t(showPassword ? 'passphrase.hidePassphrase' : 'passphrase.showPassphrase')}
              className="absolute end-0 top-1/2 -translate-y-1/2 min-w-11 min-h-11 flex items-center justify-center text-gray-400 hover:text-gray-200"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        )}

        {error && <p role="alert" className="text-red-400 text-sm mb-3">{error}</p>}

        <button
          onClick={handleUnlock}
          disabled={!passphrase.trim() || unlocking}
          className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors mb-3"
        >
          {unlocking ? t('passphrase.unlocking') : t('passphrase.unlock')}
        </button>

        <button
          onClick={toggleMode}
          disabled={unlocking}
          className="w-full text-sm text-accent hover:text-accent-hover transition-colors mb-2"
        >
          {useRecovery ? t('passphrase.usePassphraseInstead') : t('passphrase.useRecoveryKey')}
        </button>

        <button
          onClick={() => setShowReset(true)}
          disabled={unlocking}
          className="w-full text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          {t('passphrase.forgotPassphrase')}
        </button>
      </div>
    </div>
  );
}
