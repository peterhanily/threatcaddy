import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react';
import { deriveWrappingKey, unwrapMasterKey, base64ToArrayBuffer, arrayBufferToBase64, exportKeyRaw } from '../../lib/crypto';
import { getEncryptionMeta, getSessionDuration, cacheSessionKey, clearEncryptionMeta, clearSessionCache } from '../../lib/encryptionStore';
import { setSessionKey } from '../../lib/encryptionMiddleware';
import { db } from '../../db';

interface PassphraseDialogProps {
  onUnlocked: () => void;
}

export function PassphraseDialog({ onUnlocked }: PassphraseDialogProps) {
  const { t } = useTranslation('encryption');
  const [passphrase, setPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);

  const handleUnlock = async () => {
    setError('');
    setUnlocking(true);
    try {
      const meta = getEncryptionMeta();
      if (!meta) return;
      const saltB64 = useRecovery ? meta.recoverySalt : meta.salt;
      const wrappedB64 = useRecovery ? meta.recoveryWrappedKey : meta.wrappedKey;
      const salt = base64ToArrayBuffer(saltB64);
      const wrappedKey = base64ToArrayBuffer(wrappedB64);
      const wrappingKey = await deriveWrappingKey(passphrase.trim(), salt);

      // Unwrap as extractable so we can cache the raw bytes
      const extractableKey = await crypto.subtle.unwrapKey(
        'raw', wrappedKey, wrappingKey, 'AES-KW',
        { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
      );
      const rawBytes = await exportKeyRaw(extractableKey);

      const rawB64 = arrayBufferToBase64(rawBytes);

      // Cache for session persistence
      const duration = getSessionDuration();
      cacheSessionKey(rawB64, duration);

      // Import as non-extractable for actual use
      const sessionKey = await unwrapMasterKey(wrappedKey, wrappingKey);
      setSessionKey(sessionKey, rawB64);
      onUnlocked();
    } catch {
      setError(useRecovery ? t('passphrase.invalidRecoveryKey') : t('passphrase.wrongPassphrase'));
    } finally {
      setUnlocking(false);
    }
  };

  const toggleMode = () => {
    setUseRecovery(!useRecovery);
    setPassphrase('');
    setError('');
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await db.delete();
      clearEncryptionMeta();
      clearSessionCache();
      window.location.reload();
    } catch {
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

          <p className="text-sm text-gray-400 mb-3">
            Type <span className="font-mono font-bold text-gray-200">DELETE</span> to confirm.
          </p>

          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={t('passphrase.typeDeletePlaceholder')}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-red-500 mb-3"
            autoFocus
          />

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
          <textarea
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={t('passphrase.recoveryKeyPlaceholder')}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent min-h-[80px] mb-3 resize-none"
            autoFocus
          />
        ) : (
          <div className="relative mb-3">
            <input
              type={showPassword ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && passphrase && handleUnlock()}
              placeholder={t('passphrase.passphrasePlaceholder')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-10 text-sm text-gray-200 focus:outline-none focus:border-accent"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-200"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        )}

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <button
          onClick={handleUnlock}
          disabled={!passphrase.trim() || unlocking}
          className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors mb-3"
        >
          {unlocking ? t('passphrase.unlocking') : t('passphrase.unlock')}
        </button>

        <button
          onClick={toggleMode}
          className="w-full text-sm text-accent hover:text-accent-hover transition-colors mb-2"
        >
          {useRecovery ? t('passphrase.usePassphraseInstead') : t('passphrase.useRecoveryKey')}
        </button>

        <button
          onClick={() => setShowReset(true)}
          className="w-full text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          {t('passphrase.forgotPassphrase')}
        </button>
      </div>
    </div>
  );
}
