import type { Settings, Note } from '../../types';
import { ExportImport } from './ExportImport';
import { KeyboardShortcuts } from './KeyboardShortcuts';

interface SettingsPanelProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  notes: Note[];
  onImportComplete: () => void;
}

export function SettingsPanel({ settings, onUpdateSettings, notes, onImportComplete }: SettingsPanelProps) {
  const selectClass = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const labelClass = 'text-sm text-gray-400';

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto space-y-8">
      <h2 className="text-xl font-bold text-gray-100">Settings</h2>

      {/* Preferences */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">Preferences</h3>

        <div className="flex items-center justify-between">
          <label className={labelClass}>Theme</label>
          <select
            value={settings.theme}
            onChange={(e) => onUpdateSettings({ theme: e.target.value as 'dark' | 'light' })}
            className={selectClass}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <label className={labelClass}>Default Editor Mode</label>
          <select
            value={settings.editorMode}
            onChange={(e) => onUpdateSettings({ editorMode: e.target.value as Settings['editorMode'] })}
            className={selectClass}
          >
            <option value="edit">Edit Only</option>
            <option value="split">Split View</option>
            <option value="preview">Preview Only</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <label className={labelClass}>Default Task View</label>
          <select
            value={settings.taskViewMode}
            onChange={(e) => onUpdateSettings({ taskViewMode: e.target.value as Settings['taskViewMode'] })}
            className={selectClass}
          >
            <option value="list">List</option>
            <option value="kanban">Kanban</option>
          </select>
        </div>
      </div>

      <hr className="border-gray-800" />

      <ExportImport notes={notes} onImportComplete={onImportComplete} />

      <hr className="border-gray-800" />

      <KeyboardShortcuts />

      <hr className="border-gray-800" />

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-300">About</h3>
        <p className="text-sm text-gray-400">
          BrowserNotes v1.0 — A privacy-first, browser-based note-taking app.
          All data stored locally in your browser using IndexedDB.
        </p>
        <p className="text-xs text-gray-600">No server. No tracking. Your notes are yours.</p>
      </div>
    </div>
  );
}
