import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFile } from '../../lib/export';
import { getLegacyCleanupStatus, prepareLegacyCleanup, removeLegacyDatabase, type LegacyCleanupArchive, type LegacyCleanupStatus } from '../../lib/db-migration';

/** Historical copies are never silently deleted by enabling encryption. */
export function LegacyDataCleanup() {
  const { t } = useTranslation('encryption');
  const [status, setStatus] = useState<LegacyCleanupStatus | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [archive, setArchive] = useState<LegacyCleanupArchive | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    getLegacyCleanupStatus().then(result => { if (active) setStatus(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, []);
  if (!status?.exists && !error && !notice) return null;

  const prepare = async () => {
    setError(''); setBusy(true);
    try {
      if (password !== confirmPassword) throw new Error(t('legacy.passwordMismatch'));
      const receipt = await prepareLegacyCleanup(password);
      downloadFile(JSON.stringify(receipt.blob), receipt.filename, 'application/json');
      setArchive(receipt); setPassword(''); setConfirmPassword(''); setSaved(false); setConfirmed(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!archive) return;
    setError(''); setBusy(true);
    try {
      await removeLegacyDatabase(archive, { backupSaved: saved, deleteConfirmed: confirmed }, () => setNotice(t('legacy.blocked')));
      setStatus({ exists: false, verified: false, records: 0 }); setArchive(null); setNotice(t('legacy.removed'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  return <section className="space-y-3 rounded-lg border border-amber-700/50 p-3" aria-label={t('legacy.title')}>
    <h4 className="text-sm font-semibold text-amber-300">{t('legacy.title')}</h4>
    {status?.exists && <>
      <p className="text-xs text-gray-300">{t('legacy.notice', { count: status.records })}</p>
      {!status.verified && <p role="alert" className="text-xs text-amber-300">{t('legacy.unverified')}</p>}
      {status.verified && !archive && <>
        <label className="block text-xs text-gray-300">{t('legacy.password')}<input type="password" autoComplete="new-password" value={password} disabled={busy}
          onChange={event => setPassword(event.target.value)} className="mt-1 block w-full rounded bg-gray-800 px-2 py-1" /></label>
        <label className="block text-xs text-gray-300">{t('legacy.confirmPassword')}<input type="password" autoComplete="new-password" value={confirmPassword} disabled={busy}
          onChange={event => setConfirmPassword(event.target.value)} className="mt-1 block w-full rounded bg-gray-800 px-2 py-1" /></label>
        <button type="button" disabled={busy || password.length < 12 || password !== confirmPassword} onClick={prepare}
          className="rounded bg-gray-700 px-3 py-2 text-xs text-white disabled:opacity-50">{t('legacy.download')}</button>
      </>}
      {archive && <>
        <label className="flex gap-2 text-xs text-gray-300"><input type="checkbox" checked={saved} disabled={busy} onChange={event => setSaved(event.target.checked)} />{t('legacy.savedConfirmation')}</label>
        <label className="flex gap-2 text-xs text-gray-300"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{t('legacy.deleteConfirmation')}</label>
        <button type="button" disabled={busy || !saved || !confirmed} onClick={remove}
          className="rounded bg-red-700 px-3 py-2 text-xs text-white disabled:opacity-50">{t('legacy.remove')}</button>
      </>}
    </>}
    {busy && <p role="status" className="text-xs text-gray-300">{t('legacy.working')}</p>}
    {notice && <p role="status" className="text-xs text-gray-300">{notice}</p>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </section>;
}
