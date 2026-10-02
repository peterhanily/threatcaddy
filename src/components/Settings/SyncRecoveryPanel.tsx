import { useState } from 'react';
import { db } from '../../db';
import { useAuth } from '../../contexts/AuthContext';
import { downloadFile } from '../../lib/export';
import { prepareSyncRecovery, reconcileSyncWorkspace, restoreSyncRecovery, type SyncRecoveryReceipt } from '../../lib/sync-recovery';
import { syncEngine } from '../../lib/sync-engine';

export function SyncRecoveryPanel() {
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
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Recovery failed; keep the original archive.'); }
    finally { setBusy(false); }
  };
  const prepare = () => work(async () => {
    if (password !== repeat) throw new Error('The archive passwords do not match.');
    syncEngine.stop();
    await db.table('_syncMeta').put({ key: 'syncRecoveryRequiredV2', value: true });
    const result = await prepareSyncRecovery(password);
    downloadFile(JSON.stringify(result.blob), result.filename, 'application/json');
    setReceipt(result); setSaved(false); setConfirmed(false); setPassword(''); setRepeat('');
    setNotice('Archive verified and downloaded. Sync remains paused until you confirm reconciliation.');
  });
  const reconcile = () => work(async () => {
    if (!receipt || !auth.serverUrl || !auth.user) throw new Error('Sign in to the original server/account first.');
    await reconcileSyncWorkspace(receipt, auth.serverUrl, auth.user.id, { backupSaved: saved, reconcileConfirmed: confirmed });
    setReceipt(null); syncEngine.start();
    setNotice('Recovery prepared. Existing server records will require conflict review; local records and queued edits were retained.');
  });
  const restore = (file?: File) => work(async () => {
    if (!file) return;
    if (!confirmed) throw new Error('Confirm restoration into an empty workspace first.');
    if (file.size > 512 * 1024 * 1024) throw new Error('Archive exceeds the supported 512 MiB limit.');
    syncEngine.stop();
    const count = await restoreSyncRecovery(password, JSON.parse(await file.text()), confirmed);
    setPassword(''); setRepeat('');
    setNotice(`Restored ${count} records with sync and agents paused. Reload, then review and reconcile before resuming.`);
  });
  return <details className="rounded border border-border p-3">
    <summary className="cursor-pointer text-sm font-semibold">Sync history recovery</summary>
    <div className="mt-3 space-y-3 text-xs">
      <p>Use this after a server restore or an unverified legacy sync history. Download a password-encrypted archive first. Reconciliation retains local data and queued deletions, resets their baselines, and requires review of existing server records. It never binds this workspace to a different account.</p>
      <p>Close other tabs for this workspace and pause agents before proceeding. Keep the archive password separately; it cannot be recovered.</p>
      <p>To restore without changing existing data, create a new empty local workspace above. Restore before signing in; afterwards, sign in to the archive’s original account and reconcile.</p>
      <label className="block">Archive password<input type="password" autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} className="block w-full rounded bg-bg-secondary p-2" /></label>
      <label className="block">Repeat password<input type="password" autoComplete="new-password" value={repeat} disabled={busy} onChange={e => setRepeat(e.target.value)} className="block w-full rounded bg-bg-secondary p-2" /></label>
      <button disabled={busy || password.length < 12 || password !== repeat} onClick={prepare} className="border border-border rounded p-2 disabled:opacity-50">Pause sync and download verified archive</button>
      {receipt && <label className="flex gap-2"><input type="checkbox" checked={saved} disabled={busy} onChange={e => setSaved(e.target.checked)} />I saved the verified archive and its password.</label>}
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I confirm reconciliation of this workspace, or restoration only into an empty workspace.</label>
      {receipt && <button disabled={busy || !saved || !confirmed || !auth.user} onClick={reconcile} className="block border border-amber-600 rounded p-2 disabled:opacity-50">Reconcile with the signed-in account</button>}
      <label className="block">Restore a workspace recovery archive (empty workspace only)<input type="file" accept="application/json,.json" disabled={busy || !confirmed || password.length < 12} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void restore(file); }} className="block mt-1" /></label>
      {busy && <p role="status">Verifying recovery…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="text-red-400">{error}</p>}
    </div>
  </details>;
}
