import { useState, useRef } from 'react';
import { Download, Upload, FileText, AlertCircle } from 'lucide-react';
import { exportJSON, importJSON, exportNotesMarkdown, downloadFile } from '../../lib/export';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { useLogActivity } from '../../hooks/ActivityLogContext';
import type { Note } from '../../types';

interface ExportImportProps {
  notes: Note[];
  onImportComplete: () => void;
}

export function ExportImport({ notes, onImportComplete }: ExportImportProps) {
  const logActivity = useLogActivity();
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const msgTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showMessage = (msg: string) => {
    setMessage(msg);
    clearTimeout(msgTimeoutRef.current);
    msgTimeoutRef.current = setTimeout(() => setMessage(''), 3000);
  };

  const handleExportJSON = async () => {
    const json = await exportJSON();
    downloadFile(json, `threatcaddy-backup-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    showMessage('Backup exported successfully');
    logActivity('data', 'export', 'Exported JSON backup');
  };

  const handleExportMarkdown = () => {
    const activeNotes = notes.filter((n) => !n.trashed && !n.archived);
    const md = exportNotesMarkdown(activeNotes);
    downloadFile(md, `threatcaddy-${new Date().toISOString().split('T')[0]}.md`, 'text/markdown');
    showMessage(`Exported ${activeNotes.length} notes as Markdown`);
    logActivity('data', 'export', `Exported ${activeNotes.length} notes as Markdown`);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    setImporting(true);
    setError('');
    try {
      const text = await pendingFile.text();
      const counts = await importJSON(text);
      showMessage(`Imported ${counts.notes} notes, ${counts.tasks} tasks, ${counts.folders} investigations, ${counts.tags} tags`);
      logActivity('data', 'import', `Imported ${counts.notes} notes, ${counts.tasks} tasks, ${counts.folders} investigations, ${counts.tags} tags`);
      onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
      setPendingFile(null);
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
        <label className={`${btnClass} bg-accent hover:bg-accent-hover text-white cursor-pointer ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload size={16} />
          {importing ? 'Importing...' : 'Import JSON Backup'}
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelect} className="hidden" disabled={importing} />
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

      <ConfirmDialog
        open={pendingFile !== null}
        onClose={() => setPendingFile(null)}
        onConfirm={handleConfirmImport}
        title="Import Backup"
        message="This will replace all your current notes, tasks, folders, and tags with the imported data. This cannot be undone."
        confirmLabel="Import & Replace"
        danger
      />
    </div>
  );
}
