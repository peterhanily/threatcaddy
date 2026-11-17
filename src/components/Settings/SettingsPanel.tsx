import { workspaceStorageKey } from '../../lib/workspace-profiles';
import { useState, useCallback, useEffect, useId, useSyncExternalStore, type KeyboardEvent } from 'react';
import DOMPurify from 'dompurify';
import { CodeXml, Download, FlaskConical, Trash2, Bot, X, Shield, RefreshCw, RotateCcw, Plus, Pencil, Wrench, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import { useToast } from '../../contexts/ToastContext';
import type { Settings, Note, NoteTemplate, PlaybookTemplate, PlaybookStep, CustomSlashCommand } from '../../types';
import { useCustomSlashCommands } from '../../hooks/useCustomSlashCommands';
import { TemplateManager } from './TemplateManager';
import { PlaybookManager } from './PlaybookManager';
import { DEFAULT_SYSTEM_PROMPT } from '../../lib/llm-tools';
import { hasGuardedBridgeFetch } from '../../lib/llm-tools-analysis';
import { isHttpsOrLoopback } from '../../lib/agent-hosts';
import { MODELS, MODEL_PROVIDER_MAP } from '../../lib/models';
import { hasServerSession, resolveRoute } from '../../lib/llm-router';
import { readStoredAuth } from '../../lib/auth-storage';
import { ExportImport } from './ExportImport';
import { useAgentProfiles } from '../../hooks/useAgentProfiles';
import { AgentProfileManager } from '../Agent/AgentProfileManager';
import { ThreatIntelConfig } from './ThreatIntelConfig';
import { CloudBackup } from './CloudBackup';
import { ServerBackup } from './ServerBackup';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { EncryptionSettings } from '../Encryption/EncryptionSettings';
import { ServerConnection } from './ServerConnection';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { SyncRecoveryPanel } from './SyncRecoveryPanel';
import { IntegrationPanel } from '../Integrations/IntegrationPanel';
import { AppearanceSettings } from './AppearanceSettings';
import { OfflineUseSetting } from '../Common/OfflineStatusNotice';

function SystemPromptEditor({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const { t } = useTranslation('settings');
  const inputId = useId();
  const [expanded, setExpanded] = useState(false);
  const isCustom = !!value?.trim();
  const displayValue = value ?? DEFAULT_SYSTEM_PROMPT;

  return (
    <div className="border border-gray-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={inputId}
          className="text-sm text-gray-300 font-medium hover:text-gray-100 transition-colors text-start"
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
              aria-label={t('ai.systemPromptResetTitle')}
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
            id={inputId}
            aria-label={t('ai.systemPrompt')}
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
  parodyLoaded?: boolean;
  onLoadParody?: () => void;
  onDeleteParody?: () => void;
  onClose?: () => void;
  initialTab?: SettingsTab;
  activeTab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
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

export type SettingsTab = 'general' | 'appearance' | 'ai' | 'agents' | 'data' | 'templates' | 'intel' | 'integrations' | 'shortcuts';

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
  const fieldId = useId();
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
          <button onClick={() => startEdit(cmd)} aria-label={tc('edit')} className="p-1 text-gray-500 hover:text-gray-300"><Pencil size={12} /></button>
          <button onClick={async () => { await deleteCommand(cmd.id); addToast('success', tt('settings.slashCommandDeleted', { name: cmd.name })); }} aria-label={tc('delete')} className="p-1 text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
        </div>
      ))}

      {creating && (
        <div className="space-y-2 p-3 rounded-lg bg-gray-800/50 border border-gray-700">
          <label className="sr-only" htmlFor={`${fieldId}-name`}>{t('ai.commandNameLabel')}</label>
          <input
            id={`${fieldId}-name`}
            type="text"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder={t('ai.commandNamePlaceholder')}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent font-mono"
          />
          <label className="sr-only" htmlFor={`${fieldId}-description`}>{t('ai.commandDescLabel')}</label>
          <input
            id={`${fieldId}-description`}
            type="text"
            value={formDesc}
            onChange={e => setFormDesc(e.target.value)}
            placeholder={t('ai.commandDescPlaceholder')}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
          />
          <label className="sr-only" htmlFor={`${fieldId}-template`}>{t('ai.commandTemplateLabel')}</label>
          <textarea
            id={`${fieldId}-template`}
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

export function SettingsPanel({ settings, onUpdateSettings, notes, onImportComplete, sampleLoaded, onLoadSample, onDeleteSample, parodyLoaded, onLoadParody, onDeleteParody, onClose, initialTab, activeTab: controlledTab, onTabChange, templateProps, playbookProps }: SettingsPanelProps) {
  const { t } = useTranslation('settings');
  const { addToast } = useToast();
  const fieldId = useId();
  const [localTab, setLocalTab] = useState<SettingsTab>(initialTab || 'general');
  const [focusedTab, setFocusedTab] = useState<SettingsTab | null>(null);
  const activeTab = controlledTab ?? localTab;
  const setActiveTab = (tab: SettingsTab) => {
    if (onTabChange) onTabChange(tab);
    else setLocalTab(tab);
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: SettingsTab) => {
    const index = TAB_KEYS.indexOf(tab);
    const direction = getComputedStyle(event.currentTarget.parentElement ?? event.currentTarget).direction;
    const forward = direction === 'rtl' ? -1 : 1;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = (index - forward + TAB_KEYS.length) % TAB_KEYS.length; break;
      case 'ArrowRight': next = (index + forward + TAB_KEYS.length) % TAB_KEYS.length; break;
      case 'Home': next = 0; break;
      case 'End': next = TAB_KEYS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[next]?.focus();
  };
  const selectClass = 'min-w-0 max-w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const labelClass = 'text-sm text-gray-400';
  const preferenceRowClass = 'flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between';

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
    <div className="w-full min-w-0 max-w-2xl mx-auto p-3 sm:p-6 space-y-8 [overflow-wrap:anywhere]">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100">{t('title')}</h2>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" aria-label={t('closeSettings')}>
            <X size={18} />
          </button>
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex min-w-0 max-w-full gap-0.5 overflow-x-auto border-b border-gray-700 pb-0" role="tablist" aria-label={t('title')} aria-orientation="horizontal"
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedTab(null); }}>
        {TAB_KEYS.map((tabKey) => (
          <button
            key={tabKey}
            role="tab"
            aria-selected={activeTab === tabKey}
            aria-controls={`settings-panel-${tabKey}`}
            id={`settings-tab-${tabKey}`}
            tabIndex={(focusedTab ?? activeTab) === tabKey ? 0 : -1}
            onFocus={() => setFocusedTab(tabKey)}
            onKeyDown={event => handleTabKeyDown(event, tabKey)}
            onClick={() => setActiveTab(tabKey)}
            className={`shrink-0 flex-1 min-h-11 whitespace-nowrap px-3 py-2 text-xs font-medium text-center tracking-tight transition-colors border-b-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
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
        <div className="space-y-6" role="tabpanel" tabIndex={0} id="settings-panel-general" aria-labelledby="settings-tab-general">
          {/* Team Server */}
          <WorkspaceSwitcher />
          <ServerConnection
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />
          <SyncRecoveryPanel />

          {/* Identity */}
          {(() => {
            let teamName: string | undefined;
            try {
              const stored = JSON.parse(localStorage.getItem(workspaceStorageKey('threatcaddy-auth')) || 'null');
              teamName = stored?.user?.displayName;
            } catch { /* ignore */ }
            return (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300">{t('general.identity')}</h3>
                <div>
                  {teamName ? (
                    <p className="text-sm text-gray-400 mb-2">{t('general.displayName')}</p>
                  ) : (
                    <label htmlFor={`${fieldId}-display-name`} className="text-sm text-gray-400 block mb-2">{t('general.displayName')}</label>
                  )}
                  {teamName ? (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm text-gray-200">{teamName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">{t('general.fromTeamServer')}</span>
                    </div>
                  ) : (
                    <input
                      id={`${fieldId}-display-name`}
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

            <div className={preferenceRowClass}>
              <label htmlFor={`${fieldId}-editor-mode`} className={labelClass}>{t('general.editorMode')}</label>
              <select
                id={`${fieldId}-editor-mode`}
                value={settings.editorMode}
                onChange={(e) => onUpdateSettings({ editorMode: e.target.value as Settings['editorMode'] })}
                className={selectClass}
              >
                <option value="edit">{t('general.editorMode.edit')}</option>
                <option value="split">{t('general.editorMode.split')}</option>
                <option value="preview">{t('general.editorMode.preview')}</option>
              </select>
            </div>

            <div className={preferenceRowClass}>
              <label htmlFor={`${fieldId}-task-view`} className={labelClass}>{t('general.taskView')}</label>
              <select
                id={`${fieldId}-task-view`}
                value={settings.taskViewMode}
                onChange={(e) => onUpdateSettings({ taskViewMode: e.target.value as Settings['taskViewMode'] })}
                className={selectClass}
              >
                <option value="list">{t('general.taskView.list')}</option>
                <option value="kanban">{t('general.taskView.kanban')}</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className={preferenceRowClass}>
                <label htmlFor={`${fieldId}-language`} className={labelClass}>{t('general.language')}</label>
                <select
                  id={`${fieldId}-language`}
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
              <p className="text-[10px] text-gray-500 text-end">{t('general.languageHelp')}</p>
            </div>
          </div>

          {/* Notifications */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">{t('general.notifications')}</h3>
            {(['mention', 'reply', 'reaction', 'invite', 'bot'] as const).map((key) => {
              const enabled = settings.notificationPrefs?.[key] !== false;
              return (
                <div key={key} className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span id={`${fieldId}-notification-${key}`} className="text-sm text-gray-300">{t(`general.notifications.${key}`)}</span>
                    <p id={`${fieldId}-notification-${key}-help`} className="text-xs text-gray-500">{t(`general.notifications.${key}Desc`)}</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={enabled}
                    aria-labelledby={`${fieldId}-notification-${key}`}
                    aria-describedby={`${fieldId}-notification-${key}-help`}
                    onClick={() => onUpdateSettings({ notificationPrefs: { ...settings.notificationPrefs, [key]: !enabled } })}
                    className="flex min-w-11 min-h-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span aria-hidden="true" className={`relative w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-gray-700'}`}>
                      <span className={`absolute top-0.5 start-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4 rtl:-translate-x-4' : ''}`} />
                    </span>
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
              <p className="text-sm text-gray-300">{t('general.realisticSample')}</p>
              {sampleLoaded ? (
                <button
                  data-tour="load-sample"
                  onClick={onDeleteSample}
                  className="flex min-h-11 items-center gap-2 px-4 py-2 rounded-lg bg-red-600/15 text-red-400 hover:bg-red-600/25 text-sm font-medium transition-colors"
                >
                  <Trash2 size={16} />
                  {t('general.removeSample')}
                </button>
              ) : (
                <button
                  data-tour="load-sample"
                  onClick={onLoadSample}
                  className="flex min-h-11 items-center gap-2 px-4 py-2 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-sm font-medium transition-colors"
                >
                  <FlaskConical size={16} />
                  {t('general.loadSample')}
                </button>
              )}
              {(onLoadParody || onDeleteParody) && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-300">{t('general.parodySample')}</p>
                  <button
                    onClick={parodyLoaded ? onDeleteParody : onLoadParody}
                    className="flex min-h-11 items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 text-gray-200 hover:bg-gray-700 text-sm font-medium transition-colors"
                    aria-label={`${t(parodyLoaded ? 'general.removeSample' : 'general.loadSample')} — ${t('general.parodySample')}`}
                  >
                    {parodyLoaded ? <Trash2 size={16} /> : <FlaskConical size={16} />}
                    {t(parodyLoaded ? 'general.removeSample' : 'general.loadSample')}
                  </button>
                </div>
              )}
            </div>
          )}

          <OfflineUseSetting />

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
                <CodeXml size={16} />
                {t('general.github')}
              </a>
              {typeof __STANDALONE__ !== 'undefined' && __STANDALONE__ ? (
                <button
                  onClick={async () => {
                    try {
                      const dlController = new AbortController();
                      setTimeout(() => dlController.abort(), 30_000);
                      const resp = await fetch('https://threatcaddy.com/threatcaddy-standalone.html', { signal: dlController.signal });
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
            <p className="flex items-center gap-1.5 text-xs text-gray-600 pt-3">
              <FlaskConical size={12} />
              <a
                href="https://caddylabs.io"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-400 transition-colors"
              >
                {t('general.caddylabsTagline')}
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Appearance Tab */}
      {activeTab === 'appearance' && (
        <div className="space-y-6" role="tabpanel" tabIndex={0} id="settings-panel-appearance" aria-labelledby="settings-tab-appearance">
          {/* Theme toggle — moved from General */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">{t('appearance.theme')}</h3>
            <div className={preferenceRowClass}>
              <label htmlFor={`${fieldId}-theme`} className={labelClass}>{t('appearance.mode')}</label>
              <select
                id={`${fieldId}-theme`}
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
        <div className="space-y-6" role="tabpanel" tabIndex={0} id="settings-panel-ai" aria-labelledby="settings-tab-ai">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Bot size={16} />
              {t('ai.title')}
            </h3>

            <div className="space-y-3">
              <div>
                <label htmlFor={`${fieldId}-anthropic`} className={labelClass}>{t('ai.anthropicKey')}</label>
                <input
                  id={`${fieldId}-anthropic`}
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
                <label htmlFor={`${fieldId}-openai`} className={labelClass}>{t('ai.openaiKey')}</label>
                <input
                  id={`${fieldId}-openai`}
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
                <label htmlFor={`${fieldId}-gemini`} className={labelClass}>{t('ai.geminiKey')}</label>
                <input
                  id={`${fieldId}-gemini`}
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
                <label htmlFor={`${fieldId}-mistral`} className={labelClass}>{t('ai.mistralKey')}</label>
                <input
                  id={`${fieldId}-mistral`}
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

              <div className={preferenceRowClass}>
                <label htmlFor={`${fieldId}-default-model`} className={labelClass}>{t('ai.defaultModel')}</label>
                <select
                  id={`${fieldId}-default-model`}
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

              <div className={preferenceRowClass}>
                <label htmlFor={`${fieldId}-context-messages`} className={labelClass}>{t('ai.maxContextMessages')}</label>
                <input
                  id={`${fieldId}-context-messages`}
                  type="number"
                  min={6}
                  max={200}
                  step={2}
                  value={settings.llmMaxContextMessages || 40}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 6) onUpdateSettings({ llmMaxContextMessages: val });
                  }}
                  className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent text-end"
                />
              </div>
              <p className="text-[10px] text-gray-600">
                {t('ai.maxContextHelp')}
              </p>

              <div className={preferenceRowClass}>
                <label htmlFor={`${fieldId}-token-budget`} className="text-xs text-gray-400">{t('ai.tokenBudget')}</label>
                <input
                  id={`${fieldId}-token-budget`}
                  type="number"
                  min={0}
                  step={10000}
                  value={settings.llmTokenBudget || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    onUpdateSettings({ llmTokenBudget: isNaN(val) || val <= 0 ? undefined : val });
                  }}
                  placeholder={t('ai.tokenBudgetPlaceholder')}
                  className="w-28 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent text-end"
                />
              </div>
              <p className="text-[10px] text-gray-600">
                {t('ai.tokenBudgetHelp')}
              </p>

              <div className={preferenceRowClass}>
                <label htmlFor={`${fieldId}-routing`} className="text-xs text-gray-400">{t('ai.routing')}</label>
                <select
                  id={`${fieldId}-routing`}
                  value={settings.llmRoutingMode ?? 'auto'}
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

              <AIDataFlow settings={settings} onUpdateSettings={onUpdateSettings} />

              <SystemPromptEditor
                value={settings.llmSystemPrompt}
                onChange={(v) => onUpdateSettings({ llmSystemPrompt: v })}
              />

              <p className="text-[10px] text-gray-600">
                {t('ai.keysRouteNote')}
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
        <div className="space-y-6" role="tabpanel" tabIndex={0} id="settings-panel-agents" aria-labelledby="settings-tab-agents">
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
                <label htmlFor={`${fieldId}-supervisor-interval`} className="text-xs text-gray-400 shrink-0">{t('agents.interval')}</label>
                <input
                  id={`${fieldId}-supervisor-interval`}
                  type="range"
                  min={10}
                  max={120}
                  step={10}
                  value={settings.agentSupervisorIntervalMinutes || 30}
                  onChange={(e) => onUpdateSettings({ agentSupervisorIntervalMinutes: parseInt(e.target.value) })}
                  className="flex-1 h-1 accent-accent-blue"
                />
                <span className="text-xs text-gray-400 w-12 text-end">{settings.agentSupervisorIntervalMinutes || 30}m</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Data Tab */}
      {activeTab === 'data' && (
        <div className="space-y-6" role="tabpanel" tabIndex={0} id="settings-panel-data" aria-labelledby="settings-tab-data">
          <ExportImport notes={notes} onImportComplete={onImportComplete} />
          <EncryptionSettings />
          <CloudBackup />
          <ServerBackup />
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <div className="space-y-6" role="tabpanel" tabIndex={0} id="settings-panel-templates" aria-labelledby="settings-tab-templates">
          {templateProps && <TemplateManager {...templateProps} />}
          {playbookProps && <PlaybookManager {...playbookProps} />}
        </div>
      )}

      {/* Threat Intel Tab */}
      {activeTab === 'intel' && (
        <div className="space-y-6" role="tabpanel" tabIndex={0} id="settings-panel-intel" aria-labelledby="settings-tab-intel">
          <ThreatIntelConfig />
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-6" role="tabpanel" tabIndex={0} id="settings-panel-integrations" aria-labelledby="settings-tab-integrations">
          <IntegrationPanel />
        </div>
      )}

      {/* Shortcuts Tab */}
      {activeTab === 'shortcuts' && (
        <div className="space-y-6" role="tabpanel" tabIndex={0} id="settings-panel-shortcuts" aria-labelledby="settings-tab-shortcuts">
          <KeyboardShortcuts />
        </div>
      )}
    </div>
    </div>
  );
}

// ── Where AI data goes ──────────────────────────────────────────────────

const hostOf = (url?: string) => { try { return new URL(url ?? '').host; } catch { return url ?? ''; } };

// The extension bridge publishes its capabilities once it has approved this page,
// and withdraws them while it rechecks that approval.
const subscribeBridgeCaps = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tc-bridge-caps'] });
  return () => observer.disconnect();
};
const bridgeCapsSnapshot = () => document.documentElement.dataset.tcBridgeCaps ?? '';

// Without a local endpoint every model takes the routing mode's route; with one, cloud models still do.
const ROUTE_KEYS = {
  all: { server: 'ai.dataFlow.routeServer', extension: 'ai.dataFlow.routeExtension', 'no-extension': 'ai.dataFlow.routeNoExtension', 'no-server': 'ai.dataFlow.routeNoServer', none: 'ai.dataFlow.routeNone' },
  cloud: { server: 'ai.dataFlow.routeCloudServer', extension: 'ai.dataFlow.routeCloudExtension', 'no-extension': 'ai.dataFlow.routeCloudNoExtension', 'no-server': 'ai.dataFlow.routeCloudNoServer', none: 'ai.dataFlow.routeCloudNone' },
} as const;

/** Describes where requests go for every model the analyst can pick: a local model with an endpoint is
 * called directly, and cloud models take the route resolveRoute picks for them. Chat, agent cycles,
 * meetings and the supervisor route with the same resolver and session check. */
function AIDataFlow({ settings, onUpdateSettings }: { settings: Settings; onUpdateSettings: (updates: Partial<Settings>) => void }) {
  const { t } = useTranslation('settings');
  const headingId = useId();
  const capsText = useSyncExternalStore(subscribeBridgeCaps, bridgeCapsSnapshot);
  const caps = capsText.split(',').filter(Boolean);
  const localEndpoint = settings.llmLocalEndpoint?.trim();
  // Every cloud provider takes the same route.
  const cloud = resolveRoute(settings, { extensionAvailable: caps.length > 0, serverSession: hasServerSession(), provider: 'anthropic' });
  const keys = ROUTE_KEYS[localEndpoint ? 'cloud' : 'all'];
  const cloudKey = keys[cloud.route === 'unavailable' ? cloud.reason : cloud.route === 'server' ? 'server' : 'extension'];
  // Server-routed requests go to the signed-in session's server.
  const routeLines = [
    ...(localEndpoint ? [t('ai.dataFlow.routeLocal', { host: hostOf(localEndpoint) })] : []),
    t(cloudKey, cloud.route === 'server' ? { host: hostOf(readStoredAuth()?.serverUrl) } : {}),
  ];
  // Web fetch asks the extension bridge at call time; show the same answer.
  const [fetchCheck, setFetchCheck] = useState<{ caps: string; guarded: boolean }>();
  useEffect(() => {
    if (!capsText) return;
    let current = true;
    void hasGuardedBridgeFetch().then(guarded => { if (current) setFetchCheck({ caps: capsText, guarded }); });
    return () => { current = false; };
  }, [capsText]);
  const fetchLine = !caps.length ? t('ai.dataFlow.fetchNoExtension')
    : fetchCheck?.caps !== capsText ? null
    : t(fetchCheck.guarded ? 'ai.dataFlow.fetchSupported' : 'ai.dataFlow.fetchUpdate');
  const hosts = settings.agentHosts ?? [];
  const bridgeOn = settings.agentBridgeEnabled === true;

  return (
    <section aria-labelledby={headingId} className="border border-gray-700 rounded-lg p-3 space-y-2">
      <h4 id={headingId} className="text-sm text-gray-300 font-medium">{t('ai.dataFlow.title')}</h4>
      {routeLines.map(line => <p key={line} className="text-xs text-gray-400">{line}</p>)}
      {fetchLine && <p className="text-xs text-gray-400">{fetchLine}</p>}
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <span id={`${headingId}-bridge`} className="text-xs text-gray-300">{t('ai.dataFlow.bridgeLabel')}</span>
          <p id={`${headingId}-bridge-help`} className="text-[10px] text-gray-500">{t('ai.dataFlow.bridgeHelp')}</p>
        </div>
        <button
          role="switch"
          aria-checked={bridgeOn}
          aria-labelledby={`${headingId}-bridge`}
          aria-describedby={`${headingId}-bridge-help`}
          onClick={() => onUpdateSettings({ agentBridgeEnabled: !bridgeOn })}
          className="flex min-w-11 min-h-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true" className={`relative w-9 h-5 rounded-full transition-colors ${bridgeOn ? 'bg-accent' : 'bg-gray-700'}`}>
            <span className={`absolute top-0.5 start-0.5 w-4 h-4 rounded-full bg-white transition-transform ${bridgeOn ? 'translate-x-4 rtl:-translate-x-4' : ''}`} />
          </span>
        </button>
      </div>
      {hosts.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-300">{t('ai.dataFlow.hostsTitle')}</p>
          <p className="text-[10px] text-gray-500">{t('ai.dataFlow.hostsHelp')}</p>
          <ul className="space-y-1">
            {hosts.map(host => (
              <li key={host.id} className="flex min-w-0 items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-gray-300">
                  {host.displayName || host.name} <span className="text-gray-500">{host.url}</span>
                  {!isHttpsOrLoopback(host.url) && <span className="block text-[10px] text-amber-400">{t('ai.dataFlow.hostNeedsHttps')}</span>}
                </span>
                <button
                  onClick={() => onUpdateSettings({ agentHosts: hosts.filter(item => item.id !== host.id) })}
                  aria-label={t('ai.dataFlow.removeHostLabel', { name: host.displayName || host.name })}
                  className="shrink-0 rounded px-2 py-1 text-red-400 hover:bg-red-600/15 transition-colors"
                >
                  {t('ai.dataFlow.removeHost')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── Local LLM Configuration ─────────────────────────────────────────────

interface LocalLLMConfigProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
}

function LocalLLMConfig({ settings, onUpdateSettings }: LocalLLMConfigProps) {
  const { t } = useTranslation('settings');
  const fieldId = useId();
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
      const modelsCtrl = new AbortController();
      const modelsTimer = setTimeout(() => modelsCtrl.abort(), 10_000);
      const resp = await fetch(`${base}/models`, { headers, signal: modelsCtrl.signal }).finally(() => clearTimeout(modelsTimer));
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
        const tagsCtrl = new AbortController();
        const tagsTimer = setTimeout(() => tagsCtrl.abort(), 10_000);
        const resp = await fetch(`${ollamaBase}/api/tags`, { signal: tagsCtrl.signal }).finally(() => clearTimeout(tagsTimer));
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
      const testCtrl = new AbortController();
      const testTimer = setTimeout(() => testCtrl.abort(), 15_000);
      const resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
          max_tokens: 10,
          stream: false,
        }),
        signal: testCtrl.signal,
      }).finally(() => clearTimeout(testTimer));

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm text-gray-300 font-medium">{t('ai.localLlm')}</h4>
        <div className="flex shrink-0 items-center gap-1.5">
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
        <label htmlFor={`${fieldId}-endpoint`} className={labelClass}>{t('ai.endpointUrl')}</label>
        <input
          id={`${fieldId}-endpoint`}
          type="text"
          value={settings.llmLocalEndpoint || ''}
          onChange={(e) => { onUpdateSettings({ llmLocalEndpoint: e.target.value.trim() || undefined }); setTestStatus('idle'); }}
          placeholder="http://localhost:11434/v1"
          className={inputClass}
        />
        <p className="text-[10px] text-gray-600 mt-0.5">{t('ai.endpointHelp')}</p>
      </div>
      <div>
        <label htmlFor={`${fieldId}-api-key`} className={labelClass}>{t('ai.localApiKey')}</label>
        <input
          id={`${fieldId}-api-key`}
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
          <label htmlFor={`${fieldId}-model`} className={labelClass}>{t('ai.model')}</label>
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
            id={`${fieldId}-model`}
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
            id={`${fieldId}-model`}
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
          <h4 className="text-xs text-gray-400 font-medium">{t('ai.agentSkills')}</h4>
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
