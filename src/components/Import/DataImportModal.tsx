import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import { Modal } from '../Common/Modal';
import { db } from '../../db';
import type { Folder, Timeline } from '../../types';
import type { ImportResult, ColumnMapping, ParseResult } from '../../lib/data-import';
import {
  detectFormat,
  parseInput,
  detectSchema,
  buildTimelineEvents,
  buildStandaloneIOCs,
  buildSummaryNote,
  MAPPING_COLORS,
  MAPPING_LABELS,
  ALL_MAPPINGS,
} from '../../lib/data-import';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DataImportModalProps {
  open: boolean;
  onClose: () => void;
  folders: Folder[];
  timelines: Timeline[];
  defaultFolderId?: string;
  defaultTimelineId?: string;
  onCreateTimeline: (name: string) => Promise<Timeline>;
  onImportComplete: (result: ImportResult) => void;
}

type Step = 'input' | 'preview' | 'importing' | 'done';

// ---------------------------------------------------------------------------
// Preview table row limit
// ---------------------------------------------------------------------------
const PREVIEW_ROWS = 100;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataImportModal({
  open,
  onClose,
  folders,
  timelines,
  defaultFolderId,
  defaultTimelineId,
  onCreateTimeline,
  onImportComplete,
}: DataImportModalProps) {
  const [step, setStep] = useState<Step>('input');
  const [rawText, setRawText] = useState('');
  const [detectedFormat, setDetectedFormat] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [columnMappings, setColumnMappings] = useState<Map<string, ColumnMapping>>(new Map());
  const [folderId, setFolderId] = useState(defaultFolderId || '');
  const [timelineId, setTimelineId] = useState(defaultTimelineId || '');
  const [createEvents, setCreateEvents] = useState(true);
  const [extractIOCsFlag, setExtractIOCsFlag] = useState(true);
  const [createNote, setCreateNote] = useState(true);
  const [newTimelineName, setNewTimelineName] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setStep('input');
      setRawText('');
      setDetectedFormat('');
      setParseResult(null);
      setColumnMappings(new Map());
      setFolderId(defaultFolderId || '');
      setTimelineId(defaultTimelineId || '');
      setCreateEvents(true);
      setExtractIOCsFlag(true);
      setCreateNote(true);
      setNewTimelineName('');
      setImportResult(null);
      setImportError('');
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, defaultFolderId, defaultTimelineId]);

  // Debounced format detection
  const handleTextChange = useCallback((text: string) => {
    setRawText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (text.trim()) {
        setDetectedFormat(detectFormat(text));
      } else {
        setDetectedFormat('');
      }
    }, 300);
  }, []);

  // File upload handler
  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setRawText(text);
      setDetectedFormat(detectFormat(text));
    };
    reader.readAsText(file);
  }, []);

  // Drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Parse & Preview
  const handleParse = useCallback(() => {
    const result = parseInput(rawText);
    setParseResult(result);

    if (result.error && result.rows.length === 0) {
      setImportError(result.error);
      return;
    }
    setImportError('');

    // Auto-detect schema
    const detections = detectSchema(result.headers);
    const newMappings = new Map<string, ColumnMapping>();
    for (const d of detections) {
      newMappings.set(d.column, d.mapping);
    }
    setColumnMappings(newMappings);
    setStep('preview');
  }, [rawText]);

  // Check if timestamp is mapped
  const hasTimestamp = useMemo(() => {
    for (const mapping of columnMappings.values()) {
      if (mapping === 'timestamp') return true;
    }
    return false;
  }, [columnMappings]);

  // Check if any IOC columns are mapped
  const hasIOCColumns = useMemo(() => {
    for (const mapping of columnMappings.values()) {
      if (mapping.startsWith('ioc-')) return true;
    }
    return false;
  }, [columnMappings]);

  // Update a single column mapping
  const updateMapping = useCallback((column: string, mapping: ColumnMapping) => {
    setColumnMappings((prev) => {
      const next = new Map(prev);
      next.set(column, mapping);
      return next;
    });
  }, []);

  // Import
  const handleImport = useCallback(async () => {
    if (!parseResult) return;
    setStep('importing');

    const result: ImportResult = {
      timelineEventsCreated: 0,
      iocsExtracted: 0,
      summaryNoteCreated: false,
      errors: [],
    };

    try {
      // Build timeline events
      if (createEvents && hasTimestamp) {
        let tid = timelineId;

        // Create a new timeline if requested
        if (tid === '__new__' && newTimelineName.trim()) {
          const created = await onCreateTimeline(newTimelineName.trim());
          tid = created.id;
        }

        // Fall back to first existing timeline, or auto-create one
        if (!tid || tid === '__new__') {
          if (timelines.length > 0) {
            tid = timelines[0].id;
          } else {
            const created = await onCreateTimeline('Data Import');
            tid = created.id;
          }
        }

        {
          const { events, errors } = buildTimelineEvents(
            parseResult.rows,
            columnMappings,
            tid,
            folderId || undefined,
          );
          if (events.length > 0) {
            await db.timelineEvents.bulkPut(events);
            result.timelineEventsCreated = events.length;
          }
          result.errors.push(...errors);
        }
      }

      // Build standalone IOCs
      if (extractIOCsFlag && hasIOCColumns) {
        const { iocs, errors } = buildStandaloneIOCs(
          parseResult.rows,
          columnMappings,
          folderId || undefined,
        );
        if (iocs.length > 0) {
          await db.standaloneIOCs.bulkPut(iocs);
          result.iocsExtracted = iocs.length;
        }
        result.errors.push(...errors);
      }

      // Build summary note
      if (createNote) {
        const note = buildSummaryNote(
          parseResult,
          columnMappings,
          result,
          folderId || undefined,
        );
        await db.notes.put(note);
        result.summaryNoteCreated = true;
      }

      setImportResult(result);
      setStep('done');
    } catch (e) {
      result.errors.push(`Import failed: ${(e as Error).message}`);
      setImportResult(result);
      setStep('done');
    }
  }, [parseResult, createEvents, hasTimestamp, timelineId, timelines, columnMappings, folderId, extractIOCsFlag, hasIOCColumns, createNote, newTimelineName, onCreateTimeline]);

  // Done
  const handleDone = useCallback(() => {
    if (importResult) onImportComplete(importResult);
    onClose();
  }, [importResult, onImportComplete, onClose]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Modal open={open} onClose={onClose} title="Import Data" extraWide>
      {step === 'input' && (
        <div className="space-y-4">
          <div
            className="relative"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <textarea
              value={rawText}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="Paste CSV, TSV, JSON, or NDJSON data here...&#10;&#10;Or drag & drop a file onto this area."
              className="w-full h-64 bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500 placeholder:text-gray-500"
            />
            {!rawText && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-gray-500 mt-16">
                  <Upload size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs">Drop a file here</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
              >
                <FileText size={14} />
                Browse file...
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,.tsv,.txt,.ndjson"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = '';
                }}
              />
              {detectedFormat && (
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-blue-500/20 text-blue-400 uppercase">
                  {detectedFormat}
                </span>
              )}
            </div>

            <button
              onClick={handleParse}
              disabled={!rawText.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              Parse & Preview
              <ArrowRight size={14} />
            </button>
          </div>

          {importError && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              <AlertTriangle size={14} />
              {importError}
            </div>
          )}
        </div>
      )}

      {step === 'preview' && parseResult && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="px-2 py-0.5 font-semibold rounded bg-blue-500/20 text-blue-400 uppercase">
              {parseResult.format}
            </span>
            <span>{parseResult.totalRowCount.toLocaleString()} rows</span>
            <span>{parseResult.headers.length} columns</span>
            {parseResult.truncated && (
              <span className="flex items-center gap-1 text-yellow-400">
                <AlertTriangle size={12} />
                Truncated to 10,000 rows
              </span>
            )}
            {parseResult.error && (
              <span className="flex items-center gap-1 text-yellow-400">
                <AlertTriangle size={12} />
                {parseResult.error}
              </span>
            )}
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto max-h-72 border border-gray-700 rounded-lg">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-800">
                  {parseResult.headers.map((header) => {
                    const mapping = columnMappings.get(header) || 'ignore';
                    const color = MAPPING_COLORS[mapping];
                    return (
                      <th key={header} className="text-left p-1.5 border-b border-gray-700 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span className="text-gray-300 font-medium">{header}</span>
                          <div className="flex items-center gap-1">
                            <span
                              className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                              style={{ backgroundColor: `${color}20`, color }}
                            >
                              {MAPPING_LABELS[mapping]}
                            </span>
                            <select
                              value={mapping}
                              onChange={(e) => updateMapping(header, e.target.value as ColumnMapping)}
                              className="bg-gray-700 border border-gray-600 rounded text-[10px] text-gray-300 px-1 py-0.5 focus:outline-none focus:border-blue-500"
                            >
                              {ALL_MAPPINGS.map((m) => (
                                <option key={m} value={m}>{MAPPING_LABELS[m]}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {parseResult.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                    {parseResult.headers.map((header) => (
                      <td key={header} className="p-1.5 text-gray-400 whitespace-nowrap max-w-[200px] truncate">
                        {row[header] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Import options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Investigation Folder</label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 px-2 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Timeline</label>
              <select
                value={timelineId}
                onChange={(e) => setTimelineId(e.target.value)}
                disabled={!createEvents || !hasTimestamp}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 px-2 py-1.5 focus:outline-none focus:border-blue-500 disabled:opacity-40"
              >
                <option value="">All Events (first available)</option>
                <option value="__new__">+ New Timeline...</option>
                {timelines.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {timelineId === '__new__' && (
                <input
                  type="text"
                  value={newTimelineName}
                  onChange={(e) => setNewTimelineName(e.target.value)}
                  placeholder="Timeline name..."
                  className="w-full mt-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 px-2 py-1.5 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              )}
            </div>

            <div className="sm:col-span-2 flex flex-wrap gap-4">
              <label className={`flex items-center gap-2 text-xs ${!hasTimestamp ? 'opacity-40' : 'text-gray-300'}`}>
                <input
                  type="checkbox"
                  checked={createEvents && hasTimestamp}
                  disabled={!hasTimestamp}
                  onChange={(e) => setCreateEvents(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                />
                Create timeline events
                {!hasTimestamp && <span className="text-yellow-500 text-[10px]">(no timestamp mapped)</span>}
              </label>

              <label className={`flex items-center gap-2 text-xs ${!hasIOCColumns ? 'opacity-40' : 'text-gray-300'}`}>
                <input
                  type="checkbox"
                  checked={extractIOCsFlag && hasIOCColumns}
                  disabled={!hasIOCColumns}
                  onChange={(e) => setExtractIOCsFlag(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                />
                Extract standalone IOCs
                {!hasIOCColumns && <span className="text-yellow-500 text-[10px]">(no IOC columns mapped)</span>}
              </label>

              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={createNote}
                  onChange={(e) => setCreateNote(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                />
                Create summary note
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep('input')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              onClick={handleImport}
              disabled={!createEvents && !extractIOCsFlag && !createNote}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              Import {parseResult.rows.length.toLocaleString()} rows
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <Loader2 size={32} className="text-blue-400 animate-spin" />
          <p className="text-sm text-gray-400">Importing data...</p>
        </div>
      )}

      {step === 'done' && importResult && (
        <div className="space-y-4">
          <div className="flex flex-col items-center py-6 gap-3">
            {importResult.errors.length === 0 ? (
              <CheckCircle2 size={40} className="text-green-400" />
            ) : (
              <AlertTriangle size={40} className="text-yellow-400" />
            )}
            <h3 className="text-lg font-semibold text-gray-200">Import Complete</h3>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-gray-800 rounded-lg">
              <div className="text-2xl font-bold text-blue-400">{importResult.timelineEventsCreated}</div>
              <div className="text-xs text-gray-400 mt-1">Timeline Events</div>
            </div>
            <div className="p-3 bg-gray-800 rounded-lg">
              <div className="text-2xl font-bold text-green-400">{importResult.iocsExtracted}</div>
              <div className="text-xs text-gray-400 mt-1">IOCs Extracted</div>
            </div>
            <div className="p-3 bg-gray-800 rounded-lg">
              <div className="text-2xl font-bold text-purple-400">{importResult.summaryNoteCreated ? 1 : 0}</div>
              <div className="text-xs text-gray-400 mt-1">Summary Note</div>
            </div>
          </div>

          {importResult.errors.length > 0 && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-xs font-medium text-red-400 mb-1">{importResult.errors.length} error(s):</p>
              <ul className="text-xs text-red-300/80 space-y-0.5 max-h-32 overflow-y-auto">
                {importResult.errors.slice(0, 50).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {importResult.errors.length > 50 && (
                  <li className="text-gray-500">... and {importResult.errors.length - 50} more</li>
                )}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleDone}
              className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
