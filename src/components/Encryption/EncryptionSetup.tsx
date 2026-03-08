import { useState } from 'react';
import { Modal } from '../Common/Modal';
import { Shield, Copy, Check, Loader2 } from 'lucide-react';
import {
  generateMasterKey,
  deriveWrappingKey,
  wrapMasterKey,
  unwrapMasterKey,
  exportKeyRaw,
  generateRecoveryPhrase,
  generateSalt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from '../../lib/crypto';
import { setEncryptionMeta, getSessionDuration, cacheSessionKey, type EncryptionMetadata } from '../../lib/encryptionStore';
import { setSessionKey, encryptAllExistingData } from '../../lib/encryptionMiddleware';
import { db } from '../../db';

interface EncryptionSetupProps {
  open: boolean;
  onClose: () => void;
  onEnabled: () => void;
}

export function EncryptionSetup({ open, onClose, onEnabled }: EncryptionSetupProps) {
  const [step, setStep] = useState(1);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [encrypting, setEncrypting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState('');

  const reset = () => {
    setStep(1);
    setPassphrase('');
    setConfirm('');
    setRecoveryPhrase('');
    setSaved(false);
    setCopied(false);
    setEncrypting(false);
    setProgress({ current: 0, total: 0 });
    setError('');
  };

  const handleClose = () => {
    if (encrypting) return; // prevent closing during encryption
    reset();
    onClose();
  };

  const handleStep1 = () => {
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }
    if (passphrase !== confirm) {
      setError('Passphrases do not match.');
      return;
    }
    setError('');
    setRecoveryPhrase(generateRecoveryPhrase());
    setStep(2);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(recoveryPhrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFinalize = async () => {
    setEncrypting(true);
    setStep(3);
    try {
      // Generate master key
      const masterKey = await generateMasterKey();

      // Wrap with passphrase-derived key
      const saltStr = generateSalt();
      const salt = base64ToArrayBuffer(saltStr);
      const wrappingKey = await deriveWrappingKey(passphrase, salt);
      const wrappedKey = await wrapMasterKey(masterKey, wrappingKey);

      // Wrap with recovery-phrase-derived key
      const recSaltStr = generateSalt();
      const recSalt = base64ToArrayBuffer(recSaltStr);
      const recWrappingKey = await deriveWrappingKey(recoveryPhrase, recSalt);
      const recWrappedKey = await wrapMasterKey(masterKey, recWrappingKey);

      // Store metadata
      const meta: EncryptionMetadata = {
        version: 1,
        salt: saltStr,
        wrappedKey: arrayBufferToBase64(wrappedKey),
        recoverySalt: recSaltStr,
        recoveryWrappedKey: arrayBufferToBase64(recWrappedKey),
        enabledAt: Date.now(),
      };
      setEncryptionMeta(meta);

      // Unwrap as non-extractable for session use
      const sessionMasterKey = await unwrapMasterKey(
        base64ToArrayBuffer(meta.wrappedKey),
        wrappingKey,
      );
      // Cache raw key bytes for session persistence
      const rawBytes = await exportKeyRaw(masterKey);
      const rawB64 = arrayBufferToBase64(rawBytes);
      setSessionKey(sessionMasterKey, rawB64);
      cacheSessionKey(rawB64, getSessionDuration());

      // Encrypt all existing records
      await encryptAllExistingData(db, setProgress);

      onEnabled();
      reset();
    } catch (err) {
      setError('Failed to enable encryption: ' + (err instanceof Error ? err.message : String(err)));
      setEncrypting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Enable Encryption" wide>
      <div className="space-y-4">
        {step === 1 && (
          <>
            <div className="flex items-center gap-2 text-accent mb-2">
              <Shield size={20} />
              <span className="text-sm font-medium">Step 1 of 2: Set Passphrase</span>
            </div>
            <p className="text-sm text-gray-400">
              Choose a strong passphrase to encrypt your data. You'll enter this each time you open ThreatCaddy.
            </p>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Passphrase (min 8 characters)</label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Confirm passphrase</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStep1()}
                placeholder="Confirm passphrase..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              onClick={handleStep1}
              disabled={!passphrase || !confirm}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Continue
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <div className="flex items-center gap-2 text-accent mb-2">
              <Shield size={20} />
              <span className="text-sm font-medium">Step 2 of 2: Save Recovery Key</span>
            </div>
            <p className="text-sm text-gray-400">
              Save this recovery key in a secure location. If you forget your passphrase, this is the only way to unlock your data.
            </p>
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 relative">
              <p className="text-sm text-gray-200 font-mono leading-relaxed break-all select-all">
                {recoveryPhrase}
              </p>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                title="Copy to clipboard"
              >
                {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
              />
              I've saved this recovery key in a secure location
            </label>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { setStep(1); setError(''); }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleFinalize}
                disabled={!saved || encrypting}
                className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {encrypting && <Loader2 size={14} className="animate-spin" />}
                {encrypting ? 'Encrypting...' : 'Enable Encryption'}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex items-center gap-2 text-accent mb-2">
              <Shield size={20} />
              <span className="text-sm font-medium">Encrypting Data...</span>
            </div>
            <p className="text-sm text-gray-400">
              Encrypting your existing data. Do not close this tab.
            </p>
            <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-accent h-full transition-all duration-200"
                style={{
                  width: progress.total > 0
                    ? `${Math.round((progress.current / progress.total) * 100)}%`
                    : '0%',
                }}
              />
            </div>
            <p className="text-xs text-gray-500 text-center">
              {progress.total > 0
                ? `${progress.current} / ${progress.total} records`
                : 'Counting records...'}
            </p>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
