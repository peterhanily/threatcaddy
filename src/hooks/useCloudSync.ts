import { useState, useCallback, useMemo } from 'react';
import { exportJSON } from '../lib/export';
import type { Note, ExportData, BackupDestination } from '../types';
import {
  buildNoteEnvelope,
  buildIOCReportEnvelope,
  buildFullBackupEnvelope,
  buildObjectKey,
  multiCloudPut,
  type DestinationPutResult,
} from '../lib/cloud-sync';
import { formatIOCsFlatJSON, slugify } from '../lib/ioc-export';
import type { IOCExportEntry, ThreatIntelExportConfig, IOCExportFilter } from '../lib/ioc-export';

function getLabel(destinations: BackupDestination[]): string {
  return destinations[0]?.label || 'default';
}

function summarizeResults(results: DestinationPutResult[]): { allOk: boolean; errorMsg: string | null } {
  if (results.length === 0) return { allOk: false, errorMsg: 'No destinations configured' };
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return { allOk: true, errorMsg: null };
  if (failed.length === results.length) return { allOk: false, errorMsg: 'All destinations failed' };
  return { allOk: false, errorMsg: `${failed.length} of ${results.length} destinations failed` };
}

export function useCloudSync(backupDestinations?: BackupDestination[]) {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastResults, setLastResults] = useState<DestinationPutResult[]>([]);

  const destinations = useMemo(() => backupDestinations ?? [], [backupDestinations]);
  const enabledDestinations = useMemo(() => destinations.filter((d) => d.enabled), [destinations]);
  const hasDestinations = enabledDestinations.length > 0;

  const pushFullBackup = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setProgress('Exporting data...');
    try {
      const dests = destinations.filter((d) => d.enabled);
      if (dests.length === 0) throw new Error('No backup destinations configured. Go to Settings > Cloud Backup to add one.');
      const label = getLabel(dests);

      const json = await exportJSON();
      let exportData: ExportData;
      try {
        exportData = JSON.parse(json);
      } catch {
        throw new Error('Failed to parse export data — backup may be corrupted');
      }

      setProgress('Building envelope...');
      const envelope = buildFullBackupEnvelope(exportData, label);
      const objectKey = buildObjectKey('full-backup', '', label);
      const data = JSON.stringify(envelope, null, 2);

      const results = await multiCloudPut(dests, objectKey, data, 'application/json', setProgress);
      setLastResults(results);

      const { allOk, errorMsg } = summarizeResults(results);
      if (allOk) {
        setLastSyncAt(Date.now());
        setProgress('Backup uploaded successfully');
      } else {
        const successCount = results.filter((r) => r.ok).length;
        if (successCount > 0) {
          setLastSyncAt(Date.now());
          setProgress(`Uploaded to ${successCount} of ${results.length} destination(s)`);
        }
        setError(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
      setProgress('');
    } finally {
      setSyncing(false);
    }
  }, [destinations]);

  const shareNote = useCallback(async (note: Note, clipsFolderId?: string) => {
    setSyncing(true);
    setError(null);
    setProgress('Sharing note...');
    try {
      const dests = destinations.filter((d) => d.enabled);
      if (dests.length === 0) throw new Error('No backup destinations configured.');
      const label = getLabel(dests);

      const envelope = buildNoteEnvelope(note, label, clipsFolderId);
      const objectKey = buildObjectKey(envelope.type, note.id, label);
      const data = JSON.stringify(envelope, null, 2);

      const results = await multiCloudPut(dests, objectKey, data, 'application/json', setProgress);
      setLastResults(results);

      const { allOk, errorMsg } = summarizeResults(results);
      if (allOk) {
        setProgress('Shared successfully');
      } else {
        setError(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed');
      setProgress('');
    } finally {
      setSyncing(false);
    }
  }, [destinations]);

  const shareIOCReport = useCallback(async (note: Note) => {
    setSyncing(true);
    setError(null);
    setProgress('Sharing IOC report...');
    try {
      const dests = destinations.filter((d) => d.enabled);
      if (dests.length === 0) throw new Error('No backup destinations configured.');
      const label = getLabel(dests);

      const envelope = buildIOCReportEnvelope(note, label);
      const objectKey = buildObjectKey('ioc-report', note.id, label);
      const data = JSON.stringify(envelope, null, 2);

      const results = await multiCloudPut(dests, objectKey, data, 'application/json', setProgress);
      setLastResults(results);

      const { allOk, errorMsg } = summarizeResults(results);
      if (allOk) {
        setProgress('IOC report shared successfully');
      } else {
        setError(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed');
      setProgress('');
    } finally {
      setSyncing(false);
    }
  }, [destinations]);

  const pushIOCs = useCallback(async (
    entries: IOCExportEntry[],
    slug: string,
    typeSlug?: string,
    tiExportConfig?: ThreatIntelExportConfig,
    exportFilter?: IOCExportFilter,
  ): Promise<boolean> => {
    setSyncing(true);
    setError(null);
    setProgress('Pushing IOCs...');
    try {
      const dests = destinations.filter((d) => d.enabled);
      if (dests.length === 0) throw new Error('No backup destinations configured.');

      const data = formatIOCsFlatJSON(entries, tiExportConfig, exportFilter);
      const timestamp = Date.now();
      const safeSlug = slugify(slug) || 'iocs';
      const objectKey = typeSlug
        ? `threatcaddy/iocs/${safeSlug}-${typeSlug}-${timestamp}.json`
        : `threatcaddy/iocs/${safeSlug}-${timestamp}.json`;

      const results = await multiCloudPut(dests, objectKey, data, 'application/json', setProgress);
      setLastResults(results);

      const { allOk, errorMsg } = summarizeResults(results);
      if (allOk) {
        setProgress('IOCs pushed successfully');
        return true;
      } else {
        setError(errorMsg);
        return results.some((r) => r.ok);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
      setProgress('');
      return false;
    } finally {
      setSyncing(false);
    }
  }, [destinations]);

  return {
    syncing,
    progress,
    error,
    lastSyncAt,
    lastResults,
    hasDestinations,
    pushFullBackup,
    shareNote,
    shareIOCReport,
    pushIOCs,
  };
}
