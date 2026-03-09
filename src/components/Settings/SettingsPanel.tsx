import { useState } from 'react';
import { Github, Download, FlaskConical, Trash2, Bot, X, Shield, RefreshCw, RotateCcw } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import type { Settings, Note, NoteTemplate, PlaybookTemplate, PlaybookStep } from '../../types';
import { TemplateManager } from './TemplateManager';
import { PlaybookManager } from './PlaybookManager';
import { DEFAULT_SYSTEM_PROMPT } from '../../lib/llm-tools';
import { ExportImport } from './ExportImport';
import { ThreatIntelConfig } from './ThreatIntelConfig';
import { CloudBackup } from './CloudBackup';
import { ServerBackup } from './ServerBackup';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { EncryptionSettings } from '../Encryption/EncryptionSettings';
import { ServerConnection } from './ServerConnection';
import { IntegrationPanel } from '../Integrations/IntegrationPanel';

function SystemPromptEditor({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isCustom = !!value?.trim();
  const displayValue = value ?? DEFAULT_SYSTEM_PROMPT;

  return (
    <div className="border border-gray-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-gray-300 font-medium hover:text-gray-100 transition-colors text-left"
        >
          CaddyAI System Prompt {expanded ? '▾' : '▸'}
        </button>
        <div className="flex items-center gap-2">
          {isCustom && (
            <span className="text-[10px] text-accent font-medium">Custom</span>
          )}
          {isCustom && (
            <button
              onClick={() => onChange(undefined)}
              className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
              title="Reset to default"
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <>
          <p className="text-[10px] text-gray-500">
            Customize the system prompt sent to the LLM. The current investigation context (name, status, entity counts) is always appended automatically.
          </p>
          <textarea
            value={displayValue}
            onChange={(e) => {
              const v = e.target.value;
              // If identical to default, clear custom override
              onChange(v.trim() === DEFAULT_SYSTEM_PROMPT.trim() ? undefined : v);
            }}
            rows={16}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent font-mono resize-y min-h-[200px]"
          />
        </>
      )}
    </div>
  );
}

interface SettingsPanelProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  notes: Note[];
  onImportComplete: () => void;
  sampleLoaded?: boolean;
  onLoadSample?: () => void;
  onDeleteSample?: () => void;
  onClose?: () => void;
  initialTab?: SettingsTab;
  templateProps?: {
    templates: NoteTemplate[];
    userTemplates: NoteTemplate[];
    categories: string[];
    onCreateTemplate: (data: Partial<NoteTemplate> & { name: string; content: string }) => Promise<NoteTemplate>;
    onUpdateTemplate: (id: string, updates: Partial<NoteTemplate>) => Promise<void>;
    onDeleteTemplate: (id: string) => Promise<void>;
    onDuplicateBuiltin: (builtinId: string) => Promise<NoteTemplate | null>;
  };
  playbookProps?: {
    playbooks: PlaybookTemplate[];
    userPlaybooks: PlaybookTemplate[];
    onCreatePlaybook: (data: Partial<PlaybookTemplate> & { name: string; steps: PlaybookStep[] }) => Promise<PlaybookTemplate>;
    onUpdatePlaybook: (id: string, updates: Partial<PlaybookTemplate>) => Promise<void>;
    onDeletePlaybook: (id: string) => Promise<void>;
  };
}

type SettingsTab = 'general' | 'ai' | 'data' | 'templates' | 'intel' | 'integrations' | 'shortcuts';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'ai', label: 'AI' },
  { key: 'data', label: 'Data' },
  { key: 'templates', label: 'Templates' },
  { key: 'intel', label: 'Threat Intel' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'shortcuts', label: 'Shortcuts' },
];

export function SettingsPanel({ settings, onUpdateSettings, notes, onImportComplete, sampleLoaded, onLoadSample, onDeleteSample, onClose, initialTab, templateProps, playbookProps }: SettingsPanelProps) {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'general');
  const selectClass = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const labelClass = 'text-sm text-gray-400';

  return (
    <div className="flex-1 overflow-y-auto">
    <div className="w-full max-w-2xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100">Settings</h2>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" aria-label="Close settings">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab.key
                ? 'bg-accent text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          {/* Team Server */}
          <ServerConnection
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />

          {/* Preferences */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">Display Preferences</h3>

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

          {/* Notifications */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">Notifications</h3>
            {([
              { key: 'mention', label: 'Mentions', desc: 'When someone @mentions you' },
              { key: 'reply', label: 'Replies', desc: 'When someone replies to your post' },
              { key: 'reaction', label: 'Reactions', desc: 'When someone reacts to your post' },
              { key: 'invite', label: 'Invites', desc: 'When you\'re added to an investigation' },
              { key: 'bot', label: 'Bot alerts', desc: 'Automated bot notifications' },
            ] as const).map(({ key, label, desc }) => {
              const enabled = settings.notificationPrefs?.[key] !== false;
              return (
                <div key={key} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-300">{label}</span>
                    <p className="text-xs text-gray-500">{desc}</p>
                  </div>
                  <button
                    onClick={() => onUpdateSettings({ notificationPrefs: { ...settings.notificationPrefs, [key]: !enabled } })}
                    className={`relative w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-gray-700'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Sample Data */}
          {(onLoadSample || onDeleteSample) && (
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
          )}

          {/* About */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">About</h3>
            <p className="text-sm text-gray-400">
              ThreatCaddy v1.0 — Threat Investigation Workspace. Notes, IOCs, Timelines & Graphs.
              All data stored locally in your browser using IndexedDB.
            </p>
            <p className="text-xs text-gray-600">Local-first. Your data stays in your browser unless you connect a self-hosted server.</p>
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
              {typeof __STANDALONE__ !== 'undefined' && __STANDALONE__ ? (
                <button
                  onClick={async () => {
                    try {
                      const resp = await fetch('https://threatcaddy.com/threatcaddy-standalone.html');
                      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                      const blob = await resp.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'threatcaddy-standalone.html';
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch {
                      addToast('error', 'Failed to download update. Visit https://threatcaddy.com to get the latest version.');
                    }
                  }}
                  className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  <RefreshCw size={16} />
                  Update
                </button>
              ) : (
                <a
                  href="./threatcaddy-standalone.html"
                  download
                  className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  <Download size={16} />
                  Download Standalone
                </a>
              )}
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
      )}

      {/* AI Tab */}
      {activeTab === 'ai' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Bot size={16} />
              CaddyAI / LLM
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
                  placeholder="Enter your Mistral API key"
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
                      'gpt-5.4': 'openai', 'gpt-5.4-pro': 'openai',
                      'gpt-5.2': 'openai', 'gpt-5-mini': 'openai', 'o3': 'openai', 'o4-mini': 'openai',
                      'gpt-4.1': 'openai', 'gpt-4.1-mini': 'openai', 'gpt-4o': 'openai',
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
                    <option value="gpt-5.4">GPT-5.4</option>
                    <option value="gpt-5.4-pro">GPT-5.4 Pro</option>
                    <option value="gpt-5.2">GPT-5.2</option>
                    <option value="gpt-5-mini">GPT-5 Mini</option>
                    <option value="o3">o3</option>
                    <option value="o4-mini">o4-mini</option>
                    <option value="gpt-4.1">GPT-4.1</option>
                    <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                    <option value="gpt-4o">GPT-4o</option>
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

              <div className="flex items-center justify-between">
                <label className={labelClass}>Max Context Messages</label>
                <input
                  type="number"
                  min={6}
                  max={200}
                  step={2}
                  value={settings.llmMaxContextMessages || 40}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 6) onUpdateSettings({ llmMaxContextMessages: val });
                  }}
                  className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent text-right"
                />
              </div>
              <p className="text-[10px] text-gray-600">
                Conversations longer than this will be truncated (keeping the first 2 and most recent messages) before sending to the LLM.
              </p>

              <SystemPromptEditor
                value={settings.llmSystemPrompt}
                onChange={(v) => onUpdateSettings({ llmSystemPrompt: v })}
              />

              <p className="text-[10px] text-gray-600">
                Keys are saved locally and sent only to your chosen provider. LLM calls are proxied through the browser extension to bypass CORS.
              </p>
              {(settings.llmAnthropicApiKey || settings.llmOpenAIApiKey || settings.llmGeminiApiKey || settings.llmMistralApiKey) && (
                <p className="text-[10px] text-accent-green font-medium">API key saved</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Data Tab */}
      {activeTab === 'data' && (
        <div className="space-y-6">
          <ExportImport notes={notes} onImportComplete={onImportComplete} />
          <EncryptionSettings />
          <CloudBackup />
          <ServerBackup />
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <div className="space-y-6">
          {templateProps && <TemplateManager {...templateProps} />}
          {playbookProps && <PlaybookManager {...playbookProps} />}
        </div>
      )}

      {/* Threat Intel Tab */}
      {activeTab === 'intel' && (
        <div className="space-y-6">
          <ThreatIntelConfig />
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-6">
          <IntegrationPanel />
        </div>
      )}

      {/* Shortcuts Tab */}
      {activeTab === 'shortcuts' && (
        <div className="space-y-6">
          <KeyboardShortcuts />
        </div>
      )}
    </div>
    </div>
  );
}
