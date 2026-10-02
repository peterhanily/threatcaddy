import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Loader2, Trash2, Download, Upload, AlertCircle, CheckCircle, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../hooks/useSettings';
import { useToast } from '../../contexts/ToastContext';
import { db } from '../../db';
import { encryptBackup, decryptBackup, type BackupPayload, type EncryptedBackupBlob } from '../../lib/backup-crypto';
import { buildFullBackupPayload, buildDifferentialPayload, countPayloadEntities } from '../../lib/backup-data';
import { previewRestore, restoreFullReplace, restoreMerge, type RestorePreview, type RestoreResult } from '../../lib/backup-restore';
import { hasPendingEntityDrafts } from '../../lib/entity-drafts';
import {
  createBackup, listBackups, downloadBackup, deleteBackup,
  type BackupMeta,
} from '../../lib/server-api';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import type { Folder } from '../../types';

type CreateStep = 'idle' | 'collecting' | 'encrypting' | 'uploading' | 'done' | 'error';
type RestoreStep = 'idle' | 'downloading' | 'decrypting' | 'preview' | 'restoring' | 'done' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ServerBackup() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { t: tt } = useTranslation('toast');
  const { settings } = useSettings();
  const { addToast } = useToast();
  const isConnected = !!settings.serverUrl;

  // Backup list
  const [backupsList, setBackupsList] = useState<BackupMeta[]>([]);
  const [listLoading, setListLoading] = useState(false);

  // Create state
  const [scope, setScope] = useState<'all' | 'investigation' | 'entity'>('all');
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [backupType, setBackupType] = useState<'full' | 'differential'>('full');
  const [backupName, setBackupName] = useState(() => `backup-${new Date().toISOString().slice(0, 10)}`);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [createStep, setCreateStep] = useState<CreateStep>('idle');
  const [createError, setCreateError] = useState('');

  // Restore state
  const [restoreBackupId, setRestoreBackupId] = useState<string | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreStep, setRestoreStep] = useState<RestoreStep>('idle');
  const [restoreError, setRestoreError] = useState('');
  const [restorePayload, setRestorePayload] = useState<BackupPayload | null>(null);
  const [restoreBase, setRestoreBase] = useState<BackupPayload | undefined>();
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restorePreviewBusy, setRestorePreviewBusy] = useState(false);
  const restoreGeneration = useRef(0);
  const previewGeneration = useRef(0);

  useEffect(() => () => { restoreGeneration.current++; previewGeneration.current++; }, []);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Folders for investigation scope
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    db.folders.toArray().then(setFolders);
  }, []);

  const refreshList = useCallback(async () => {
    if (!isConnected) return;
    setListLoading(true);
    try {
      const result = await listBackups();
      setBackupsList(result.backups);
    } catch {
      // silently fail on list
    } finally {
      setListLoading(false);
    }
  }, [isConnected]);

  useEffect(() => { refreshList(); }, [refreshList]);

  // Check if differential is available (need a prior full backup for this scope)
  const hasFullBackup = backupsList.some(
    (b) => b.type === 'full' && b.scope === scope &&
      (scope !== 'investigation' || b.scopeId === selectedFolderId),
  );

  const latestFullBackup = backupsList.find(
    (b) => b.type === 'full' && b.scope === scope &&
      (scope !== 'investigation' || b.scopeId === selectedFolderId),
  );

  const handleCreate = async () => {
    setCreateError('');
    if (password.length < 12) { setCreateError(t('encryption.passwordMinLength')); return; }
    if (password !== confirmPassword) { setCreateError(t('encryption.passwordMismatch')); return; }
    if (scope === 'investigation' && !selectedFolderId) { setCreateError(t('encryption.selectInvestigationError')); return; }

    try {
      // 1. Collect data
      setCreateStep('collecting');
      let payload: BackupPayload;
      if (backupType === 'differential') {
        if (!latestFullBackup) throw new Error('Create a full backup for this scope before a differential backup.');
        const parentBlob = await downloadBackup(latestFullBackup.id);
        const parent = await decryptBackup(password, JSON.parse(await parentBlob.text()) as EncryptedBackupBlob);
        payload = await buildDifferentialPayload(
          scope, parent, latestFullBackup.id,
          scope === 'investigation' ? selectedFolderId : undefined,
        );
      } else {
        payload = await buildFullBackupPayload(
          scope,
          scope === 'investigation' ? selectedFolderId : undefined,
        );
      }

      // 2. Encrypt
      setCreateStep('encrypting');
      const encrypted = await encryptBackup(password, payload);
      const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/octet-stream' });

      // 3. Upload
      setCreateStep('uploading');
      await createBackup(
        {
          name: backupName,
          type: payload.type,
          scope,
          scopeId: scope === 'investigation' ? selectedFolderId : undefined,
          entityCount: countPayloadEntities(payload),
          parentBackupId: payload.parentBackupId,
        },
        blob,
      );

      setCreateStep('done');
      setPassword('');
      setConfirmPassword('');
      addToast('success', tt('backup.serverCreated'));
      refreshList();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Backup failed');
      setCreateStep('error');
      addToast('error', tt('backup.serverCreateFailed'));
    }
  };

  const prepareRestorePreview = async (payload: BackupPayload, mode: 'replace' | 'merge', parent = restoreBase) => {
    const generation = restoreGeneration.current;
    const previewId = ++previewGeneration.current;
    const isCurrent = () => generation === restoreGeneration.current && previewId === previewGeneration.current;
    setRestoreMode(mode);
    setRestorePreview(null);
    setRestorePreviewBusy(true);
    setRestoreError('');
    try {
      const preview = await previewRestore(payload, mode, parent);
      if (isCurrent()) setRestorePreview(preview);
    } catch (err) {
      if (isCurrent()) setRestoreError(err instanceof Error ? err.message : 'Restore preview failed');
    } finally {
      if (isCurrent()) setRestorePreviewBusy(false);
    }
  };

  const handleDecrypt = async () => {
    if (!restoreBackupId) return;
    const generation = ++restoreGeneration.current;
    setRestoreError('');

    try {
      setRestoreStep('downloading');
      const blob = await downloadBackup(restoreBackupId);
      const text = await blob.text();
      if (generation !== restoreGeneration.current) return;

      setRestoreStep('decrypting');
      const encrypted = JSON.parse(text) as EncryptedBackupBlob;
      const payload = await decryptBackup(restorePassword, encrypted);
      let parent: BackupPayload | undefined;
      if (payload.type === 'differential') {
        if (payload.version !== 2 || !payload.parentBackupId) throw new Error('Legacy differential backups cannot be verified. Restore a full backup instead.');
        const parentBlob = await downloadBackup(payload.parentBackupId);
        parent = await decryptBackup(restorePassword, JSON.parse(await parentBlob.text()) as EncryptedBackupBlob);
      }
      if (generation !== restoreGeneration.current) return;

      setRestorePayload(payload);
      setRestoreBase(parent);
      setRestorePassword('');
      setRestoreStep('preview');
      await prepareRestorePreview(payload, payload.type === 'differential' ? 'merge' : 'replace', parent);
    } catch (err) {
      if (generation !== restoreGeneration.current) return;
      setRestoreError(err instanceof Error ? err.message : 'Decryption failed');
      setRestoreStep('error');
      addToast('error', tt('backup.decryptionFailed'));
    }
  };

  const handleRestore = async (mode: 'replace' | 'merge') => {
    if (!restorePayload || !restorePreview || restorePreviewBusy) return;
    setRestoreError('');
    setRestoreStep('restoring');

    try {
      let result: RestoreResult;
      if (mode === 'replace') {
        result = await restoreFullReplace(restorePayload, restorePreview);
      } else {
        result = await restoreMerge(restorePayload, restorePreview, restoreBase);
      }
      setRestoreResult(result);
      setRestoreStep('done');
      addToast('success', tt('backup.serverRestored'));
      if (!hasPendingEntityDrafts()) window.location.reload();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Restore failed');
      setRestorePreview(null);
      setRestoreStep('preview');
      addToast('error', tt('backup.serverRestoreFailed'));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteBackup(deleteId);
      setDeleteId(null);
      addToast('success', tt('backup.serverDeleted'));
      refreshList();
    } catch {
      addToast('error', tt('backup.serverDeleteFailed'));
    }
  };

  const resetRestore = () => {
    restoreGeneration.current++;
    previewGeneration.current++;
    setRestoreBackupId(null);
    setRestorePassword('');
    setRestoreStep('idle');
    setRestoreError('');
    setRestorePayload(null);
    setRestoreBase(undefined);
    setRestoreResult(null);
    setRestorePreview(null);
    setRestorePreviewBusy(false);
  };

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const btnClass = 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors';

  if (!isConnected) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Shield size={16} />
          Server Encrypted Backups
        </h3>
        <p className="text-xs text-gray-500">{t('encryption.connectPrompt')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <Shield size={16} />
        {t('encryption.title')}
      </h3>
      <p className="text-xs text-gray-500">
        {t('encryption.description')}
      </p>

      {/* ─── Create Backup ─── */}
      <div className="bg-gray-800/30 rounded-lg p-3 space-y-3">
        <h4 className="text-xs font-semibold text-gray-400">{t('encryption.createBackup')}</h4>

        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('encryption.scope')}</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className={inputClass}>
            <option value="all">{t('encryption.scopeAll')}</option>
            <option value="investigation">{t('encryption.scopeInvestigation')}</option>
          </select>
        </div>

        {scope === 'investigation' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('encryption.investigation')}</label>
            <select value={selectedFolderId} onChange={(e) => setSelectedFolderId(e.target.value)} className={inputClass}>
              <option value="">{t('encryption.selectInvestigation')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('encryption.type')}</label>
          <select
            value={backupType}
            onChange={(e) => setBackupType(e.target.value as 'full' | 'differential')}
            className={inputClass}
          >
            <option value="full">{t('encryption.typeFull')}</option>
            <option value="differential" disabled={!hasFullBackup}>
              {!hasFullBackup ? t('encryption.differentialNeedsFullBackup') : t('encryption.typeDifferential')}
            </option>
          </select>
          {backupType === 'differential' && <p className="text-xs text-gray-400 mt-1">
            {t('encryption.differentialPasswordNotice', { defaultValue: 'Use the full backup’s password. Restore that matching full backup first before applying this differential.' })}
          </p>}
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('encryption.name')}</label>
          <input type="text" maxLength={200} value={backupName} onChange={(e) => setBackupName(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('encryption.passwordLabel')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder={t('encryption.passwordPlaceholder')} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('encryption.confirmPassword')}</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} placeholder={t('encryption.confirmPasswordPlaceholder')} />
        </div>

        {createError && (
          <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} /> {createError}</p>
        )}

        {createStep !== 'idle' && createStep !== 'error' && createStep !== 'done' && (
          <p className="text-xs text-accent flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            {createStep === 'collecting' && t('encryption.collecting')}
            {createStep === 'encrypting' && t('encryption.encrypting')}
            {createStep === 'uploading' && t('encryption.uploading')}
          </p>
        )}

        {createStep === 'done' && (
          <p className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={12} /> {t('encryption.backupCreated')}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={createStep === 'collecting' || createStep === 'encrypting' || createStep === 'uploading'}
          className={`${btnClass} bg-accent hover:bg-accent-hover text-white disabled:opacity-50`}
        >
          {(createStep === 'collecting' || createStep === 'encrypting' || createStep === 'uploading')
            ? <Loader2 size={16} className="animate-spin" />
            : <Upload size={16} />}
          {t('encryption.createBackup')}
        </button>
      </div>

      {/* ─── Backup List ─── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-400">{t('encryption.yourBackups')}</h4>
          {listLoading && <Loader2 size={12} className="animate-spin text-gray-500" />}
        </div>

        {backupsList.length === 0 && !listLoading && (
          <p className="text-xs text-gray-600">{t('encryption.noBackups')}</p>
        )}

        {backupsList.map((b) => (
          <div key={b.id} className="bg-gray-800/50 rounded-lg p-3 space-y-1">
            <div className="flex items-center gap-2">
              <Lock size={12} className="text-gray-500" />
              <span className="text-sm text-gray-200 flex-1 truncate">{b.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                b.type === 'full' ? 'bg-blue-900/30 text-blue-400' : 'bg-yellow-900/30 text-yellow-400'
              }`}>
                {b.type}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                {b.scope}
              </span>
              <button
                onClick={() => { resetRestore(); setRestoreBackupId(b.id); }}
                disabled={restoreStep === 'restoring'}
                className="p-1 rounded text-gray-400 hover:text-accent"
                title={t('encryption.restore')}
                aria-label={t('encryption.restore')}
              >
                <Download size={14} />
              </button>
              <button
                onClick={() => setDeleteId(b.id)}
                className="p-1 rounded text-gray-500 hover:text-red-400"
                title={tc('delete')}
                aria-label={t('encryption.deleteBackup')}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="text-[10px] text-gray-500 flex gap-3">
              <span>{formatBytes(b.sizeBytes)}</span>
              <span>{t('encryption.entities', { count: b.entityCount })}</span>
              <span>{new Date(b.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Restore Flow ─── */}
      {restoreBackupId && (
        <div className="bg-gray-800/30 rounded-lg p-3 space-y-3 border border-gray-700">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-gray-400">{t('encryption.restoreBackup')}</h4>
            <button onClick={resetRestore} disabled={restoreStep === 'restoring'} className="text-xs text-gray-500 hover:text-gray-300">{tc('cancel')}</button>
          </div>

          {restoreStep === 'idle' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('encryption.password')}</label>
                <input
                  type="password"
                  value={restorePassword}
                  onChange={(e) => setRestorePassword(e.target.value)}
                  className={inputClass}
                  placeholder={t('encryption.enterPassword')}
                />
              </div>
              <button onClick={handleDecrypt} className={`${btnClass} bg-gray-700 hover:bg-gray-600 text-gray-200`}>
                <Lock size={16} />
                {t('encryption.decrypt')}
              </button>
            </>
          )}

          {(restoreStep === 'downloading' || restoreStep === 'decrypting') && (
            <p className="text-xs text-accent flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              {restoreStep === 'downloading' ? t('encryption.downloading') : t('encryption.decrypting')}
            </p>
          )}

          {restoreStep === 'preview' && restorePayload && (
            <div className="space-y-3">
              <div className="text-xs text-gray-300 space-y-1">
                <p>Type: <span className="text-gray-200">{restorePayload.type}</span></p>
                <p>Scope: <span className="text-gray-200">{restorePayload.scope}</span></p>
                <p>Entities: <span className="text-gray-200">{countPayloadEntities(restorePayload)}</span></p>
                <p>Created: <span className="text-gray-200">{new Date(restorePayload.createdAt).toLocaleString()}</span></p>
              </div>

              {restorePayload.type === 'full' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => prepareRestorePreview(restorePayload, 'replace')}
                    disabled={restorePreviewBusy}
                    aria-pressed={restoreMode === 'replace'}
                    className={`${btnClass} bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50`}
                  >
                    {t('encryption.replaceScope')}
                  </button>
                  <button
                    onClick={() => prepareRestorePreview(restorePayload, 'merge')}
                    disabled={restorePreviewBusy}
                    aria-pressed={restoreMode === 'merge'}
                    className={`${btnClass} bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50`}
                  >
                    {t('encryption.merge')}
                  </button>
                </div>
              )}
              {restorePreviewBusy && <p role="status" className="text-xs text-gray-400">{t('encryption.preparingRestorePreview')}</p>}
              {restorePreview && (
                <div className="space-y-2 text-xs text-gray-300" aria-live="polite">
                  <p>{t('encryption.restorePreviewStats', { added: restorePreview.added, updated: restorePreview.updated, deleted: restorePreview.deleted })}</p>
                  <ul className="list-disc pl-4">
                    {restorePreview.changes.map(change => (
                      <li key={change.table}>{t('encryption.restoreTableChange', {
                        ...change,
                        table: t(`encryption.table.${change.table}`, { defaultValue: change.table.replace(/([A-Z])/g, ' $1').toLowerCase() }),
                      })}</li>
                    ))}
                  </ul>
                  {restorePreview.sharedPreserved > 0 && <p>{t('encryption.sharedPreserved', { count: restorePreview.sharedPreserved })}</p>}
                  <p>{t(restoreMode === 'replace' ? 'encryption.restoreScopeNotice' : 'encryption.mergeScopeNotice')}</p>
                  <button
                    onClick={() => handleRestore(restoreMode)}
                    className={`${btnClass} bg-red-600/80 hover:bg-red-600 text-white`}
                  >
                    {t('encryption.confirmRestore')}
                  </button>
                </div>
              )}
              {!restorePreview && !restorePreviewBusy && (
                <button onClick={() => prepareRestorePreview(restorePayload, restoreMode)} className={`${btnClass} bg-gray-700 text-gray-200`}>
                  {t('encryption.refreshRestorePreview')}
                </button>
              )}
            </div>
          )}

          {restoreStep === 'restoring' && (
            <p className="text-xs text-accent flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> {t('encryption.restoring')}
            </p>
          )}

          {restoreStep === 'done' && restoreResult && (
            <div className="text-xs text-green-400 space-y-1">
              <p className="flex items-center gap-1"><CheckCircle size={12} /> {t('encryption.restoreComplete')}</p>
              <p className="text-gray-400">
                {t('encryption.restoreStats', { added: restoreResult.added, updated: restoreResult.updated, deleted: restoreResult.deleted })}
              </p>
              <p className="text-gray-500">{t('encryption.restoreTables', { tables: restoreResult.tables.join(', ') })}</p>
              <p className="text-gray-300">{t('encryption.restorePendingDraftNotice')}</p>
              <button
                onClick={() => {
                  if (hasPendingEntityDrafts()) setRestoreError(t('encryption.restorePendingDraftNotice'));
                  else window.location.reload();
                }}
                className={`${btnClass} bg-gray-700 text-gray-200`}
              >{t('encryption.reopenWorkspace')}</button>
            </div>
          )}

          {restoreError && (
            <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} /> {restoreError}</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('encryption.deleteConfirmTitle')}
        message={t('encryption.deleteConfirmMessage')}
        confirmLabel={tc('delete')}
      />
    </div>
  );
}
