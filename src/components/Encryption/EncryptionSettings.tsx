import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, ShieldOff, KeyRound, Clock, AlertTriangle } from 'lucide-react';
import { Modal } from '../Common/Modal';
import { EncryptionSetup } from './EncryptionSetup';
import { useToast } from '../../contexts/ToastContext';
import {
  deriveWrappingKey,
  unwrapMasterKey,
  wrapMasterKey,
  generateSalt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  exportKeyRaw,
  isSecureContext,
} from '../../lib/crypto';
import {
  isEncryptionEnabled,
  getEncryptionMeta,
  setEncryptionMeta,
  clearEncryptionMeta,
  getSessionDuration,
  cacheSessionKey,
  clearSessionCache,
  SESSION_DURATION_LABELS,
  type SessionDuration,
} from '../../lib/encryptionStore';
import { decryptAllExistingData, setSessionKey, getSessionKeyRaw } from '../../lib/encryptionMiddleware';
import { db } from '../../db';

export function EncryptionSettings() {
  const { t } = useTranslation('encryption');
  const { t: tt } = useTranslation('toast');
  const { addToast } = useToast();
  const [enabled, setEnabled] = useState(isEncryptionEnabled);
  const [showSetup, setShowSetup] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [showChangePass, setShowChangePass] = useState(false);
  const [disablePass, setDisablePass] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [disableError, setDisableError] = useState('');
  const [disableProgress, setDisableProgress] = useState({ current: 0, total: 0 });

  // Change passphrase state
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState('');

  // Session duration state
  const savedDuration = getSessionDuration();
  const [sessionDuration, setSessionDurationLocal] = useState<SessionDuration>(savedDuration);
  const [durationSaved, setDurationSaved] = useState(false);
  const durationChanged = sessionDuration !== savedDuration;

  const handleSaveSessionDuration = () => {
    const meta = getEncryptionMeta();
    if (meta) {
      setEncryptionMeta({ ...meta, sessionDuration });
    }
    // Update the cache with new duration
    if (sessionDuration === 'every-load') {
      clearSessionCache();
    } else {
      const rawB64 = getSessionKeyRaw();
      if (rawB64) {
        cacheSessionKey(rawB64, sessionDuration);
      }
    }
    setDurationSaved(true);
    setTimeout(() => setDurationSaved(false), 2000);
  };

  const handleDisable = async () => {
    setDisableError('');
    setDisabling(true);
    try {
      const meta = getEncryptionMeta();
      if (!meta) return;
      const salt = base64ToArrayBuffer(meta.salt);
      const wrappedKey = base64ToArrayBuffer(meta.wrappedKey);
      const wrappingKey = await deriveWrappingKey(disablePass, salt);
      await unwrapMasterKey(wrappedKey, wrappingKey); // verifies passphrase

      await decryptAllExistingData(db, setDisableProgress);
      clearEncryptionMeta();
      setEnabled(false);
      setShowDisable(false);
      setDisablePass('');
      addToast('info', tt('encryption.disabled'));
    } catch {
      setDisableError(t('settings.wrongPassphrase'));
      setDisabling(false);
    }
  };

  const handleChangePassphrase = async () => {
    setChangeError('');
    if (newPass.length < 8) {
      setChangeError(t('settings.newPassMinLength'));
      return;
    }
    if (newPass !== confirmPass) {
      setChangeError(t('settings.newPassMismatch'));
      return;
    }
    setChanging(true);
    try {
      const meta = getEncryptionMeta();
      if (!meta) return;
      // Verify current passphrase and get master key (extractable for re-wrap)
      const oldSalt = base64ToArrayBuffer(meta.salt);
      const oldWrappingKey = await deriveWrappingKey(currentPass, oldSalt);
      // Unwrap as extractable so we can re-wrap
      const masterKey = await crypto.subtle.unwrapKey(
        'raw',
        base64ToArrayBuffer(meta.wrappedKey),
        oldWrappingKey,
        'AES-KW',
        { name: 'AES-GCM', length: 256 },
        true, // extractable for re-wrapping
        ['encrypt', 'decrypt'],
      );

      // Wrap with new passphrase
      const newSaltStr = generateSalt();
      const newSalt = base64ToArrayBuffer(newSaltStr);
      const newWrappingKey = await deriveWrappingKey(newPass, newSalt);
      const newWrappedKey = await wrapMasterKey(masterKey, newWrappingKey);

      // Update metadata (keep recovery key unchanged)
      setEncryptionMeta({
        ...meta,
        salt: newSaltStr,
        wrappedKey: arrayBufferToBase64(newWrappedKey),
      });

      // Update session key to non-extractable version
      const sessionKey = await unwrapMasterKey(
        base64ToArrayBuffer(arrayBufferToBase64(newWrappedKey)),
        newWrappingKey,
      );
      const rawBytes = await exportKeyRaw(masterKey);
      const rawB64 = arrayBufferToBase64(rawBytes);
      setSessionKey(sessionKey, rawB64);

      // Re-cache with new key bytes
      cacheSessionKey(rawB64, getSessionDuration());

      setShowChangePass(false);
      setCurrentPass('');
      setNewPass('');
      setConfirmPass('');
      addToast('success', tt('encryption.passphraseChanged'));
    } catch {
      setChangeError(t('settings.wrongCurrentPass'));
    } finally {
      setChanging(false);
    }
  };

  const meta = getEncryptionMeta();

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">{t('settings.encryption')}</h3>

      {!isSecureContext() && (
        <div className="flex items-start gap-2 p-2 rounded bg-yellow-900/30 border border-yellow-700/50 text-yellow-400 text-xs">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{t('settings.httpsRequired')}</span>
        </div>
      )}

      {enabled ? (
        <>
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <Shield size={16} />
            <span>{t('settings.encryptionEnabled')}</span>
          </div>
          {meta && (
            <p className="text-xs text-gray-500">
              {t('settings.enabledDate', { date: new Date(meta.enabledAt).toLocaleDateString() })}
            </p>
          )}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm text-gray-400">
              <Clock size={14} />
              {t('settings.sessionDuration')}
            </label>
            <div className="flex gap-2">
              <select
                value={sessionDuration}
                onChange={(e) => { setSessionDurationLocal(e.target.value as SessionDuration); setDurationSaved(false); }}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
              >
                {(Object.entries(SESSION_DURATION_LABELS) as [SessionDuration, string][]).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <button
                onClick={handleSaveSessionDuration}
                disabled={!durationChanged && !durationSaved}
                className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
              >
                {durationSaved ? t('settings.saved') : t('common:save')}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              {sessionDuration === 'every-load'
                ? t('settings.sessionEveryLoad')
                : sessionDuration === 'tab-close'
                  ? t('settings.sessionTabClose')
                  : t('settings.sessionDuration_desc', { duration: SESSION_DURATION_LABELS[sessionDuration] })}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowChangePass(true)}
              className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
            >
              <KeyRound size={14} />
              {t('settings.changePassphrase')}
            </button>
            <button
              onClick={() => { setShowDisable(true); setDisablePass(''); setDisableError(''); setDisabling(false); }}
              className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              <ShieldOff size={14} />
              {t('settings.disableEncryption')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-400">
            {t('settings.encryptionDesc')}
          </p>
          <button
            onClick={() => setShowSetup(true)}
            className="flex items-center gap-1.5 text-sm bg-accent hover:bg-accent-hover text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            <Shield size={16} />
            {t('settings.enableEncryption')}
          </button>
        </>
      )}

      <EncryptionSetup
        open={showSetup}
        onClose={() => setShowSetup(false)}
        onEnabled={() => { setShowSetup(false); setEnabled(true); }}
      />

      {/* Disable encryption modal */}
      <Modal open={showDisable} onClose={() => !disabling && setShowDisable(false)} title={t('settings.disableTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            {t('settings.disableDesc')}
          </p>
          <input
            type="password"
            value={disablePass}
            onChange={(e) => setDisablePass(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && disablePass && handleDisable()}
            placeholder={t('settings.disablePassPlaceholder')}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
            autoFocus
            disabled={disabling}
          />
          {disabling && disableProgress.total > 0 && (
            <>
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-accent h-full transition-all duration-200"
                  style={{ width: `${Math.round((disableProgress.current / disableProgress.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 text-center">
                {disableProgress.current} / {disableProgress.total} records
              </p>
            </>
          )}
          {disableError && <p className="text-red-400 text-sm">{disableError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setShowDisable(false)}
              disabled={disabling}
              className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              onClick={handleDisable}
              disabled={!disablePass || disabling}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {disabling ? t('settings.decrypting') : t('settings.disableEncryption')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Change passphrase modal */}
      <Modal open={showChangePass} onClose={() => !changing && setShowChangePass(false)} title={t('settings.changeTitle')}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('settings.currentPassphrase')}</label>
            <input
              type="password"
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              placeholder={t('settings.currentPassPlaceholder')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('settings.newPassphrase')}</label>
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder={t('settings.newPassPlaceholder')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('settings.confirmNewPassphrase')}</label>
            <input
              type="password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChangePassphrase()}
              placeholder={t('settings.confirmNewPassPlaceholder')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
            />
          </div>
          {changeError && <p className="text-red-400 text-sm">{changeError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => { setShowChangePass(false); setCurrentPass(''); setNewPass(''); setConfirmPass(''); setChangeError(''); }}
              disabled={changing}
              className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              onClick={handleChangePassphrase}
              disabled={!currentPass || !newPass || !confirmPass || changing}
              className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {changing ? t('settings.changing') : t('settings.changePassphrase')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
