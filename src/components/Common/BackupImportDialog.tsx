import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';

interface BackupImportDialogProps {
  file: File;
  onClose: () => void;
  onImport: (json: string, mode: 'replace' | 'merge', password?: string) => Promise<void | { warnings?: string[] }>;
  allowMerge?: boolean;
}

/** Mount only while a file is selected: passwords never survive closing the dialog. */
export function BackupImportDialog({ file, onClose, onImport, allowMerge = true }: BackupImportDialogProps) {
  // A different File object is a different operation, even if its name and
  // timestamps match. Remount the session to discard its password and errors.
  const [selection, setSelection] = useState({ file, revision: 0 });
  if (selection.file !== file) setSelection({ file, revision: selection.revision + 1 });
  return <BackupImportSession key={selection.revision} file={file} onClose={onClose} onImport={onImport} allowMerge={allowMerge} />;
}

function BackupImportSession({ file, onClose, onImport, allowMerge }: BackupImportDialogProps) {
  const { t } = useTranslation('settings');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const running = useRef(false);
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const inputId = useId();
  const noticeId = useId();

  const close = () => { if (!running.current) onClose(); };
  const restore = async (mode: 'replace' | 'merge') => {
    if (running.current || notices.length > 0) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      // Bound reading before allocating a string; the decoder validates again.
      if (file.size > 50 * 1024 * 1024) throw new Error(t('data.backupTooLarge'));
      const json = await file.text();
      if (!alive.current) return;
      const result = await onImport(json, mode, password || undefined);
      if (!alive.current) return;
      setPassword('');
      if (result?.warnings?.length) setNotices(result.warnings);
      else onClose();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : t('data.backupRestoreFailed'));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <Modal open onClose={close} title={t('data.loadBackupTitle')}>
      <div aria-busy={busy}>
        <p className="mb-4 text-gray-300">{t(notices.length ? 'data.backupRestoredWithNotices' : 'data.backupRestoreNotice')}</p>
        <p className="mb-4 break-all text-sm text-gray-400">{file.name}</p>
        {notices.length > 0 ? <>
          <div role="status" className="space-y-2 text-sm text-amber-200">{notices.map((notice, index) => <p key={index}>{notice}</p>)}</div>
          <div className="mt-6 flex justify-end"><button onClick={close} className="rounded-lg bg-gray-700 px-4 py-2 text-gray-200">{t('common:close')}</button></div>
        </> : <>
        <label htmlFor={inputId} className="block text-sm text-gray-300">{t('data.backupPasswordLabel')}</label>
        <input id={inputId} type="password" autoComplete="off" value={password} disabled={busy}
          aria-describedby={noticeId} onChange={event => setPassword(event.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100" />
        <p id={noticeId} className="mt-2 text-xs text-gray-400">{t('data.backupPasswordNotice')}</p>
        {error && <p role="alert" className="mt-4 break-words text-sm text-red-300">{error}</p>}
        {busy && <p role="status" className="mt-4 text-sm text-gray-300">{t('data.importing')}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button disabled={busy} onClick={close} className="rounded-lg bg-gray-700 px-4 py-2 text-gray-200 disabled:opacity-50">{t('common:cancel')}</button>
          {allowMerge && <button disabled={busy} onClick={() => void restore('merge')}
            className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50">{t('encryption.merge')}</button>}
          <button disabled={busy} onClick={() => void restore('replace')}
            className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-50">{t('data.replaceAll')}</button>
        </div>
        </>}
      </div>
    </Modal>
  );
}
