import { useState, useRef } from 'react';
import { Download, Upload, FileText, AlertCircle } from 'lucide-react';
import { exportJSON, importJSON, exportNotesMarkdown, downloadFile } from '../../lib/export';
import type { Note } from '../../types';

interface ExportImportProps {
  notes: Note[];
  onImportComplete: () => void;
}

export function ExportImport({ notes, onImportComplete }: ExportImportProps) {
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportJSON = async () => {
    const json = await exportJSON();
    downloadFile(json, `browsernotes-backup-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    setMessage('Backup exported successfully');
    setTimeout(() => setMessage(''), 3000);
  };

  const handleExportMarkdown = () => {
    const activeNotes = notes.filter((n) => !n.trashed && !n.archived);
    const md = exportNotesMarkdown(activeNotes);
    downloadFile(md, `browsernotes-${new Date().toISOString().split('T')[0]}.md`, 'text/markdown');
    setMessage(`Exported ${activeNotes.length} notes as Markdown`);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError('');
    try {
      const text = await file.text();
      const counts = await importJSON(text);
      setMessage(`Imported ${counts.notes} notes, ${counts.tasks} tasks, ${counts.folders} folders, ${counts.tags} tags`);
      onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const btnClass = 'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors';

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">Export & Import</h3>

      <div className="flex flex-wrap gap-3">
        <button onClick={handleExportJSON} className={`${btnClass} bg-gray-700 hover:bg-gray-600 text-gray-200`}>
          <Download size={16} />
          Export JSON Backup
        </button>
        <button onClick={handleExportMarkdown} className={`${btnClass} bg-gray-700 hover:bg-gray-600 text-gray-200`}>
          <FileText size={16} />
          Export Markdown
        </button>
        <label className={`${btnClass} bg-accent hover:bg-accent-hover text-white cursor-pointer`}>
          <Upload size={16} />
          {importing ? 'Importing...' : 'Import JSON Backup'}
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
        </label>
      </div>

      {message && (
        <p className="text-sm text-green-400">{message}</p>
      )}
      {error && (
        <p className="text-sm text-red-400 flex items-center gap-1">
          <AlertCircle size={14} />
          {error}
        </p>
      )}
    </div>
  );
}
