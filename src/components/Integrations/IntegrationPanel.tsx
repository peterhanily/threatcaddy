import { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, Settings2, Power, AlertCircle, Check, ExternalLink, Clock, Plus, Search, Upload, Download, RefreshCw, Share2, Users, Globe2, Loader2, ArrowUpCircle, Wrench } from 'lucide-react';
import { useIntegrations } from '../../hooks/useIntegrations';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { fetchCatalog, fetchTemplate, clearCatalogCache } from '../../lib/integration-catalog';
import { shareIntegrationTemplate, fetchTeamTemplates, deleteTeamTemplate } from '../../lib/server-api';
import { IntegrationBuilder } from './IntegrationBuilder';
import type { IntegrationTemplate, InstalledIntegration, IntegrationRun, IntegrationConfigField, IntegrationCategory, CatalogEntry } from '../../types/integration-types';

type SubTab = 'installed' | 'catalog' | 'history';

const CATEGORY_COLORS: Record<IntegrationCategory, string> = {
  enrichment: '#3b82f6',
  'threat-feed': '#f59e0b',
  'siem-soar': '#8b5cf6',
  notification: '#10b981',
  export: '#6366f1',
  pipeline: '#ec4899',
  utility: '#6b7280',
};

const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  enrichment: 'Enrichment',
  'threat-feed': 'Threat Feed',
  'siem-soar': 'SIEM/SOAR',
  notification: 'Notification',
  export: 'Export',
  pipeline: 'Pipeline',
  utility: 'Utility',
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

function CategoryBadge({ category }: { category: IntegrationCategory }) {
  const color = CATEGORY_COLORS[category] || '#6b7280';
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium border"
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}15` }}
    >
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

function TemplateIcon({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0"
      style={{ backgroundColor: color || '#6b7280' }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/** Compare semver strings (a < b => negative, a > b => positive, equal => 0) */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Export a template as a clean JSON file (strips runtime/config data). */
function exportTemplateAsJson(template: IntegrationTemplate): void {
  const clean: Record<string, unknown> = {
    id: template.id,
    schemaVersion: template.schemaVersion,
    version: template.version,
    name: template.name,
    description: template.description,
    author: template.author,
    license: template.license,
    icon: template.icon,
    color: template.color,
    category: template.category,
    tags: template.tags,
    triggers: template.triggers,
    configSchema: template.configSchema,
    steps: template.steps,
    outputs: template.outputs,
    rateLimit: template.rateLimit,
    requiredDomains: template.requiredDomains,
    minVersion: template.minVersion,
    source: 'community',
  };

  const json = JSON.stringify(clean, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${template.name.toLowerCase().replace(/\s+/g, '-')}-integration.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Config Form ---

function ConfigForm({
  fields,
  values,
  onSave,
  onCancel,
}: {
  fields: IntegrationConfigField[];
  values: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      initial[field.key] = values[field.key] ?? field.default ?? '';
    }
    return initial;
  });
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const updateField = (key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="border border-gray-700 rounded-lg p-3 space-y-3 bg-gray-800/50 mt-2">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1">
          <label className="text-xs text-gray-400">
            {field.label}
            {field.required && <span className="text-red-400 ml-0.5">*</span>}
          </label>
          {field.description && (
            <p className="text-[10px] text-gray-600">{field.description}</p>
          )}

          {field.type === 'boolean' ? (
            <button
              onClick={() => updateField(field.key, !formValues[field.key])}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                formValues[field.key] ? 'bg-accent' : 'bg-gray-600'
              }`}
              role="switch"
              aria-checked={!!formValues[field.key]}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  formValues[field.key] ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          ) : field.type === 'select' || field.type === 'multi-select' ? (
            <select
              value={String(formValues[field.key] || '')}
              onChange={(e) => updateField(field.key, e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
            >
              <option value="">Select...</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : field.type === 'password' ? (
            <div className="relative">
              <input
                type={showPasswords[field.key] ? 'text' : 'password'}
                value={String(formValues[field.key] || '')}
                onChange={(e) => updateField(field.key, e.target.value)}
                placeholder={field.placeholder}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent pr-16"
              />
              <button
                type="button"
                onClick={() =>
                  setShowPasswords((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 hover:text-gray-300"
              >
                {showPasswords[field.key] ? 'Hide' : 'Show'}
              </button>
            </div>
          ) : field.type === 'number' ? (
            <input
              type="number"
              value={String(formValues[field.key] || '')}
              onChange={(e) => updateField(field.key, e.target.value ? Number(e.target.value) : '')}
              placeholder={field.placeholder}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
          ) : (
            <input
              type="text"
              value={String(formValues[field.key] || '')}
              onChange={(e) => updateField(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onSave(formValues)}
          className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-gray-400 text-xs font-medium hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Installed Tab ---

function InstalledTab({
  installations,
  templates,
  onToggle,
  onConfigure,
  onDelete,
  onInstall,
  onExport,
  onShareWithTeam,
  isTeamConnected,
}: {
  installations: InstalledIntegration[];
  templates: IntegrationTemplate[];
  onToggle: (id: string, enabled: boolean) => void;
  onConfigure: (id: string, config: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onInstall: (templateId: string) => void;
  onExport: (template: IntegrationTemplate) => void;
  onShareWithTeam: (template: IntegrationTemplate) => void;
  isTeamConnected: boolean;
}) {
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  const installedTemplateIds = new Set(installations.map((i) => i.templateId));
  const availableTemplates = templates.filter((t) => !installedTemplateIds.has(t.id));

  return (
    <div className="space-y-6">
      {/* Installed list */}
      {installations.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">No integrations installed. Browse the catalog to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {installations.map((inst) => {
            const template = templates.find((t) => t.id === inst.templateId);
            const isConfiguring = configuringId === inst.id;
            const isUserCreated = template?.source === 'user' || template?.source === 'community' || template?.source === 'team';

            return (
              <div key={inst.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <TemplateIcon
                    name={template?.name || inst.name}
                    color={template?.color || '#6b7280'}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200 truncate">
                        {template?.name || inst.name}
                      </span>
                      {template && <CategoryBadge category={template.category} />}
                    </div>
                    {inst.lastRunAt && (
                      <p className="text-[10px] text-gray-600 mt-0.5">
                        Last run {formatRelativeTime(inst.lastRunAt)}
                        {inst.runCount > 0 && ` \u00b7 ${inst.runCount} runs`}
                        {inst.errorCount > 0 && (
                          <span className="text-red-400"> \u00b7 {inst.errorCount} errors</span>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => onToggle(inst.id, !inst.enabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                      inst.enabled ? 'bg-accent' : 'bg-gray-600'
                    }`}
                    role="switch"
                    aria-checked={inst.enabled}
                    title={inst.enabled ? 'Disable' : 'Enable'}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                        inst.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </button>

                  {/* Configure */}
                  <button
                    onClick={() => setConfiguringId(isConfiguring ? null : inst.id)}
                    className={`p-1.5 rounded hover:bg-gray-700 transition-colors ${
                      isConfiguring ? 'text-accent' : 'text-gray-500 hover:text-gray-300'
                    }`}
                    title="Configure"
                  >
                    <Settings2 size={14} />
                  </button>

                  {/* Export (user-created templates only) */}
                  {isUserCreated && template && (
                    <button
                      onClick={() => onExport(template)}
                      className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
                      title="Export"
                    >
                      <Download size={14} />
                    </button>
                  )}

                  {/* Share with Team (user-created + connected) */}
                  {isUserCreated && template && isTeamConnected && (
                    <button
                      onClick={() => onShareWithTeam(template)}
                      className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-blue-400 transition-colors"
                      title="Share with Team"
                    >
                      <Share2 size={14} />
                    </button>
                  )}

                  {/* Delete */}
                  <button
                    onClick={() => onDelete(inst.id)}
                    className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Inline config form */}
                {isConfiguring && template && (
                  <ConfigForm
                    fields={template.configSchema}
                    values={inst.config}
                    onSave={(config) => {
                      onConfigure(inst.id, config);
                      setConfiguringId(null);
                    }}
                    onCancel={() => setConfiguringId(null)}
                  />
                )}
                {isConfiguring && template && template.configSchema.length === 0 && (
                  <p className="text-xs text-gray-500 mt-2 italic">
                    This integration has no configurable options.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Available integrations */}
      {availableTemplates.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Available Integrations
          </h4>
          <div className="space-y-2">
            {availableTemplates.map((template) => (
              <div
                key={template.id}
                className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center gap-3"
              >
                <TemplateIcon name={template.name} color={template.color} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200 truncate">
                      {template.name}
                    </span>
                    <CategoryBadge category={template.category} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                    {template.description}
                  </p>
                </div>
                <button
                  onClick={() => onInstall(template.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors shrink-0"
                >
                  <Plus size={12} />
                  Install
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Catalog Tab ---

function CatalogTab({
  templates,
  installedTemplateIds,
  onInstall,
  onImportJson,
  onInstallCommunityEntry,
  catalogEntries,
  catalogLoading,
  catalogError,
  onRefreshCatalog,
  teamTemplates,
  teamLoading,
  isTeamConnected,
  onInstallTeamTemplate,
  onDeleteTeamTemplate,
}: {
  templates: IntegrationTemplate[];
  installedTemplateIds: Set<string>;
  onInstall: (templateId: string) => void;
  onImportJson: (json: string) => void;
  onInstallCommunityEntry: (entry: CatalogEntry) => void;
  catalogEntries: CatalogEntry[];
  catalogLoading: boolean;
  catalogError: string | null;
  onRefreshCatalog: () => void;
  teamTemplates: IntegrationTemplate[];
  teamLoading: boolean;
  isTeamConnected: boolean;
  onInstallTeamTemplate: (template: IntegrationTemplate) => void;
  onDeleteTeamTemplate: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pasteJson, setPasteJson] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [installingEntryId, setInstallingEntryId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Group builtin templates by category
  const categories = Array.from(new Set(templates.map((t) => t.category)));
  const filtered = searchQuery
    ? templates.filter(
        (t) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : templates;

  const grouped = categories
    .map((cat) => ({
      category: cat,
      templates: filtered.filter((t) => t.category === cat),
    }))
    .filter((g) => g.templates.length > 0);

  // Filter community entries by search
  const filteredCommunity = searchQuery
    ? catalogEntries.filter(
        (e) =>
          e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : catalogEntries;

  // Group community entries by category
  const communityCategories = Array.from(new Set(filteredCommunity.map((e) => e.category)));
  const communityGrouped = communityCategories
    .map((cat) => ({
      category: cat,
      entries: filteredCommunity.filter((e) => e.category === cat),
    }))
    .filter((g) => g.entries.length > 0);

  // Filter team templates by search
  const filteredTeam = searchQuery
    ? teamTemplates.filter(
        (t) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : teamTemplates;

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onImportJson(reader.result as string);
        setImportError(null);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Invalid JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handlePasteImport = () => {
    if (!pasteJson.trim()) return;
    try {
      onImportJson(pasteJson);
      setPasteJson('');
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleInstallCommunityEntry = async (entry: CatalogEntry) => {
    setInstallingEntryId(entry.id);
    try {
      onInstallCommunityEntry(entry);
    } finally {
      setInstallingEntryId(null);
    }
  };

  /** Check if a community entry has an update available vs installed version */
  const getUpdateStatus = (entryId: string, entryVersion: string): 'installed' | 'update-available' | 'not-installed' => {
    if (!installedTemplateIds.has(entryId)) return 'not-installed';
    const installedTemplate = templates.find((t) => t.id === entryId);
    if (installedTemplate && compareSemver(installedTemplate.version, entryVersion) < 0) {
      return 'update-available';
    }
    return 'installed';
  };

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search integrations..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
        />
      </div>

      {/* Builtin template groups */}
      {grouped.map(({ category, templates: catTemplates }) => (
        <div key={category} className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: CATEGORY_COLORS[category] }}
            />
            {CATEGORY_LABELS[category]}
          </h4>

          {catTemplates.map((template) => {
            const isInstalled = installedTemplateIds.has(template.id);
            const isExpanded = expandedId === template.id;

            return (
              <div
                key={template.id}
                className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2"
              >
                <div className="flex items-start gap-3">
                  <TemplateIcon name={template.name} color={template.color} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-200">
                        {template.name}
                      </span>
                      <span className="text-[10px] text-gray-600">v{template.version}</span>
                      <span className="text-[10px] text-gray-600">by {template.author}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>

                    {/* Tags */}
                    {template.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {template.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-gray-700/50 text-gray-400 border border-gray-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Required domains */}
                    {template.requiredDomains.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {template.requiredDomains.map((domain) => (
                          <span
                            key={domain}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1"
                          >
                            <ExternalLink size={8} />
                            {domain}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isInstalled ? (
                      <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-green-400 bg-green-500/10 border border-green-500/20">
                        <Check size={12} />
                        Installed
                      </span>
                    ) : (
                      <button
                        onClick={() => onInstall(template.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
                      >
                        <Plus size={12} />
                        Install
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : template.id)}
                      className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors whitespace-nowrap"
                    >
                      {isExpanded ? 'Hide JSON' : 'View JSON'}
                    </button>
                  </div>
                </div>

                {/* Raw JSON */}
                {isExpanded && (
                  <pre className="bg-gray-900 border border-gray-700 rounded p-2 text-[10px] text-gray-400 overflow-x-auto max-h-60 overflow-y-auto font-mono">
                    {JSON.stringify(template, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {filtered.length === 0 && searchQuery && !catalogLoading && filteredCommunity.length === 0 && filteredTeam.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">No templates match your search.</p>
      )}

      {/* Team Templates Section */}
      {isTeamConnected && (
        <div className="border-t border-gray-700 pt-4 space-y-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Users size={12} />
            Team Templates
          </h4>

          {teamLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 size={14} className="animate-spin text-gray-500" />
              <span className="text-xs text-gray-500">Loading team templates...</span>
            </div>
          ) : filteredTeam.length === 0 ? (
            <p className="text-xs text-gray-500 py-2">
              No team templates shared yet. Share your custom templates from the Installed tab.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredTeam.map((template) => {
                const isInstalled = installedTemplateIds.has(template.id);

                return (
                  <div
                    key={template.id}
                    className="bg-gray-800 border border-gray-700 rounded-lg p-3"
                  >
                    <div className="flex items-start gap-3">
                      <TemplateIcon name={template.name} color={template.color} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-200">
                            {template.name}
                          </span>
                          <span className="text-[10px] text-gray-600">v{template.version}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            shared by {template.author}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>
                        {template.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {template.tags.map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-gray-700/50 text-gray-400 border border-gray-700"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isInstalled ? (
                          <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-green-400 bg-green-500/10 border border-green-500/20">
                            <Check size={12} />
                            Installed
                          </span>
                        ) : (
                          <button
                            onClick={() => onInstallTeamTemplate(template)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
                          >
                            <Plus size={12} />
                            Install
                          </button>
                        )}
                        <button
                          onClick={() => onDeleteTeamTemplate(template.id)}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-colors"
                          title="Remove from team"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Community Catalog Section */}
      <div className="border-t border-gray-700 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Globe2 size={12} />
            Community Catalog
          </h4>
          <button
            onClick={onRefreshCatalog}
            disabled={catalogLoading}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-40"
            title="Refresh catalog"
          >
            <RefreshCw size={10} className={catalogLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {catalogLoading && catalogEntries.length === 0 ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 size={14} className="animate-spin text-gray-500" />
            <span className="text-xs text-gray-500">Loading community catalog...</span>
          </div>
        ) : catalogError ? (
          <div className="flex items-center gap-2 text-xs text-red-400 py-2">
            <AlertCircle size={12} />
            {catalogError}
          </div>
        ) : filteredCommunity.length === 0 && !catalogLoading ? (
          <p className="text-xs text-gray-500 py-2">
            {searchQuery ? 'No community templates match your search.' : 'No community templates available yet.'}
          </p>
        ) : (
          communityGrouped.map(({ category, entries }) => (
            <div key={`community-${category}`} className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[category] || '#6b7280' }}
                />
                {CATEGORY_LABELS[category] || category}
              </h4>

              {entries.map((entry) => {
                const updateStatus = getUpdateStatus(entry.id, entry.version);
                const isInstalling = installingEntryId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className="bg-gray-800 border border-gray-700 rounded-lg p-3"
                  >
                    <div className="flex items-start gap-3">
                      <TemplateIcon name={entry.name} color={entry.color} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-200">
                            {entry.name}
                          </span>
                          <span className="text-[10px] text-gray-600">v{entry.version}</span>
                          <span className="text-[10px] text-gray-600">by {entry.author}</span>
                          {entry.downloads > 0 && (
                            <span className="text-[10px] text-gray-600 flex items-center gap-0.5">
                              <Download size={8} />
                              {entry.downloads.toLocaleString()}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{entry.description}</p>
                        {entry.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {entry.tags.map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-gray-700/50 text-gray-400 border border-gray-700"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {updateStatus === 'installed' ? (
                          <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-green-400 bg-green-500/10 border border-green-500/20">
                            <Check size={12} />
                            Installed
                          </span>
                        ) : updateStatus === 'update-available' ? (
                          <button
                            onClick={() => handleInstallCommunityEntry(entry)}
                            disabled={isInstalling}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-xs font-medium hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
                          >
                            {isInstalling ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpCircle size={12} />}
                            Update
                          </button>
                        ) : (
                          <button
                            onClick={() => handleInstallCommunityEntry(entry)}
                            disabled={isInstalling}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                          >
                            {isInstalling ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            Install
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Import section */}
      <div className="border-t border-gray-700 pt-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Import Custom Template
        </h4>

        <input
          ref={fileRef}
          type="file"
          accept=".json"
          onChange={handleFileImport}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium transition-colors"
        >
          <Upload size={14} />
          Import JSON File
        </button>

        <div className="space-y-2">
          <textarea
            value={pasteJson}
            onChange={(e) => setPasteJson(e.target.value)}
            placeholder="Or paste template JSON here..."
            rows={4}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent font-mono resize-y"
          />
          <button
            onClick={handlePasteImport}
            disabled={!pasteJson.trim()}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import from Paste
          </button>
        </div>

        {importError && (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle size={12} />
            {importError}
          </div>
        )}
      </div>
    </div>
  );
}

// --- History Tab ---

function HistoryTab({
  runs,
  templates,
  installations,
}: {
  runs: IntegrationRun[];
  templates: IntegrationTemplate[];
  installations: InstalledIntegration[];
}) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-500">No integration runs yet.</p>
      </div>
    );
  }

  const getIntegrationName = (run: IntegrationRun): string => {
    const installation = installations.find((i) => i.id === run.integrationId);
    const template = templates.find((t) => t.id === run.templateId);
    return template?.name || installation?.name || 'Unknown Integration';
  };

  const statusIcon = (status: IntegrationRun['status']) => {
    switch (status) {
      case 'success':
        return <Check size={14} className="text-green-400" />;
      case 'error':
      case 'timeout':
      case 'cancelled':
        return <AlertCircle size={14} className="text-red-400" />;
      case 'running':
        return <Clock size={14} className="text-yellow-400 animate-pulse" />;
      default:
        return <Clock size={14} className="text-gray-500" />;
    }
  };

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const isExpanded = expandedRunId === run.id;

        return (
          <div key={run.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
            <button
              onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
              className="flex items-center gap-3 w-full text-left"
            >
              {statusIcon(run.status)}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-200 truncate block">
                  {getIntegrationName(run)}
                </span>
                <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-0.5">
                  <span>{formatDuration(run.durationMs)}</span>
                  <span>{run.apiCallsMade} API call{run.apiCallsMade !== 1 ? 's' : ''}</span>
                  {(run.entitiesCreated > 0 || run.entitiesUpdated > 0) && (
                    <span>
                      {run.entitiesCreated > 0 && `${run.entitiesCreated} created`}
                      {run.entitiesCreated > 0 && run.entitiesUpdated > 0 && ', '}
                      {run.entitiesUpdated > 0 && `${run.entitiesUpdated} updated`}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-[10px] text-gray-600 shrink-0">
                {formatRelativeTime(run.createdAt)}
              </span>
            </button>

            {/* Error message */}
            {run.error && (
              <p className="text-xs text-red-400 mt-2 flex items-start gap-1.5">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {run.error}
              </p>
            )}

            {/* Expanded step log */}
            {isExpanded && run.log.length > 0 && (
              <div className="mt-3 border-t border-gray-700 pt-2 space-y-1">
                {run.log.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-[10px] font-mono"
                  >
                    <span className="text-gray-600 shrink-0 w-16 text-right">
                      {entry.durationMs != null ? formatDuration(entry.durationMs) : ''}
                    </span>
                    <span
                      className={
                        entry.type === 'step-error'
                          ? 'text-red-400'
                          : entry.type === 'step-complete'
                            ? 'text-green-400'
                            : entry.type === 'entity-created'
                              ? 'text-blue-400'
                              : 'text-gray-400'
                      }
                    >
                      [{entry.type}]
                    </span>
                    <span className="text-gray-300">{entry.stepLabel}</span>
                    {entry.detail && (
                      <span className="text-gray-600 truncate">{entry.detail}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {isExpanded && run.log.length === 0 && (
              <p className="text-[10px] text-gray-600 mt-2 italic">No step log recorded.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Main Panel ---

export function IntegrationPanel() {
  const {
    templates,
    installations,
    runs,
    importTemplate,
    installTemplate,
    createInstallation,
    updateInstallation,
    deleteInstallation,
    loading,
  } = useIntegrations();

  const { connected: isTeamConnected } = useAuth();
  const { addToast } = useToast();

  const [activeSubTab, setActiveSubTab] = useState<SubTab>('installed');
  const [showBuilder, setShowBuilder] = useState(false);
  const [catalogEntries, setCatalogEntries] = useState<CatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [teamTemplates, setTeamTemplates] = useState<IntegrationTemplate[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  const installedTemplateIds = new Set(installations.map((i) => i.templateId));

  // Fetch community catalog on mount
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const entries = await fetchCatalog();
      setCatalogEntries(entries);
    } catch {
      setCatalogError('Could not load community catalog. Check your network connection.');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  // Fetch team templates
  const loadTeamTemplates = useCallback(async () => {
    if (!isTeamConnected) return;
    setTeamLoading(true);
    try {
      const raw = await fetchTeamTemplates();
      setTeamTemplates(raw as IntegrationTemplate[]);
    } catch {
      // Silently fail for team templates
    } finally {
      setTeamLoading(false);
    }
  }, [isTeamConnected]);

  useEffect(() => {
    void loadCatalog();
    void loadTeamTemplates();
  }, [loadCatalog, loadTeamTemplates]);

  const handleRefreshCatalog = () => {
    clearCatalogCache();
    void loadCatalog();
  };

  const handleInstall = async (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    await createInstallation(templateId, {});
    if (template && template.configSchema.length > 0) {
      setActiveSubTab('installed');
    }
  };

  const handleImportJson = async (json: string) => {
    await importTemplate(json);
  };

  const handleInstallCommunityEntry = async (entry: CatalogEntry) => {
    try {
      const template = await fetchTemplate(entry);
      template.source = 'community';
      await installTemplate(template);
      await createInstallation(template.id, {});
      addToast('success', `Installed ${entry.name} from community catalog`);
      if (template.configSchema.length > 0) {
        setActiveSubTab('installed');
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to install community template');
    }
  };

  const handleExport = (template: IntegrationTemplate) => {
    exportTemplateAsJson(template);
    addToast('success', `Exported ${template.name}`);
  };

  const handleShareWithTeam = async (template: IntegrationTemplate) => {
    try {
      await shareIntegrationTemplate(template);
      addToast('success', 'Template shared with team');
      void loadTeamTemplates();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to share template');
    }
  };

  const handleInstallTeamTemplate = async (template: IntegrationTemplate) => {
    try {
      const teamTemplate = { ...template, source: 'team' as const };
      await installTemplate(teamTemplate);
      await createInstallation(teamTemplate.id, {});
      addToast('success', `Installed ${template.name} from team`);
      if (template.configSchema.length > 0) {
        setActiveSubTab('installed');
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to install team template');
    }
  };

  const handleDeleteTeamTemplate = async (id: string) => {
    try {
      await deleteTeamTemplate(id);
      setTeamTemplates((prev) => prev.filter((t) => t.id !== id));
      addToast('success', 'Template removed from team');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to delete team template');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Power size={16} />
          Integrations
        </h3>
        <p className="text-sm text-gray-500">Loading integrations...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Power size={16} />
          Integrations
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Connect to threat intelligence feeds, enrichment APIs, and export pipelines.
        </p>
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-gray-700 pb-px">
        {(
          [
            { key: 'installed', label: 'Installed', count: installations.length },
            { key: 'catalog', label: 'Catalog', count: templates.length },
            { key: 'history', label: 'History', count: runs.length },
          ] as { key: SubTab; label: string; count: number }[]
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
              activeSubTab === tab.key
                ? 'text-accent border-b-2 border-accent'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 text-[10px] text-gray-600">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeSubTab === 'installed' && (
        <InstalledTab
          installations={installations}
          templates={templates}
          onToggle={(id, enabled) => updateInstallation(id, { enabled })}
          onConfigure={(id, config) => updateInstallation(id, { config })}
          onDelete={deleteInstallation}
          onInstall={handleInstall}
          onExport={handleExport}
          onShareWithTeam={handleShareWithTeam}
          isTeamConnected={isTeamConnected}
        />
      )}

      {activeSubTab === 'catalog' && (
        showBuilder ? (
          <IntegrationBuilder onBack={() => setShowBuilder(false)} />
        ) : (
          <>
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setShowBuilder(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs font-medium hover:bg-gray-600 transition-colors"
              >
                <Wrench size={12} />
                Create Custom
              </button>
            </div>
            <CatalogTab
              templates={templates}
              installedTemplateIds={installedTemplateIds}
              onInstall={handleInstall}
              onImportJson={handleImportJson}
              onInstallCommunityEntry={handleInstallCommunityEntry}
              catalogEntries={catalogEntries}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              onRefreshCatalog={handleRefreshCatalog}
              teamTemplates={teamTemplates}
              teamLoading={teamLoading}
              isTeamConnected={isTeamConnected}
              onInstallTeamTemplate={handleInstallTeamTemplate}
              onDeleteTeamTemplate={handleDeleteTeamTemplate}
            />
          </>
        )
      )}

      {activeSubTab === 'history' && (
        <HistoryTab
          runs={runs}
          templates={templates}
          installations={installations}
        />
      )}
    </div>
  );
}
