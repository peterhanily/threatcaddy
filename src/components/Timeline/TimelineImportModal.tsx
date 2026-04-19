import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import type { Timeline, TimelineExportData } from '../../types';
import { parseTimelineImport, importTimelineAsNew, mergeTimelineInto } from '../../lib/export';
import { Modal } from '../Common/Modal';
import { useLogActivity } from '../../hooks/ActivityLogContext';

interface TimelineImportModalProps {
  open: boolean;
  onClose: () => void;
  timelines: Timeline[];
  selectedTimelineId?: string;
  onComplete: () => void;
}

export function TimelineImportModal({ open, onClose, timelines, selectedTimelineId, onComplete }: TimelineImportModalProps) {
  const { t } = useTranslation('timeline');
  const logActivity = useLogActivity();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<TimelineExportData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<'new' | 'merge'>('new');
  const [result, setResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setParsed(null);
    setParseError(null);
    setResult(null);
    setImporting(false);
    setMode('new');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setResult(null);
    try {
      const text = await file.text();
      const data = parseTimelineImport(text);
      setParsed(data);
    } catch (err) {
      setParsed(null);
      setParseError(err instanceof Error ? err.message : t('import.parseFailed'));
    }
  };

  const handleImport = async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      if (mode === 'new') {
        const res = await importTimelineAsNew(parsed);
        setResult(t('import.createdTimeline', { count: res.eventCount }));
        logActivity('timeline', 'import', `Imported timeline "${parsed.timeline.name}" with ${res.eventCount} events`);
      } else {
        if (!selectedTimelineId) return;
        const res = await mergeTimelineInto(parsed, selectedTimelineId);
        const parts = [t('import.mergedAdded', { count: res.added }), t('import.mergedUpdated', { count: res.updated })];
        if (res.skipped > 0) parts.push(t('import.mergedSkipped', { count: res.skipped }));
        setResult(t('import.mergedResult', { details: parts.join(', ') }));
        const selTl = timelines.find((tl) => tl.id === selectedTimelineId);
        logActivity('timeline', 'import', `Merged timeline into "${selTl?.name || 'Unknown'}": ${parts.join(', ')}`, selectedTimelineId, selTl?.name);
      }
      onComplete();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : t('import.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const selectedTimeline = timelines.find((tl) => tl.id === selectedTimelineId);

  return (
    <Modal open={open} onClose={handleClose} title={t('import.title')}>
      <div className="space-y-4">
        {/* File picker */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('import.selectFile')}</label>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="block w-full text-xs text-gray-400 file:me-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600"
          />
        </div>

        {parseError && (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle size={14} />
            {parseError}
          </div>
        )}

        {parsed && !result && (
          <>
            {/* Summary */}
            <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-300 space-y-1">
              <p><span className="text-gray-500">{t('import.summaryName')}</span> {parsed.timeline.name}</p>
              {parsed.timeline.description && (
                <p><span className="text-gray-500">{t('import.summaryDescription')}</span> {parsed.timeline.description}</p>
              )}
              <p><span className="text-gray-500">{t('import.summaryEvents')}</span> {parsed.events.length}</p>
            </div>

            {/* Mode selection */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'new'}
                  onChange={() => setMode('new')}
                  className="accent-blue-500"
                />
                {t('import.createAsNew')}
              </label>
              <label className={`flex items-center gap-2 text-xs cursor-pointer ${selectedTimelineId ? 'text-gray-300' : 'text-gray-600'}`}>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'merge'}
                  onChange={() => setMode('merge')}
                  disabled={!selectedTimelineId}
                  className="accent-blue-500"
                />
                {selectedTimeline ? t('import.mergeInto', { name: selectedTimeline.name }) : t('import.mergeIntoCurrent')}
                {!selectedTimelineId && <span className="text-gray-600">{t('import.selectTimelineFirst')}</span>}
              </label>
            </div>

            {/* Import button */}
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Upload size={14} />
              {importing ? t('import.importing') : t('import.import')}
            </button>
          </>
        )}

        {result && (
          <div className="flex items-center gap-2 text-xs text-green-400">
            <CheckCircle size={14} />
            {result}
          </div>
        )}
      </div>
    </Modal>
  );
}
