import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { downloadFile } from '../../lib/export';
import { prepareSyncRecovery, reconcileSyncWorkspace, restoreSyncRecovery, type SyncRecoveryReceipt } from '../../lib/sync-recovery';
import { syncEngine } from '../../lib/sync-engine';

export function SyncRecoveryPanel() {
  const { t } = useTranslation('settings');
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [receipt, setReceipt] = useState<SyncRecoveryReceipt | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const work = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('syncRecovery.failed')); }
    finally { setBusy(false); }
  };
  const prepare = () => work(async () => {
    if (password !== repeat) throw new Error(t('syncRecovery.passwordMismatch'));
    syncEngine.stop();
    const result = await prepareSyncRecovery(password);
    downloadFile(JSON.stringify(result.blob), result.filename, 'application/json');
    setReceipt(result); setSaved(false); setConfirmed(false); setPassword(''); setRepeat('');
    setNotice(t('syncRecovery.prepared'));
  });
  const reconcile = () => work(async () => {
    if (!receipt || !auth.serverUrl || !auth.user) throw new Error(t('syncRecovery.signInFirst'));
    await reconcileSyncWorkspace(receipt, auth.serverUrl, auth.user.id, { backupSaved: saved, reconcileConfirmed: confirmed });
    setReceipt(null); syncEngine.start();
    setNotice(t('syncRecovery.reconciled'));
  });
  const restore = (file?: File) => work(async () => {
    if (!file) return;
    if (!confirmed) throw new Error(t('syncRecovery.confirmRestoreFirst'));
    if (file.size > 512 * 1024 * 1024) throw new Error(t('syncRecovery.archiveTooLarge'));
    syncEngine.stop();
    const count = await restoreSyncRecovery(password, JSON.parse(await file.text()), confirmed);
    setPassword(''); setRepeat('');
    setNotice(t('syncRecovery.restored', { count }));
  });
  return <details className="rounded border border-border p-3">
    <summary className="cursor-pointer text-sm font-semibold">{t('syncRecovery.title')}</summary>
    <div className="mt-3 space-y-3 text-xs">
      <p>{t('syncRecovery.intro')}</p>
      <p>{t('syncRecovery.legacyLimits')}</p>
      <p>{t('syncRecovery.beforeYouStart')}</p>
      <p>{t('syncRecovery.restoreGuidance')}</p>
      <label className="block">{t('syncRecovery.password')}<input type="password" autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} className="block w-full rounded bg-bg-secondary p-2" /></label>
      <label className="block">{t('syncRecovery.repeatPassword')}<input type="password" autoComplete="new-password" value={repeat} disabled={busy} onChange={e => setRepeat(e.target.value)} className="block w-full rounded bg-bg-secondary p-2" /></label>
      <button disabled={busy || password.length < 12 || password !== repeat} onClick={prepare} className="border border-border rounded p-2 disabled:opacity-50">{t('syncRecovery.prepare')}</button>
      {receipt && <label className="flex gap-2"><input type="checkbox" checked={saved} disabled={busy} onChange={e => setSaved(e.target.checked)} />{t('syncRecovery.savedConfirm')}</label>}
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{t('syncRecovery.reconcileConfirm')}</label>
      {receipt && <button disabled={busy || !saved || !confirmed || !auth.user} onClick={reconcile} className="block border border-amber-600 rounded p-2 disabled:opacity-50">{t('syncRecovery.reconcile')}</button>}
      <label className="block">{t('syncRecovery.restoreArchive')}<input type="file" accept="application/json,.json" disabled={busy || !confirmed || password.length < 12} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void restore(file); }} className="block mt-1" /></label>
      {busy && <p role="status">{t('syncRecovery.verifying')}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="text-red-400">{error}</p>}
    </div>
  </details>;
}
