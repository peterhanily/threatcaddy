import { useState, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { Github, Download, FlaskConical, Trash2, Bot, X, Shield, RefreshCw, RotateCcw, Plus, Pencil, Wrench, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n';
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
  const { t } = useTranslation('settings');
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
          {t('ai.systemPrompt')} {expanded ? '▾' : '▸'}
        </button>
        <div className="flex items-center gap-2">
          {isCustom && (
            <span className="text-[10px] text-accent font-medium">{t('ai.systemPromptCustom')}</span>
          )}
          {isCustom && (
            <button
              onClick={() => onChange(undefined)}
              className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
              title={t('ai.systemPromptResetTitle')}
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <>
          <p className="text-[10px] text-gray-500">
            {t('ai.systemPromptHelp')}
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
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { t: tt } = useTranslation('toast');
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
      addToast('success', tt('settings.slashCommandUpdated', { name }));
    } else {
      await createCommand(name, formDesc, formTemplate);
      addToast('success', tt('settings.slashCommandCreated', { name }));
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
          <Wrench size={14} /> {t('ai.slashCommands')}
        </h3>
        {!creating && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
            <Plus size={12} /> {tc('add')}
          </button>
        )}
      </div>

      {commands.length === 0 && !creating && (
        <p className="text-xs text-gray-500">{t('ai.slashCommandsEmpty')}</p>
      )}

      {commands.map(cmd => (
        <div key={cmd.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-gray-800/50 border border-gray-700/50">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-mono text-purple font-medium">/{cmd.name}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{cmd.description || t('ai.noDescription')}</div>
            <div className="text-[10px] text-gray-600 mt-0.5 truncate font-mono">{cmd.template.slice(0, 80)}</div>
          </div>
          <button onClick={() => startEdit(cmd)} className="p-1 text-gray-500 hover:text-gray-300"><Pencil size={12} /></button>
          <button onClick={async () => { await deleteCommand(cmd.id); addToast('success', tt('settings.slashCommandDeleted', { name: cmd.name })); }} className="p-1 text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
        </div>
      ))}

      {creating && (
        <div className="space-y-2 p-3 rounded-lg bg-gray-800/50 border border-gray-700">
          <input
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder={t('ai.commandNamePlaceholder')}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent font-mono"
          />
          <input
            value={formDesc}
            onChange={e => setFormDesc(e.target.value)}
            placeholder={t('ai.commandDescPlaceholder')}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
          />
          <textarea
            value={formTemplate}
            onChange={e => setFormTemplate(e.target.value)}
            placeholder={t('ai.commandTemplatePlaceholder')}
            rows={4}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent resize-none font-mono"
          />
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={!formName.trim() || !formTemplate.trim()} className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:brightness-110 disabled:opacity-50">
              {editing ? tc('save') : tc('create')}
            </button>
            <button onClick={resetForm} className="px-3 py-1.5 rounded bg-gray-700 text-gray-300 text-xs hover:bg-gray-600">{tc('cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const TAB_KEYS: SettingsTab[] = ['general', 'appearance', 'ai', 'agents', 'data', 'templates', 'intel', 'integrations', 'shortcuts'];

export function SettingsPanel({ settings, onUpdateSettings, notes, onImportComplete, sampleLoaded, onLoadSample, onDeleteSample, onClose, initialTab, templateProps, playbookProps }: SettingsPanelProps) {
  const { t } = useTranslation('settings');
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'general');
  const selectClass = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const labelClass = 'text-sm text-gray-400';

  return (
    <div className="flex-1 overflow-y-auto">
    <div className="w-full max-w-2xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100">{t('title')}</h2>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" aria-label={t('closeSettings')}>
            <X size={18} />
          </button>
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex gap-0.5 border-b border-gray-700 pb-0" role="tablist" aria-label={t('title')}>
        {TAB_KEYS.map((tabKey) => (
          <button
            key={tabKey}
            role="tab"
            aria-selected={activeTab === tabKey}
            aria-controls={`settings-panel-${tabKey}`}
            id={`settings-tab-${tabKey}`}
            onClick={() => setActiveTab(tabKey)}
            className={`flex-1 px-1 py-2 text-xs font-medium text-center tracking-tight transition-colors border-b-2 ${
              activeTab === tabKey
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t(`tabs.${tabKey}`)}
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
                <h3 className="text-sm font-semibold text-gray-300">{t('general.identity')}</h3>
                <div>
                  <label className="text-sm text-gray-400 block mb-2">{t('general.displayName')}</label>
                  {teamName ? (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm text-gray-200">{teamName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">{t('general.fromTeamServer')}</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={settings.displayName || ''}
                      onChange={(e) => onUpdateSettings({ displayName: e.target.value.trim() || undefined })}
                      placeholder={t('general.displayNamePlaceholder')}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent mb-2"
                    />
                  )}
                  <p className="text-[10px] text-gray-500">
                    {teamName
                      ? t('general.displayNameHelpTeam')
                      : t('general.displayNameHelp')}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Preferences */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">{t('general.preferences')}</h3>

            <div className="flex items-center justify-between">
              <label className={labelClass}>{t('general.editorMode')}</label>
              <select
                value={settings.editorMode}
                onChange={(e) => onUpdateSettings({ editorMode: e.target.value as Settings['editorMode'] })}
                className={selectClass}
              >
                <option value="edit">{t('general.editorMode.edit')}</option>
                <option value="split">{t('general.editorMode.split')}</option>
                <option value="preview">{t('general.editorMode.preview')}</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <label className={labelClass}>{t('general.taskView')}</label>
              <select
                value={settings.taskViewMode}
                onChange={(e) => onUpdateSettings({ taskViewMode: e.target.value as Settings['taskViewMode'] })}
                className={selectClass}
              >
                <option value="list">{t('general.taskView.list')}</option>
                <option value="kanban">{t('general.taskView.kanban')}</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className={labelClass}>{t('general.language')}</label>
                <select
                  value={settings.language ?? 'en'}
                  onChange={(e) => onUpdateSettings({ language: e.target.value })}
                  className={selectClass}
                >
                  {SUPPORTED_LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>
                      {lang.nativeName}{lang.name !== lang.nativeName ? ` — ${lang.name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-gray-500 text-right">{t('general.languageHelp')}</p>
            </div>
          </div>

          {/* Notifications */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">{t('general.notifications')}</h3>
            {(['mention', 'reply', 'reaction', 'invite', 'bot'] as const).map((key) => {
              const enabled = settings.notificationPrefs?.[key] !== false;
              return (
                <div key={key} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-300">{t(`general.notifications.${key}`)}</span>
                    <p className="text-xs text-gray-500">{t(`general.notifications.${key}Desc`)}</p>
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
              <h3 className="text-sm font-semibold text-gray-300">{t('general.sampleData')}</h3>
              <p className="text-xs text-gray-500">
                {t('general.sampleDataDesc')}
              </p>
              {sampleLoaded ? (
                <button
                  data-tour="load-sample"
                  onClick={onDeleteSample}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/15 text-red-400 hover:bg-red-600/25 text-sm font-medium transition-colors"
                >
                  <Trash2 size={16} />
                  {t('general.removeSample')}
                </button>
              ) : (
                <button
                  data-tour="load-sample"
                  onClick={onLoadSample}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-sm font-medium transition-colors"
                >
                  <FlaskConical size={16} />
                  {t('general.loadSample')}
                </button>
              )}
            </div>
          )}

          {/* About */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">{t('general.about')}</h3>
            <p className="text-sm text-gray-400">
              {t('general.aboutDesc')}
            </p>
            <p className="text-xs text-gray-600">{t('general.aboutLocalFirst')}</p>
            <div className="flex items-center gap-4 pt-2">
              <a
                href="https://github.com/peterhanily/threatcaddy"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
              >
                <Github size={16} />
                {t('general.github')}
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
                      addToast('error', t('general.updateFailed'));
                    }
                  }}
                  className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  <RefreshCw size={16} />
                  {t('general.update')}
                </button>
              ) : (
                <a
                  href="./threatcaddy-standalone.html"
                  download
                  className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  <Download size={16} />
                  {t('general.downloadStandalone')}
                </a>
              )}
              <a
                href="https://threatcaddy.com/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors"
              >
                <Shield size={16} />
                {t('general.privacy')}
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
            <h3 className="text-sm font-semibold text-gray-300">{t('appearance.theme')}</h3>
            <div className="flex items-center justify-between">
              <label className={labelClass}>{t('appearance.mode')}</label>
              <select
                value={settings.theme}
                onChange={(e) => onUpdateSettings({ theme: e.target.value as 'dark' | 'light' })}
                className={selectClass}
              >
                <option value="dark">{t('appearance.dark')}</option>
                <option value="light">{t('appearance.light')}</option>
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
              {t('ai.title')}
            </h3>

            <div className="space-y-3">
              <div>
                <label className={labelClass}>{t('ai.anthropicKey')}</label>
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
                <label className={labelClass}>{t('ai.openaiKey')}</label>
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
                <label className={labelClass}>{t('ai.geminiKey')}</label>
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
                <label className={labelClass}>{t('ai.mistralKey')}</label>
                <input
                  type="password"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  value={settings.llmMistralApiKey || ''}
                  onChange={(e) => onUpdateSettings({ llmMistralApiKey: e.target.value.trim() || undefined })}
                  placeholder={t('ai.mistralPlaceholder')}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
                />
              </div>

              <LocalLLMConfig settings={settings} onUpdateSettings={onUpdateSettings} />

              <div className="flex items-center justify-between">
                <label className={labelClass}>{t('ai.defaultModel')}</label>
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
                    <optgroup label={t('ai.localGroup')}>
                      <option value={settings.llmLocalModelName}>{t('ai.localModelPrefix', { name: settings.llmLocalModelName })}</option>
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <label className={labelClass}>{t('ai.maxContextMessages')}</label>
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
                {t('ai.maxContextHelp')}
              </p>

              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">{t('ai.tokenBudget')}</label>
                <input
                  type="number"
                  min={0}
                  step={10000}
                  value={settings.llmTokenBudget || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    onUpdateSettings({ llmTokenBudget: isNaN(val) || val <= 0 ? undefined : val });
                  }}
                  placeholder={t('ai.tokenBudgetPlaceholder')}
                  className="w-28 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent text-right"
                />
              </div>
              <p className="text-[10px] text-gray-600">
                {t('ai.tokenBudgetHelp')}
              </p>

              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">{t('ai.routing')}</label>
                <select
                  value={settings.llmRoutingMode || 'extension'}
                  onChange={(e) => onUpdateSettings({ llmRoutingMode: e.target.value as 'extension' | 'server' | 'auto' })}
                  className={selectClass}
                >
                  <option value="extension">{t('ai.routing.extension')}</option>
                  <option value="server">{t('ai.routing.server')}</option>
                  <option value="auto">{t('ai.routing.auto')}</option>
                </select>
              </div>
              <p className="text-[10px] text-gray-600">
                {t('ai.routingHelp')}
              </p>

              <SystemPromptEditor
                value={settings.llmSystemPrompt}
                onChange={(v) => onUpdateSettings({ llmSystemPrompt: v })}
              />

              <p className="text-[10px] text-gray-600">
                {t('ai.keysLocalNote')}
              </p>
              {(settings.llmAnthropicApiKey || settings.llmOpenAIApiKey || settings.llmGeminiApiKey || settings.llmMistralApiKey) && (
                <p className="text-[10px] text-accent-green font-medium">{t('ai.apiKeySaved')}</p>
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
              {t('agents.supervisor')}
            </h3>
            <p className="text-xs text-gray-500">
              {t('agents.supervisorDesc')}
            </p>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-300">{t('agents.enableSupervisor')}</span>
                <p className="text-[10px] text-gray-500">{t('agents.supervisorInterval', { minutes: settings.agentSupervisorIntervalMinutes || 30 })}</p>
              </div>
              <button
                onClick={() => onUpdateSettings({ agentSupervisorEnabled: !settings.agentSupervisorEnabled })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${settings.agentSupervisorEnabled ? 'bg-accent-blue' : 'bg-gray-600'}`}
                role="switch"
                aria-checked={!!settings.agentSupervisorEnabled}
                aria-label={t('agents.supervisorAriaLabel')}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${settings.agentSupervisorEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </button>
            </div>
            {settings.agentSupervisorEnabled && (
              <div className="flex items-center gap-3 mt-2">
                <label className="text-xs text-gray-400 shrink-0">{t('agents.interval')}</label>
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
  const { t } = useTranslation('settings');
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
        <label className="text-sm text-gray-300 font-medium">{t('ai.localLlm')}</label>
        <div className="flex items-center gap-1.5">
          {testStatus === 'success' && <CheckCircle2 size={12} className="text-green-400" />}
          {testStatus === 'error' && <AlertTriangle size={12} className="text-red-400" />}
          <button
            onClick={testConnection}
            disabled={testStatus === 'testing'}
            className="text-[10px] text-accent-blue hover:underline disabled:opacity-50"
          >
            {testStatus === 'testing' ? t('ai.testing') : t('ai.testConnection')}
          </button>
        </div>
      </div>
      {testStatus === 'error' && testError && (
        <p className="text-[10px] text-red-400">{testError}</p>
      )}
      <div>
        <label className={labelClass}>{t('ai.endpointUrl')}</label>
        <input
          type="text"
          value={settings.llmLocalEndpoint || ''}
          onChange={(e) => { onUpdateSettings({ llmLocalEndpoint: e.target.value.trim() || undefined }); setTestStatus('idle'); }}
          placeholder="http://localhost:11434/v1"
          className={inputClass}
        />
        <p className="text-[10px] text-gray-600 mt-0.5">{t('ai.endpointHelp')}</p>
      </div>
      <div>
        <label className={labelClass}>{t('ai.localApiKey')}</label>
        <input
          type="password"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          value={settings.llmLocalApiKey || ''}
          onChange={(e) => onUpdateSettings({ llmLocalApiKey: e.target.value.trim() || undefined })}
          placeholder={t('ai.localApiKeyPlaceholder')}
          className={inputClass}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className={labelClass}>{t('ai.model')}</label>
          <button
            onClick={fetchModels}
            disabled={fetchingModels}
            className="flex items-center gap-1 text-[10px] text-accent-blue hover:underline disabled:opacity-50"
          >
            {fetchingModels ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {fetchingModels ? t('ai.fetching') : t('ai.fetchModels')}
          </button>
        </div>
        {availableModels.length > 0 ? (
          <select
            value={settings.llmLocalModelName || ''}
            onChange={(e) => onUpdateSettings({ llmLocalModelName: e.target.value || undefined })}
            className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
          >
            <option value="">{t('ai.selectModel')}</option>
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
          <p className="text-[10px] text-green-400/70 mt-0.5">{t('ai.modelsAvailable', { count: availableModels.length })}</p>
        )}
      </div>

      {/* Agent Skills Discovery */}
      <div className="border-t border-gray-700 pt-3 mt-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-400 font-medium">{t('ai.agentSkills')}</label>
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
            {fetchingSkills ? t('ai.discovering') : t('ai.discoverSkills')}
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-0.5" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('ai.skillsHelp'), { ALLOWED_TAGS: ['code'], ALLOWED_ATTR: [] }) }} />
        {skillsError && <p className="text-[10px] text-gray-500 mt-1">{t('ai.skillDiscoveryFailed', { error: skillsError.substring(0, 100) })}</p>}
        {(settings.llmLocalSkills || []).length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowSkills(!showSkills)}
              className="text-[10px] text-green-400/70 hover:text-green-400"
            >
              {t('ai.skillsAvailable', { count: settings.llmLocalSkills!.length })} {showSkills ? '▾' : '▸'}
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
