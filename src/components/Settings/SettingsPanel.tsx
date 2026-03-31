import { useState } from 'react';
import { Github, Download, FlaskConical, Trash2, Bot, X, Shield, RefreshCw, RotateCcw, Plus, Pencil, Wrench } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import type { Settings, Note, NoteTemplate, PlaybookTemplate, PlaybookStep, CustomSlashCommand } from '../../types';
import { useCustomSlashCommands } from '../../hooks/useCustomSlashCommands';
import { TemplateManager } from './TemplateManager';
import { PlaybookManager } from './PlaybookManager';
import { DEFAULT_SYSTEM_PROMPT } from '../../lib/llm-tools';
import { MODELS, MODEL_PROVIDER_MAP } from '../../lib/models';
import { ExportImport } from './ExportImport';
import { ThreatIntelConfig } from './ThreatIntelConfig';
import { CloudBackup } from './CloudBackup';
import { ServerBackup } from './ServerBackup';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { EncryptionSettings } from '../Encryption/EncryptionSettings';
import { ServerConnection } from './ServerConnection';
import { IntegrationPanel } from '../Integrations/IntegrationPanel';
import { AppearanceSettings } from './AppearanceSettings';

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

type SettingsTab = 'general' | 'appearance' | 'ai' | 'data' | 'templates' | 'intel' | 'integrations' | 'shortcuts';

// ── Custom Slash Commands Editor ────────────────────────────────────

function CustomSlashCommandsEditor() {
  const { commands, createCommand, updateCommand, deleteCommand } = useCustomSlashCommands();
  const { addToast } = useToast();
  const [editing, setEditing] = useState<CustomSlashCommand | null>(null);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formTemplate, setFormTemplate] = useState('');

  const resetForm = () => { setFormName(''); setFormDesc(''); setFormTemplate(''); setEditing(null); setCreating(false); };

  const handleSave = async () => {
    const name = formName.replace(/^\//, '').trim();
    if (!name || !formTemplate.trim()) return;
    if (editing) {
      await updateCommand(editing.id, { name, description: formDesc, template: formTemplate });
      addToast('success', `Updated /${name}`);
    } else {
      await createCommand(name, formDesc, formTemplate);
      addToast('success', `Created /${name}`);
    }
    resetForm();
  };

  const startEdit = (cmd: CustomSlashCommand) => {
    setEditing(cmd);
    setCreating(true);
    setFormName(cmd.name);
    setFormDesc(cmd.description);
    setFormTemplate(cmd.template);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
          <Wrench size={14} /> Custom Slash Commands
        </h3>
        {!creating && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {commands.length === 0 && !creating && (
        <p className="text-xs text-gray-500">No custom commands yet. Create reusable prompt templates accessible via /commands in CaddyAI.</p>
      )}

      {commands.map(cmd => (
        <div key={cmd.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-gray-800/50 border border-gray-700/50">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-mono text-purple font-medium">/{cmd.name}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{cmd.description || 'No description'}</div>
            <div className="text-[10px] text-gray-600 mt-0.5 truncate font-mono">{cmd.template.slice(0, 80)}</div>
          </div>
          <button onClick={() => startEdit(cmd)} className="p-1 text-gray-500 hover:text-gray-300"><Pencil size={12} /></button>
          <button onClick={async () => { await deleteCommand(cmd.id); addToast('success', `Deleted /${cmd.name}`); }} className="p-1 text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
        </div>
      ))}

      {creating && (
        <div className="space-y-2 p-3 rounded-lg bg-gray-800/50 border border-gray-700">
          <input
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="Command name (e.g. mytriage)"
            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent font-mono"
          />
          <input
            value={formDesc}
            onChange={e => setFormDesc(e.target.value)}
            placeholder="Description (shown in slash menu)"
            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
          />
          <textarea
            value={formTemplate}
            onChange={e => setFormTemplate(e.target.value)}
            placeholder="Prompt template. Use {{input}} for user arguments.&#10;&#10;Example: Analyze this alert for IOCs and create a triage report:&#10;&#10;{{input}}"
            rows={4}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent resize-none font-mono"
          />
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={!formName.trim() || !formTemplate.trim()} className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:brightness-110 disabled:opacity-50">
              {editing ? 'Update' : 'Create'}
            </button>
            <button onClick={resetForm} className="px-3 py-1.5 rounded bg-gray-700 text-gray-300 text-xs hover:bg-gray-600">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'ai', label: 'AI' },
  { key: 'data', label: 'Data' },
  { key: 'templates', label: 'Templates' },
  { key: 'intel', label: 'Intel' },
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
      <div className="flex gap-1 overflow-x-auto no-scrollbar" role="tablist" aria-label="Settings sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`settings-panel-${tab.key}`}
            id={`settings-tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
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

      {/* Appearance Tab */}
      {activeTab === 'appearance' && (
        <div className="space-y-6">
          {/* Theme toggle — moved from General */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">Theme</h3>
            <div className="flex items-center justify-between">
              <label className={labelClass}>Mode</label>
              <select
                value={settings.theme}
                onChange={(e) => onUpdateSettings({ theme: e.target.value as 'dark' | 'light' })}
                className={selectClass}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
          </div>
          <AppearanceSettings settings={settings} onUpdateSettings={onUpdateSettings} />
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
                    const provider = MODEL_PROVIDER_MAP[model] || (model === settings.llmLocalModelName ? 'local' : 'anthropic');
                    onUpdateSettings({ llmDefaultModel: model, llmDefaultProvider: provider as Settings['llmDefaultProvider'] });
                  }}
                  className={selectClass}
                >
                  {Array.from(new Set(MODELS.map(m => m.group))).map(group => (
                    <optgroup key={group} label={group}>
                      {MODELS.filter(m => m.group === group).map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </optgroup>
                  ))}
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

              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">Token budget per thread</label>
                <input
                  type="number"
                  min={0}
                  step={10000}
                  value={settings.llmTokenBudget || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    onUpdateSettings({ llmTokenBudget: isNaN(val) || val <= 0 ? undefined : val });
                  }}
                  placeholder="No limit"
                  className="w-28 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent text-right"
                />
              </div>
              <p className="text-[10px] text-gray-600">
                Token usage badge turns amber at 80% and red when exceeded. Leave empty for no limit.
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

          {/* Custom Slash Commands */}
          <CustomSlashCommandsEditor />
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
