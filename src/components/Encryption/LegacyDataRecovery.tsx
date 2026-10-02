import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { restoreLegacyRecoveryArchive } from '../../lib/db-migration';
import type { EncryptedBackupBlob } from '../../lib/backup-crypto';
import { hasPendingEntityDrafts } from '../../lib/entity-drafts';

export function LegacyDataRecovery() {
  const { t } = useTranslation('encryption');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState('');
  const restore = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      if (file.size > 512 * 1024 * 1024) throw new Error(t('legacy.archiveTooLarge'));
      const envelope = JSON.parse(await file.text()) as EncryptedBackupBlob;
      setResult(await restoreLegacyRecoveryArchive(password, envelope, confirmed));
      setPassword('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <details className="rounded-lg border border-gray-700 p-3 text-xs text-gray-300">
    <summary className="cursor-pointer font-semibold">{t('legacy.recoverTitle')}</summary>
    <div className="mt-3 space-y-3">
      <p>{t('legacy.recoverNotice')}</p>
      <label className="block">{t('legacy.archiveFile')}<input type="file" accept=".json" disabled={busy || result !== null}
        onChange={event => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full" /></label>
      <label className="block">{t('legacy.password')}<input type="password" autoComplete="current-password" disabled={busy || result !== null}
        value={password} onChange={event => setPassword(event.target.value)} className="mt-1 block w-full rounded bg-gray-800 px-2 py-1" /></label>
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy || result !== null}
        onChange={event => setConfirmed(event.target.checked)} />{t('legacy.recoverConfirmation')}</label>
      <button type="button" onClick={restore} disabled={busy || !file || !password || !confirmed || result !== null}
        className="rounded bg-gray-700 px-3 py-2 text-white disabled:opacity-50">{t('legacy.recover')}</button>
      {result !== null && <div role="status"><p>{t('legacy.recovered', { count: result })}</p>
        <button type="button" className="mt-2 underline" onClick={() => {
          if (hasPendingEntityDrafts()) setError(t('legacy.pendingDrafts')); else window.location.reload();
        }}>{t('legacy.reopen')}</button></div>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </div>
  </details>;
}
