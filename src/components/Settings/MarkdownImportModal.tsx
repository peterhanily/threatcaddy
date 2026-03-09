import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Upload } from 'lucide-react';
import { parseMarkdown } from '../../lib/markdown-import';
import type { MarkdownNote } from '../../lib/markdown-import';

interface MarkdownImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (notes: Array<{ title: string; content: string; tags: string[] }>) => Promise<number>;
}

export function MarkdownImportModal({ open, onClose, onImport }: MarkdownImportModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'results'>('upload');
  const [parsedNotes, setParsedNotes] = useState<MarkdownNote[]>([]);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStep('upload');
      setParsedNotes([]);
      setImporting(false);
      setImportedCount(0);
    }
  }, [open]);

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
      const defaultTitle = file.name.replace(/\.md$/i, '');
      const result = parseMarkdown(text, defaultTitle);
      setParsedNotes(result.notes);
      setStep('preview');
    } catch {
      setParsedNotes([]);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const count = await onImport(parsedNotes);
      setImportedCount(count);
      setStep('results');
    } catch {
      // error handled by parent
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {step === 'upload' && 'Import Markdown'}
            {step === 'preview' && 'Preview Import'}
            {step === 'results' && 'Import Complete'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-500">
            <X size={16} />
          </button>
        </div>

        {step === 'upload' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Select a Markdown file to import as notes. Sections separated by horizontal rules (---) will be created as separate notes.
            </p>

            <label className="flex items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed border-gray-700 hover:border-accent/50 text-gray-400 hover:text-accent cursor-pointer transition-colors">
              <Upload size={18} />
              <span className="text-sm">Choose Markdown file</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.txt"
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
            <div className="text-xs text-gray-400">
              {parsedNotes.length} note{parsedNotes.length !== 1 ? 's' : ''} found
            </div>

            {parsedNotes.length > 0 && (
              <div className="max-h-60 overflow-y-auto border border-gray-800 rounded-lg divide-y divide-gray-800/50">
                {parsedNotes.map((note, i) => (
                  <div key={i} className="px-3 py-2">
                    <div className="text-sm text-gray-200 font-medium">{note.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                      {note.content.slice(0, 120)}{note.content.length > 120 ? '...' : ''}
                    </div>
                    {note.tags.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {note.tags.map((tag, j) => (
                          <span key={j} className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 text-[10px] border border-gray-700">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {parsedNotes.length === 0 && (
              <div className="text-xs text-yellow-500 text-center py-4">
                No notes found in the file. The file may be empty.
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
                disabled={importing || parsedNotes.length === 0}
                className="px-3 py-1.5 text-sm rounded-lg bg-accent/15 text-accent hover:bg-accent/25 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? 'Importing...' : `Import ${parsedNotes.length} note${parsedNotes.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {step === 'results' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              {importedCount} note{importedCount !== 1 ? 's' : ''} imported successfully
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
