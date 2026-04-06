import { useState, useCallback } from 'react';
import { Github, Download, FlaskConical, Trash2, Bot, X, Shield, RefreshCw, RotateCcw, Plus, Pencil, Wrench, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import type { Settings, Note, NoteTemplate, PlaybookTemplate, PlaybookStep, CustomSlashCommand } from '../../types';
import { useCustomSlashCommands } from '../../hooks/useCustomSlashCommands';
import { TemplateManager } from './TemplateManager';
import { PlaybookManager } from './PlaybookManager';
import { DEFAULT_SYSTEM_PROMPT } from '../../lib/llm-tools';
import { MODELS, MODEL_PROVIDER_MAP } from '../../lib/models';
import { ExportImport } from './ExportImport';
import { useAgentProfiles } from '../../hooks/useAgentProfiles';
import { AgentProfileManager } from '../Agent/AgentProfileManager';
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

type SettingsTab = 'general' | 'appearance' | 'ai' | 'agents' | 'data' | 'templates' | 'intel' | 'integrations' | 'shortcuts';

// ── Custom Slash Commands Editor ────────────────────────────────────

function AgentProfileSection() {
  const { profiles, userProfiles, builtinProfiles, createProfile, updateProfile, deleteProfile, duplicateBuiltin } = useAgentProfiles();
  return (
    <AgentProfileManager
      profiles={profiles}
      userProfiles={userProfiles}
      builtinProfiles={builtinProfiles}
      onCreateProfile={createProfile}
      onUpdateProfile={updateProfile}
      onDeleteProfile={deleteProfile}
      onDuplicateBuiltin={duplicateBuiltin}
    />
  );
}

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
  { key: 'agents', label: 'Agents' },
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
      <div className="flex gap-0.5 border-b border-gray-700 pb-0" role="tablist" aria-label="Settings sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`settings-panel-${tab.key}`}
            id={`settings-tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-1 py-2 text-xs font-medium text-center transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'border-accent text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-6" role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general">
          {/* Team Server */}
          <ServerConnection
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />

          {/* Identity */}
          {(() => {
            let teamName: string | undefined;
            try {
              const stored = JSON.parse(localStorage.getItem('threatcaddy-auth') || 'null');
              teamName = stored?.user?.displayName;
            } catch { /* ignore */ }
            return (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300">Your Identity</h3>
                <div className="space-y-1.5">
                  <label className={labelClass}>Display Name</label>
                  {teamName ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-200">{teamName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">from team server</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={settings.displayName || ''}
                      onChange={(e) => onUpdateSettings({ displayName: e.target.value.trim() || undefined })}
                      placeholder="Your name (shown on entities you create)"
                      className={selectClass}
                    />
                  )}
                  <p className="text-[10px] text-gray-500">
                    {teamName
                      ? 'Using your team server account name for attribution.'
                      : 'Used for attribution on notes, IOCs, and other entities you create. Defaults to "Analyst" if not set.'}
                  </p>
                </div>
              </div>
            );
          })()}

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
        <div className="space-y-6" role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance">
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
        <div className="space-y-6" role="tabpanel" id="settings-panel-ai" aria-labelledby="settings-tab-ai">
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

              <LocalLLMConfig settings={settings} onUpdateSettings={onUpdateSettings} />

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

              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">LLM request routing</label>
                <select
                  value={settings.llmRoutingMode || 'extension'}
                  onChange={(e) => onUpdateSettings({ llmRoutingMode: e.target.value as 'extension' | 'server' | 'auto' })}
                  className={selectClass}
                >
                  <option value="extension">Browser Extension</option>
                  <option value="server">Team Server Proxy</option>
                  <option value="auto">Auto (server when connected)</option>
                </select>
              </div>
              <p className="text-[10px] text-gray-600">
                Extension: routes through the browser extension (requires API keys locally). Server: routes through the team server (uses server API keys). Auto: prefers server when connected.
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

      {/* Agents Tab */}
      {activeTab === 'agents' && (
        <div className="space-y-6" role="tabpanel" id="settings-panel-agents" aria-labelledby="settings-tab-agents">
          {/* Agent Profiles */}
          <AgentProfileSection />

          {/* Supervisor Agent */}
          <div className="border border-gray-700 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Bot size={16} />
              Supervisor Agent
            </h3>
            <p className="text-xs text-gray-500">
              Cross-investigation analysis — detects shared IOCs, stale cases, and patterns across your caseload.
            </p>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-300">Enable Supervisor</span>
                <p className="text-[10px] text-gray-500">Runs every {settings.agentSupervisorIntervalMinutes || 30} minutes</p>
              </div>
              <button
                onClick={() => onUpdateSettings({ agentSupervisorEnabled: !settings.agentSupervisorEnabled })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${settings.agentSupervisorEnabled ? 'bg-accent-blue' : 'bg-gray-600'}`}
                role="switch"
                aria-checked={!!settings.agentSupervisorEnabled}
                aria-label="Enable supervisor agent"
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${settings.agentSupervisorEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </button>
            </div>
            {settings.agentSupervisorEnabled && (
              <div className="flex items-center gap-3 mt-2">
                <label className="text-xs text-gray-400 shrink-0">Interval</label>
                <input
                  type="range"
                  min={10}
                  max={120}
                  step={10}
                  value={settings.agentSupervisorIntervalMinutes || 30}
                  onChange={(e) => onUpdateSettings({ agentSupervisorIntervalMinutes: parseInt(e.target.value) })}
                  className="flex-1 h-1 accent-accent-blue"
                />
                <span className="text-xs text-gray-400 w-12 text-right">{settings.agentSupervisorIntervalMinutes || 30}m</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Data Tab */}
      {activeTab === 'data' && (
        <div className="space-y-6" role="tabpanel" id="settings-panel-data" aria-labelledby="settings-tab-data">
          <ExportImport notes={notes} onImportComplete={onImportComplete} />
          <EncryptionSettings />
          <CloudBackup />
          <ServerBackup />
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <div className="space-y-6" role="tabpanel" id="settings-panel-templates" aria-labelledby="settings-tab-templates">
          {templateProps && <TemplateManager {...templateProps} />}
          {playbookProps && <PlaybookManager {...playbookProps} />}
        </div>
      )}

      {/* Threat Intel Tab */}
      {activeTab === 'intel' && (
        <div className="space-y-6" role="tabpanel" id="settings-panel-intel" aria-labelledby="settings-tab-intel">
          <ThreatIntelConfig />
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-6" role="tabpanel" id="settings-panel-integrations" aria-labelledby="settings-tab-integrations">
          <IntegrationPanel />
        </div>
      )}

      {/* Shortcuts Tab */}
      {activeTab === 'shortcuts' && (
        <div className="space-y-6" role="tabpanel" id="settings-panel-shortcuts" aria-labelledby="settings-tab-shortcuts">
          <KeyboardShortcuts />
        </div>
      )}
    </div>
    </div>
  );
}

// ── Local LLM Configuration ─────────────────────────────────────────────

interface LocalLLMConfigProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
}

function LocalLLMConfig({ settings, onUpdateSettings }: LocalLLMConfigProps) {
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [fetchingSkills, setFetchingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState('');
  const [showSkills, setShowSkills] = useState(false);

  const labelClass = 'text-xs text-gray-400 font-medium';
  const inputClass = 'w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent';

  const getBaseUrl = useCallback(() => {
    return (settings.llmLocalEndpoint || 'http://localhost:11434/v1').replace(/\/+$/, '');
  }, [settings.llmLocalEndpoint]);

  const fetchModels = useCallback(async () => {
    setFetchingModels(true);
    setAvailableModels([]);
    try {
      const base = getBaseUrl();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (settings.llmLocalApiKey) headers['Authorization'] = `Bearer ${settings.llmLocalApiKey}`;

      // Try OpenAI-compatible /v1/models endpoint
      const resp = await fetch(`${base}/models`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      const models: string[] = [];
      if (Array.isArray(data.data)) {
        for (const m of data.data) {
          if (m.id && typeof m.id === 'string') models.push(m.id);
        }
      } else if (Array.isArray(data.models)) {
        // Ollama native /api/tags format
        for (const m of data.models) {
          if (m.name && typeof m.name === 'string') models.push(m.name);
        }
      }

      models.sort();
      setAvailableModels(models);

      // Auto-select first model if none set
      if (models.length > 0 && !settings.llmLocalModelName) {
        onUpdateSettings({ llmLocalModelName: models[0] });
      }
    } catch (err) {
      // Try Ollama's native API as fallback
      try {
        const ollamaBase = (settings.llmLocalEndpoint || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
        const resp = await fetch(`${ollamaBase}/api/tags`);
        if (resp.ok) {
          const data = await resp.json();
          const models = (data.models || [])
            .map((m: { name?: string }) => m.name)
            .filter((n: unknown): n is string => typeof n === 'string')
            .sort();
          setAvailableModels(models);
          if (models.length > 0 && !settings.llmLocalModelName) {
            onUpdateSettings({ llmLocalModelName: models[0] });
          }
          setFetchingModels(false);
          return;
        }
      } catch { /* ignore fallback error */ }

      setAvailableModels([]);
      console.warn('Failed to fetch models:', err);
    } finally {
      setFetchingModels(false);
    }
  }, [getBaseUrl, settings.llmLocalApiKey, settings.llmLocalModelName, onUpdateSettings, settings.llmLocalEndpoint]);

  const testConnection = useCallback(async () => {
    setTestStatus('testing');
    setTestError('');
    try {
      const base = getBaseUrl();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (settings.llmLocalApiKey) headers['Authorization'] = `Bearer ${settings.llmLocalApiKey}`;

      const model = settings.llmLocalModelName || 'test';
      const resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
          max_tokens: 10,
          stream: false,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${text.substring(0, 200)}`);
      }

      const data = await resp.json();
      if (data.choices?.[0]?.message?.content) {
        setTestStatus('success');
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (err) {
      setTestStatus('error');
      setTestError((err as Error).message || 'Connection failed');
    }
  }, [getBaseUrl, settings.llmLocalApiKey, settings.llmLocalModelName]);

  return (
    <div className="border border-gray-700 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm text-gray-300 font-medium">Local LLM (Ollama / LM Studio / vLLM)</label>
        <div className="flex items-center gap-1.5">
          {testStatus === 'success' && <CheckCircle2 size={12} className="text-green-400" />}
          {testStatus === 'error' && <AlertTriangle size={12} className="text-red-400" />}
          <button
            onClick={testConnection}
            disabled={testStatus === 'testing'}
            className="text-[10px] text-accent-blue hover:underline disabled:opacity-50"
          >
            {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </div>
      {testStatus === 'error' && testError && (
        <p className="text-[10px] text-red-400">{testError}</p>
      )}
      <div>
        <label className={labelClass}>Endpoint URL</label>
        <input
          type="text"
          value={settings.llmLocalEndpoint || ''}
          onChange={(e) => { onUpdateSettings({ llmLocalEndpoint: e.target.value.trim() || undefined }); setTestStatus('idle'); }}
          placeholder="http://localhost:11434/v1"
          className={inputClass}
        />
        <p className="text-[10px] text-gray-600 mt-0.5">Any OpenAI-compatible endpoint. Ollama: localhost:11434/v1, vLLM: localhost:8000/v1</p>
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
          className={inputClass}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className={labelClass}>Model</label>
          <button
            onClick={fetchModels}
            disabled={fetchingModels}
            className="flex items-center gap-1 text-[10px] text-accent-blue hover:underline disabled:opacity-50"
          >
            {fetchingModels ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {fetchingModels ? 'Fetching...' : 'Fetch Models'}
          </button>
        </div>
        {availableModels.length > 0 ? (
          <select
            value={settings.llmLocalModelName || ''}
            onChange={(e) => onUpdateSettings({ llmLocalModelName: e.target.value || undefined })}
            className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
          >
            <option value="">Select a model...</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={settings.llmLocalModelName || ''}
            onChange={(e) => onUpdateSettings({ llmLocalModelName: e.target.value.trim() || undefined })}
            placeholder="llama3.1, qwen2.5, mistral-nemo, etc."
            className={inputClass}
          />
        )}
        {availableModels.length > 0 && (
          <p className="text-[10px] text-green-400/70 mt-0.5">{availableModels.length} model{availableModels.length !== 1 ? 's' : ''} available</p>
        )}
      </div>

      {/* Agent Skills Discovery */}
      <div className="border-t border-gray-700 pt-3 mt-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-400 font-medium">Agent Skills</label>
          <button
            onClick={async () => {
              setFetchingSkills(true);
              setSkillsError('');
              try {
                const { fetchHostSkills } = await import('../../lib/agent-hosts');
                const baseUrl = (settings.llmLocalEndpoint || 'http://localhost:11434/v1').replace(/\/+$/, '').replace(/\/v1\/?$/, '');
                const skills = await fetchHostSkills({
                  id: 'local', name: 'local', displayName: 'Local Agent',
                  url: baseUrl, apiKey: settings.llmLocalApiKey, enabled: true, skills: [],
                });
                onUpdateSettings({ llmLocalSkills: skills, llmLocalSkillsFetchedAt: Date.now() });
                setShowSkills(true);
              } catch (err) {
                setSkillsError((err as Error).message);
                // Don't clear existing skills on failure
              } finally {
                setFetchingSkills(false);
              }
            }}
            disabled={fetchingSkills || !settings.llmLocalEndpoint}
            className="flex items-center gap-1 text-[10px] text-accent-blue hover:underline disabled:opacity-50"
          >
            {fetchingSkills ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {fetchingSkills ? 'Discovering...' : 'Discover Skills'}
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-0.5">
          If your endpoint exposes <code className="text-gray-500">GET /skills</code>, discovered skills become LLM tools for CaddyAI and agents.
        </p>
        {skillsError && <p className="text-[10px] text-gray-500 mt-1">Skill discovery failed: {skillsError.substring(0, 100)}. This feature is optional — your endpoint works fine for chat without it.</p>}
        {(settings.llmLocalSkills || []).length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowSkills(!showSkills)}
              className="text-[10px] text-green-400/70 hover:text-green-400"
            >
              {settings.llmLocalSkills!.length} skill{settings.llmLocalSkills!.length !== 1 ? 's' : ''} available {showSkills ? '▾' : '▸'}
            </button>
            {showSkills && (
              <div className="mt-1.5 space-y-1">
                {settings.llmLocalSkills!.map(skill => (
                  <div key={skill.name} className="flex items-start gap-2 py-1 border-b border-gray-800 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-gray-200">{skill.name}</span>
                        <span className={`text-[9px] px-1 rounded ${skill.actionClass === 'modify' ? 'text-amber-400' : skill.actionClass === 'read' ? 'text-green-400' : 'text-blue-400'} bg-gray-800`}>
                          {skill.actionClass || 'fetch'}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500">{skill.description}</p>
                    </div>
                    <span className="text-[9px] text-gray-600 font-mono shrink-0">local:{skill.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
