import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Upload } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import type { StandaloneIOC, Folder, Tag } from '../../types';
import { parseMISPEvent } from '../../lib/misp-import';

interface ImportResults {
  created: number;
  skipped: number;
  failed: number;
}

interface MISPImportModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: Partial<StandaloneIOC>) => Promise<StandaloneIOC>;
  existingIOCs: StandaloneIOC[];
  folders: Folder[];
  allTags?: Tag[];
  defaultFolderId?: string;
}

export function MISPImportModal({
  open,
  onClose,
  onCreate,
  existingIOCs,
  folders,
  defaultFolderId,
}: MISPImportModalProps) {
  const { addToast } = useToast();
  const [step, setStep] = useState<'upload' | 'preview' | 'results'>('upload');
  const [folderId, setFolderId] = useState(defaultFolderId || '');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResults | null>(null);
  const [parsedIOCs, setParsedIOCs] = useState<Partial<StandaloneIOC>[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [eventTitle, setEventTitle] = useState('');
  const [eventTags, setEventTags] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (open) {
      setStep('upload');
      setFolderId(defaultFolderId || '');
      setImporting(false);
      setResults(null);
      setParsedIOCs([]);
      setParseErrors([]);
      setEventTitle('');
      setEventTags([]);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, defaultFolderId]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, handleEscape]);

  if (!open) return null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      const text = await file.text();
      const result = parseMISPEvent(text);
      setParsedIOCs(result.iocs);
      setParseErrors(result.errors);
      setEventTitle(result.eventTitle);
      setEventTags(result.tags);
      setStep('preview');
    } catch {
      setParseErrors(['Failed to read file']);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    let created = 0;
    let skipped = 0;
    let failed = 0;

    const existingSet = new Set(existingIOCs.map((ioc) => `${ioc.type}::${ioc.value}`));

    for (const ioc of parsedIOCs) {
      if (!ioc.type || !ioc.value) { failed++; continue; }
      const key = `${ioc.type}::${ioc.value}`;
      if (existingSet.has(key)) { skipped++; continue; }

      try {
        await onCreate({ ...ioc, folderId: folderId || undefined });
        existingSet.add(key);
        created++;
      } catch {
        failed++;
      }
    }

    setResults({ created, skipped, failed });
    setStep('results');
    setImporting(false);
    if (created > 0) {
      addToast('success', `Imported ${created} IOC${created !== 1 ? 's' : ''} from MISP event`);
    } else if (failed > 0) {
      addToast('error', `MISP import failed for ${failed} IOC${failed !== 1 ? 's' : ''}`);
    } else {
      addToast('info', 'No new IOCs imported (all duplicates)');
    }
  };

  const selectCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {step === 'upload' && 'Import MISP Event'}
            {step === 'preview' && 'Preview MISP Import'}
            {step === 'results' && 'Import Results'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-500">
            <X size={16} />
          </button>
        </div>

        {step === 'upload' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Select a MISP event JSON file to import attributes as IOCs.
            </p>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Investigation (optional)</label>
              <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={`${selectCls} w-full`}>
                <option value="">No investigation</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed border-gray-700 hover:border-accent/50 text-gray-400 hover:text-accent cursor-pointer transition-colors">
              <Upload size={18} />
              <span className="text-sm">Choose MISP JSON file</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>

            <div className="flex justify-end pt-1">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-3">
            {eventTitle && (
              <div className="text-xs text-gray-300 font-medium">
                Event: {eventTitle}
              </div>
            )}

            <div className="space-y-1 text-xs text-gray-400">
              <div>{parsedIOCs.length} IOC{parsedIOCs.length !== 1 ? 's' : ''} found</div>
              {eventTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {eventTags.map((tag, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {parseErrors.length > 0 && (
                <div className="text-yellow-500">{parseErrors.length} warning{parseErrors.length !== 1 ? 's' : ''}</div>
              )}
            </div>

            {parseErrors.length > 0 && (
              <div className="max-h-24 overflow-y-auto text-xs text-yellow-500/70 space-y-0.5 bg-gray-800/50 rounded p-2">
                {parseErrors.slice(0, 10).map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
                {parseErrors.length > 10 && <div>...and {parseErrors.length - 10} more</div>}
              </div>
            )}

            {parsedIOCs.length > 0 && (
              <div className="max-h-48 overflow-y-auto border border-gray-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 font-medium py-1.5 px-2">Value</th>
                      <th className="text-left text-gray-500 font-medium py-1.5 px-2 w-20">Type</th>
                      <th className="text-left text-gray-500 font-medium py-1.5 px-2 w-20">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedIOCs.slice(0, 50).map((ioc, i) => (
                      <tr key={i} className="border-b border-gray-800/50">
                        <td className="py-1 px-2 text-gray-200 font-mono truncate max-w-[200px]">{ioc.value}</td>
                        <td className="py-1 px-2 text-gray-400">{ioc.type}</td>
                        <td className="py-1 px-2 text-gray-400">{ioc.confidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedIOCs.length > 50 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    ...and {parsedIOCs.length - 50} more
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between items-center pt-1">
              <button
                onClick={() => setStep('upload')}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={importing || parsedIOCs.length === 0}
                className="px-3 py-1.5 text-sm rounded-lg bg-accent/15 text-accent hover:bg-accent/25 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? 'Importing...' : `Import ${parsedIOCs.length} IOC${parsedIOCs.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {step === 'results' && results && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              {results.created > 0 && (
                <div className="flex items-center gap-2 text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  {results.created} IOC{results.created !== 1 ? 's' : ''} created
                </div>
              )}
              {results.skipped > 0 && (
                <div className="flex items-center gap-2 text-yellow-400">
                  <span className="w-2 h-2 rounded-full bg-yellow-400" />
                  {results.skipped} duplicate{results.skipped !== 1 ? 's' : ''} skipped
                </div>
              )}
              {results.failed > 0 && (
                <div className="flex items-center gap-2 text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  {results.failed} failed
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded-lg bg-accent/15 text-accent hover:bg-accent/25 font-medium"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
