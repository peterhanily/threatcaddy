import { Github, Download, FlaskConical, Trash2, Bot, X, Shield } from 'lucide-react';
import type { Settings, Note } from '../../types';
import { ExportImport } from './ExportImport';
import { ThreatIntelConfig } from './ThreatIntelConfig';
import { CloudBackup } from './CloudBackup';
import { ServerBackup } from './ServerBackup';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { EncryptionSettings } from '../Encryption/EncryptionSettings';
import { ServerConnection } from './ServerConnection';

interface SettingsPanelProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  notes: Note[];
  onImportComplete: () => void;
  sampleLoaded?: boolean;
  onLoadSample?: () => void;
  onDeleteSample?: () => void;
  onClose?: () => void;
}

export function SettingsPanel({ settings, onUpdateSettings, notes, onImportComplete, sampleLoaded, onLoadSample, onDeleteSample, onClose }: SettingsPanelProps) {
  const selectClass = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const labelClass = 'text-sm text-gray-400';

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100">Settings</h2>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" aria-label="Close settings">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Team Server */}
      <ServerConnection
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />

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

      {/* AI / LLM */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Bot size={16} />
          AI / LLM
        </h3>

        <div className="space-y-3">
          <div>
            <label className={labelClass}>Anthropic API Key</label>
            <input
              type="password"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              value={settings.llmAnthropicApiKey || ''}
              onChange={(e) => onUpdateSettings({ llmAnthropicApiKey: e.target.value.trim() || undefined })}
              placeholder="sk-ant-..."
              className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className={labelClass}>OpenAI API Key</label>
            <input
              type="password"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              value={settings.llmOpenAIApiKey || ''}
              onChange={(e) => onUpdateSettings({ llmOpenAIApiKey: e.target.value.trim() || undefined })}
              placeholder="sk-..."
              className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className={labelClass}>Google Gemini API Key</label>
            <input
              type="password"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              value={settings.llmGeminiApiKey || ''}
              onChange={(e) => onUpdateSettings({ llmGeminiApiKey: e.target.value.trim() || undefined })}
              placeholder="AIza..."
              className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className={labelClass}>Mistral API Key</label>
            <input
              type="password"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              value={settings.llmMistralApiKey || ''}
              onChange={(e) => onUpdateSettings({ llmMistralApiKey: e.target.value.trim() || undefined })}
              placeholder="..."
              className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
          </div>

          <div className="border border-gray-700 rounded-lg p-3 space-y-3">
            <label className="text-sm text-gray-300 font-medium">Local LLM (Ollama / LM Studio / vLLM)</label>
            <div>
              <label className={labelClass}>Endpoint URL</label>
              <input
                type="text"
                value={settings.llmLocalEndpoint || ''}
                onChange={(e) => onUpdateSettings({ llmLocalEndpoint: e.target.value.trim() || undefined })}
                placeholder="http://localhost:11434/v1"
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className={labelClass}>API Key (optional)</label>
              <input
                type="password"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={settings.llmLocalApiKey || ''}
                onChange={(e) => onUpdateSettings({ llmLocalApiKey: e.target.value.trim() || undefined })}
                placeholder="Optional — some servers require one"
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className={labelClass}>Model Name</label>
              <input
                type="text"
                value={settings.llmLocalModelName || ''}
                onChange={(e) => onUpdateSettings({ llmLocalModelName: e.target.value.trim() || undefined })}
                placeholder="llama3, mistral-nemo, etc."
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className={labelClass}>Default Model</label>
            <select
              value={settings.llmDefaultModel || 'claude-sonnet-4-6'}
              onChange={(e) => {
                const model = e.target.value;
                const providerMap: Record<string, string> = {
                  'claude-opus-4-6': 'anthropic', 'claude-sonnet-4-6': 'anthropic', 'claude-3-5-haiku-latest': 'anthropic',
                  'gpt-4o': 'openai', 'gpt-4o-mini': 'openai',
                  'gemini-2.5-pro-preview-06-05': 'gemini', 'gemini-2.5-flash-preview-05-20': 'gemini',
                  'mistral-large-latest': 'mistral', 'mistral-small-latest': 'mistral', 'codestral-latest': 'mistral',
                };
                const provider = providerMap[model] || (model === settings.llmLocalModelName ? 'local' : 'anthropic');
                onUpdateSettings({ llmDefaultModel: model, llmDefaultProvider: provider as Settings['llmDefaultProvider'] });
              }}
              className={selectClass}
            >
              <optgroup label="Anthropic">
                <option value="claude-opus-4-6">Claude Opus 4</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4</option>
                <option value="claude-3-5-haiku-latest">Claude Haiku 3.5</option>
              </optgroup>
              <optgroup label="OpenAI">
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
              </optgroup>
              <optgroup label="Google">
                <option value="gemini-2.5-pro-preview-06-05">Gemini 2.5 Pro</option>
                <option value="gemini-2.5-flash-preview-05-20">Gemini 2.5 Flash</option>
              </optgroup>
              <optgroup label="Mistral">
                <option value="mistral-large-latest">Mistral Large</option>
                <option value="mistral-small-latest">Mistral Small</option>
                <option value="codestral-latest">Codestral</option>
              </optgroup>
              {settings.llmLocalModelName && (
                <optgroup label="Local">
                  <option value={settings.llmLocalModelName}>Local: {settings.llmLocalModelName}</option>
                </optgroup>
              )}
            </select>
          </div>

          <p className="text-[10px] text-gray-600">
            Keys are auto-saved to localStorage, never leave your device. LLM calls are proxied through the browser extension to bypass CORS.
          </p>
          {(settings.llmAnthropicApiKey || settings.llmOpenAIApiKey || settings.llmGeminiApiKey || settings.llmMistralApiKey) && (
            <p className="text-[10px] text-accent-green font-medium">API key saved</p>
          )}
        </div>
      </div>

      <hr className="border-gray-800" />

      <ExportImport notes={notes} onImportComplete={onImportComplete} />

      <hr className="border-gray-800" />

      <EncryptionSettings />

      <hr className="border-gray-800" />

      <ThreatIntelConfig />

      <hr className="border-gray-800" />

      <CloudBackup />

      <hr className="border-gray-800" />

      <ServerBackup />

      <hr className="border-gray-800" />

      <KeyboardShortcuts />

      <hr className="border-gray-800" />

      {(onLoadSample || onDeleteSample) && (
        <>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">Sample Data</h3>
            <p className="text-xs text-gray-500">
              Load a pre-built APT investigation (Operation FERMENTED PERSISTENCE) to explore ThreatCaddy's features. Includes notes, tasks, timeline events, IOCs, and a whiteboard.
            </p>
            {sampleLoaded ? (
              <button
                data-tour="load-sample"
                onClick={onDeleteSample}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/15 text-red-400 hover:bg-red-600/25 text-sm font-medium transition-colors"
              >
                <Trash2 size={16} />
                Remove Sample Investigation
              </button>
            ) : (
              <button
                data-tour="load-sample"
                onClick={onLoadSample}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-sm font-medium transition-colors"
              >
                <FlaskConical size={16} />
                Load Sample Investigation
              </button>
            )}
          </div>
          <hr className="border-gray-800" />
        </>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-300">About</h3>
        <p className="text-sm text-gray-400">
          ThreatCaddy v1.0 — Threat Investigation Workspace. Notes, IOCs, Timelines & Graphs.
          All data stored locally in your browser using IndexedDB.
        </p>
        <p className="text-xs text-gray-600">No server. No tracking. Your notes are yours.</p>
        <div className="flex items-center gap-4 pt-2">
          <a
            href="https://github.com/peterhanily/threatcaddy"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
          >
            <Github size={16} />
            GitHub
          </a>
          <a
            href="./threatcaddy-standalone.html"
            download
            className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
          >
            <Download size={16} />
            Download Standalone
          </a>
          <a
            href="https://threatcaddy.com/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
          >
            <Shield size={16} />
            Privacy
          </a>
        </div>
      </div>
    </div>
  );
}
