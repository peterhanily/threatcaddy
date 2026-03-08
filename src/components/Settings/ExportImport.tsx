import { useState, useRef } from 'react';
import { Download, Upload, FileText, AlertCircle } from 'lucide-react';
import { exportJSON, importJSON, exportNotesMarkdown, downloadFile } from '../../lib/export';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { MarkdownImportModal } from './MarkdownImportModal';
import { useLogActivity } from '../../hooks/ActivityLogContext';
import { useToast } from '../../contexts/ToastContext';
import { db } from '../../db';
import { nanoid } from 'nanoid';
import type { Note } from '../../types';

interface ExportImportProps {
  notes: Note[];
  onImportComplete: () => void;
}

export function ExportImport({ notes, onImportComplete }: ExportImportProps) {
  const logActivity = useLogActivity();
  const { addToast } = useToast();
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showMdImport, setShowMdImport] = useState(false);
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
    addToast('success', 'Backup exported');
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
      addToast('success', `Imported ${counts.notes} notes, ${counts.tasks} tasks`);
      logActivity('data', 'import', `Imported ${counts.notes} notes, ${counts.tasks} tasks, ${counts.folders} investigations, ${counts.tags} tags`);
      onImportComplete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to import';
      setError(msg);
      addToast('error', 'Import failed');
    } finally {
      setImporting(false);
      setPendingFile(null);
    }
  };

  const handleMarkdownImport = async (importedNotes: Array<{ title: string; content: string; tags: string[] }>): Promise<number> => {
    const now = Date.now();
    const notesToAdd: Note[] = importedNotes.map((n) => ({
      id: nanoid(),
      title: n.title,
      content: n.content,
      tags: n.tags,
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
    }));

    await db.notes.bulkAdd(notesToAdd);
    showMessage(`Imported ${notesToAdd.length} notes from Markdown`);
    addToast('success', `Imported ${notesToAdd.length} notes from Markdown`);
    logActivity('data', 'import', `Imported ${notesToAdd.length} notes from Markdown`);
    onImportComplete();
    return notesToAdd.length;
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
        <button onClick={() => setShowMdImport(true)} className={`${btnClass} bg-gray-700 hover:bg-gray-600 text-gray-200`}>
          <Upload size={16} />
          Import Markdown
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

      <MarkdownImportModal
        open={showMdImport}
        onClose={() => setShowMdImport(false)}
        onImport={handleMarkdownImport}
      />
    </div>
  );
}
