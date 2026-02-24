import { useState, useCallback } from 'react';
import { useSettings } from './useSettings';
import { exportJSON, importJSON, sanitizeNote } from '../lib/export';
import { db } from '../db';
import type { Note, SharedManifestEntry, SharedItemEnvelope, ExportData } from '../types';
import {
  validatePAR,
  buildNoteEnvelope,
  buildIOCReportEnvelope,
  buildFullBackupEnvelope,
  buildObjectKey,
  ociPut,
  ociGet,
  fetchManifest,
  updateManifest,
} from '../lib/oci-sync';

export function useOCISync() {
  const { settings } = useSettings();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const requirePAR = useCallback((mode: 'read' | 'write'): string => {
    const par = mode === 'write' ? settings.ociWritePAR : settings.ociReadPAR;
    if (!par) throw new Error(`No ${mode} PAR URL configured. Go to Settings > OCI Object Storage to set one.`);
    const validation = validatePAR(par);
    if (!validation.valid) throw new Error(validation.error);
    return par;
  }, [settings.ociWritePAR, settings.ociReadPAR]);

  const pushFullBackup = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setProgress('Exporting data...');
    try {
      const writePAR = requirePAR('write');
      const readPAR = settings.ociReadPAR || writePAR;
      const label = settings.ociLabel || 'default';

      const json = await exportJSON();
      const exportData: ExportData = JSON.parse(json);

      setProgress('Building envelope...');
      const envelope = buildFullBackupEnvelope(exportData, label);
      const objectKey = buildObjectKey('full-backup', '', label);
      const data = JSON.stringify(envelope, null, 2);

      setProgress('Uploading backup...');
      const result = await ociPut(writePAR, objectKey, data);
      if (!result.ok) throw new Error(result.error || 'Upload failed');

      setProgress('Updating manifest...');
      const entry: SharedManifestEntry = {
        objectKey,
        type: 'full-backup',
        title: `Full Backup by ${label}`,
        sharedBy: label,
        sharedAt: Date.now(),
        sizeBytes: new TextEncoder().encode(data).length,
      };
      const manifestResult = await updateManifest(writePAR, readPAR, entry);
      if (!manifestResult.ok) throw new Error(manifestResult.error || 'Failed to update manifest');

      setLastSyncAt(Date.now());
      setProgress('Backup uploaded successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
      setProgress('');
    } finally {
      setSyncing(false);
    }
  }, [requirePAR, settings.ociReadPAR, settings.ociLabel]);

  const pullFullBackup = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setProgress('Fetching manifest...');
    try {
      const readPAR = requirePAR('read');

      const manifest = await fetchManifest(readPAR);
      const backups = manifest.items
        .filter((i) => i.type === 'full-backup')
        .sort((a, b) => b.sharedAt - a.sharedAt);

      if (backups.length === 0) throw new Error('No backups found in the bucket');

      const latest = backups[0];
      setProgress(`Downloading backup from ${latest.sharedBy}...`);
      const result = await ociGet(readPAR, latest.objectKey);
      if (!result.ok || !result.data) throw new Error(result.error || 'Download failed');

      setProgress('Importing data...');
      const envelope: SharedItemEnvelope = JSON.parse(result.data);
      if (envelope.version !== 1 || envelope.type !== 'full-backup') {
        throw new Error('Invalid backup envelope');
      }

      const exportData = envelope.payload as ExportData;
      const json = JSON.stringify(exportData);
      await importJSON(json);

      setLastSyncAt(Date.now());
      setProgress('Backup restored successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pull failed');
      setProgress('');
    } finally {
      setSyncing(false);
    }
  }, [requirePAR]);

  const shareNote = useCallback(async (note: Note, clipsFolderId?: string) => {
    setSyncing(true);
    setError(null);
    setProgress('Sharing note...');
    try {
      const writePAR = requirePAR('write');
      const readPAR = settings.ociReadPAR || writePAR;
      const label = settings.ociLabel || 'default';

      const envelope = buildNoteEnvelope(note, label, clipsFolderId);
      const objectKey = buildObjectKey(envelope.type, note.id, label);
      const data = JSON.stringify(envelope, null, 2);

      const result = await ociPut(writePAR, objectKey, data);
      if (!result.ok) throw new Error(result.error || 'Upload failed');

      setProgress('Updating manifest...');
      const entry: SharedManifestEntry = {
        objectKey,
        type: envelope.type,
        title: note.title || 'Untitled',
        sharedBy: label,
        sharedAt: Date.now(),
        sizeBytes: new TextEncoder().encode(data).length,
      };
      const manifestResult = await updateManifest(writePAR, readPAR, entry);
      if (!manifestResult.ok) throw new Error(manifestResult.error || 'Failed to update manifest');

      setProgress('Shared successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed');
      setProgress('');
    } finally {
      setSyncing(false);
    }
  }, [requirePAR, settings.ociReadPAR, settings.ociLabel]);

  const shareIOCReport = useCallback(async (note: Note) => {
    setSyncing(true);
    setError(null);
    setProgress('Sharing IOC report...');
    try {
      const writePAR = requirePAR('write');
      const readPAR = settings.ociReadPAR || writePAR;
      const label = settings.ociLabel || 'default';

      const envelope = buildIOCReportEnvelope(note, label);
      const objectKey = buildObjectKey('ioc-report', note.id, label);
      const data = JSON.stringify(envelope, null, 2);

      const result = await ociPut(writePAR, objectKey, data);
      if (!result.ok) throw new Error(result.error || 'Upload failed');

      setProgress('Updating manifest...');
      const entry: SharedManifestEntry = {
        objectKey,
        type: 'ioc-report',
        title: `IOC Report: ${note.title || 'Untitled'}`,
        sharedBy: label,
        sharedAt: Date.now(),
        sizeBytes: new TextEncoder().encode(data).length,
      };
      const manifestResult = await updateManifest(writePAR, readPAR, entry);
      if (!manifestResult.ok) throw new Error(manifestResult.error || 'Failed to update manifest');

      setProgress('IOC report shared successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed');
      setProgress('');
    } finally {
      setSyncing(false);
    }
  }, [requirePAR, settings.ociReadPAR, settings.ociLabel]);

  const listShared = useCallback(async (): Promise<SharedManifestEntry[]> => {
    const readPAR = requirePAR('read');
    const manifest = await fetchManifest(readPAR);
    return manifest.items.sort((a, b) => b.sharedAt - a.sharedAt);
  }, [requirePAR]);

  const importSharedItem = useCallback(async (entry: SharedManifestEntry) => {
    setSyncing(true);
    setError(null);
    setProgress(`Importing ${entry.title}...`);
    try {
      const readPAR = requirePAR('read');

      const result = await ociGet(readPAR, entry.objectKey);
      if (!result.ok || !result.data) throw new Error(result.error || 'Download failed');

      const envelope: SharedItemEnvelope = JSON.parse(result.data);
      if (envelope.version !== 1) throw new Error('Unsupported envelope version');

      if (envelope.type === 'full-backup') {
        const exportData = envelope.payload as ExportData;
        const json = JSON.stringify(exportData);
        await importJSON(json);
        setProgress('Full backup imported successfully');
      } else {
        // Single note/clip/ioc-report — sanitize through allowlisted field extractor
        const note = sanitizeNote(envelope.payload);
        if (!note || !note.id) throw new Error('Invalid note in envelope');
        await db.notes.put(note);
        setProgress(`Imported: ${note.title || 'Untitled'}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setProgress('');
    } finally {
      setSyncing(false);
    }
  }, [requirePAR]);

  return {
    syncing,
    progress,
    error,
    lastSyncAt,
    pushFullBackup,
    pullFullBackup,
    shareNote,
    shareIOCReport,
    listShared,
    importSharedItem,
  };
}
