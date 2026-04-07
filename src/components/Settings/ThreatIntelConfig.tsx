import { useState, useRef } from 'react';
import { Upload, Download, X, FileJson, Users, ChevronDown, ChevronRight, RotateCcw, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../hooks/useSettings';
import { useToast } from '../../contexts/ToastContext';
import type { IOCType, IOCRelationshipDef, ConfidenceLevel } from '../../types';
import { IOC_TYPE_LABELS, DEFAULT_IOC_SUBTYPES, DEFAULT_RELATIONSHIP_TYPES, CONFIDENCE_LEVELS } from '../../types';
import { getEffectiveClsLevels } from '../../lib/classification';
import { downloadFile } from '../../lib/export';

const ALL_IOC_TYPES = Object.keys(IOC_TYPE_LABELS) as IOCType[];

interface ConfigCategory {
  key: 'tiClsLevels' | 'tiIocStatuses';
  labelKey: string;
}

const SIMPLE_CATEGORIES: ConfigCategory[] = [
  { key: 'tiClsLevels', labelKey: 'intel.clsLevels' },
  { key: 'tiIocStatuses', labelKey: 'intel.iocStatuses' },
];

const BULK_KEY_MAP: Record<string, 'tiClsLevels' | 'tiIocStatuses' | 'attributionActors' | 'tiIocSubtypes' | 'tiRelationshipTypes' | 'tiDefaultClsLevel' | 'tiDefaultReportSource' | 'ociLabel' | 'tiAutoExtractEnabled' | 'tiAutoExtractDebounceMs' | 'tiEnabledIOCTypes' | 'tiDefaultConfidence'> = {
  cls_levels: 'tiClsLevels',
  ioc_subtypes: 'tiIocSubtypes',
  relationship_types: 'tiRelationshipTypes',
  ioc_statuses: 'tiIocStatuses',
  attribution_actors: 'attributionActors',
  default_cls_level: 'tiDefaultClsLevel',
  default_report_source: 'tiDefaultReportSource',
  oci_label: 'ociLabel',
  auto_extract_enabled: 'tiAutoExtractEnabled',
  auto_extract_debounce_ms: 'tiAutoExtractDebounceMs',
  enabled_ioc_types: 'tiEnabledIOCTypes',
  default_confidence: 'tiDefaultConfidence',
};

const DEBOUNCE_OPTIONS = [
  { label: '1s', value: 1000 },
  { label: '2s', value: 2000 },
  { label: '3s', value: 3000 },
  { label: '5s', value: 5000 },
];

const ALL_CONFIDENCE_LEVELS = Object.keys(CONFIDENCE_LEVELS) as ConfidenceLevel[];

export function ThreatIntelConfig() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { settings, updateSettings } = useSettings();
  const { addToast } = useToast();
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const bulkRef = useRef<HTMLInputElement>(null);
  const actorsRef = useRef<HTMLInputElement>(null);

  const actors = settings.attributionActors ?? [];

  const getSimpleValues = (key: ConfigCategory['key']): string[] => (settings[key] as string[] | undefined) ?? [];

  // Per-type subtypes
  const [expandedSubtypeType, setExpandedSubtypeType] = useState<IOCType | null>(null);
  const [newSubtypeInput, setNewSubtypeInput] = useState('');

  // Relationship types
  const [showRelTypes, setShowRelTypes] = useState(false);
  const [addingRelType, setAddingRelType] = useState(false);
  const [newRelKey, setNewRelKey] = useState('');
  const [newRelLabel, setNewRelLabel] = useState('');
  const [newRelSource, setNewRelSource] = useState<IOCType[]>([]);
  const [newRelTarget, setNewRelTarget] = useState<IOCType[]>([]);

  const getSubtypesForType = (type: IOCType): { defaults: string[]; custom: string[] } => {
    const defaults = DEFAULT_IOC_SUBTYPES[type] || [];
    const custom = (settings.tiIocSubtypes as Record<string, string[]> | undefined)?.[type] || [];
    return { defaults, custom };
  };

  const addCustomSubtype = (type: IOCType) => {
    const val = newSubtypeInput.trim();
    if (!val) return;
    const current = (settings.tiIocSubtypes as Record<string, string[]> | undefined) || {};
    const existing = current[type] || [];
    if (existing.includes(val) || (DEFAULT_IOC_SUBTYPES[type] || []).includes(val)) return;
    updateSettings({ tiIocSubtypes: { ...current, [type]: [...existing, val] } });
    setNewSubtypeInput('');
  };

  const removeCustomSubtype = (type: IOCType, val: string) => {
    const current = (settings.tiIocSubtypes as Record<string, string[]> | undefined) || {};
    const existing = current[type] || [];
    updateSettings({ tiIocSubtypes: { ...current, [type]: existing.filter((v) => v !== val) } });
  };

  const resetSubtypesForType = (type: IOCType) => {
    const current = (settings.tiIocSubtypes as Record<string, string[]> | undefined) || {};
    const next = { ...current };
    delete next[type];
    updateSettings({ tiIocSubtypes: Object.keys(next).length > 0 ? next : undefined });
  };

  // Relationship type management
  const customRelTypes = (settings.tiRelationshipTypes as Record<string, IOCRelationshipDef> | undefined) || {};

  const addCustomRelType = () => {
    const key = newRelKey.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const label = newRelLabel.trim();
    if (!key || !label) return;
    if (DEFAULT_RELATIONSHIP_TYPES[key] || customRelTypes[key]) return;
    updateSettings({ tiRelationshipTypes: { ...customRelTypes, [key]: { label, sourceTypes: newRelSource, targetTypes: newRelTarget } } });
    setNewRelKey('');
    setNewRelLabel('');
    setNewRelSource([]);
    setNewRelTarget([]);
    setAddingRelType(false);
  };

  const removeCustomRelType = (key: string) => {
    const next = { ...customRelTypes };
    delete next[key];
    updateSettings({ tiRelationshipTypes: Object.keys(next).length > 0 ? next : undefined });
  };

  const handleCSVImport = (key: ConfigCategory['key'], e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = text.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.length > 0);
      const current = getSimpleValues(key);
      const unique = [...new Set([...current, ...parsed])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
      updateSettings({ [key]: unique });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleActorsImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = text.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.length > 0);
      const unique = [...new Set([...actors, ...parsed])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
      updateSettings({ attributionActors: unique });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleBulkImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        const updates: Record<string, unknown> = {};
        for (const [jsonKey, settingsKey] of Object.entries(BULK_KEY_MAP)) {
          if (settingsKey === 'tiIocSubtypes' && data[jsonKey] && typeof data[jsonKey] === 'object' && !Array.isArray(data[jsonKey])) {
            // New format: { "ipv4": [...], "domain": [...] }
            const current = (settings.tiIocSubtypes as Record<string, string[]> | undefined) || {};
            const merged = { ...current };
            for (const [type, vals] of Object.entries(data[jsonKey])) {
              if (Array.isArray(vals)) {
                const existing = merged[type] || [];
                merged[type] = [...new Set([...existing, ...(vals as string[])])];
              }
            }
            updates[settingsKey] = merged;
          } else if (settingsKey === 'tiRelationshipTypes' && data[jsonKey] && typeof data[jsonKey] === 'object' && !Array.isArray(data[jsonKey])) {
            updates[settingsKey] = { ...customRelTypes, ...data[jsonKey] };
          } else if (typeof data[jsonKey] === 'string' && (settingsKey === 'tiDefaultClsLevel' || settingsKey === 'tiDefaultReportSource' || settingsKey === 'ociLabel' || settingsKey === 'tiDefaultConfidence')) {
            updates[settingsKey] = data[jsonKey] || undefined;
          } else if (settingsKey === 'tiAutoExtractEnabled' && typeof data[jsonKey] === 'boolean') {
            updates[settingsKey] = data[jsonKey];
          } else if (settingsKey === 'tiAutoExtractDebounceMs' && typeof data[jsonKey] === 'number') {
            updates[settingsKey] = data[jsonKey];
          } else if (settingsKey === 'tiEnabledIOCTypes' && Array.isArray(data[jsonKey])) {
            updates[settingsKey] = (data[jsonKey] as unknown[]).map(String).filter((s) => s.length > 0);
          } else if (Array.isArray(data[jsonKey])) {
            const parsed = (data[jsonKey] as unknown[]).map(String).filter((s) => s.length > 0);
            if (settingsKey === 'attributionActors') {
              const current = actors;
              updates[settingsKey] = [...new Set([...current, ...parsed])].sort((a, b) =>
                a.localeCompare(b, undefined, { sensitivity: 'base' })
              );
            } else if (settingsKey === 'tiClsLevels' || settingsKey === 'tiIocStatuses') {
              const current = getSimpleValues(settingsKey);
              updates[settingsKey] = [...new Set([...current, ...parsed])].sort((a, b) =>
                a.localeCompare(b, undefined, { sensitivity: 'base' })
              );
            }
          }
        }
        if (Object.keys(updates).length > 0) {
          updateSettings(updates);
          addToast('success', t('intel.configImported'));
        }
      } catch {
        addToast('error', t('intel.invalidConfigFile'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfigExport = () => {
    const config: Record<string, unknown> = {};
    const clsLevels = getSimpleValues('tiClsLevels');
    if (clsLevels.length > 0) config.cls_levels = clsLevels;
    const iocStatuses = getSimpleValues('tiIocStatuses');
    if (iocStatuses.length > 0) config.ioc_statuses = iocStatuses;
    if (actors.length > 0) config.attribution_actors = actors;
    const subtypes = settings.tiIocSubtypes as Record<string, string[]> | undefined;
    if (subtypes && Object.keys(subtypes).length > 0) config.ioc_subtypes = subtypes;
    if (customRelTypes && Object.keys(customRelTypes).length > 0) config.relationship_types = customRelTypes;
    if (settings.tiDefaultClsLevel) config.default_cls_level = settings.tiDefaultClsLevel;
    if (settings.tiDefaultReportSource) config.default_report_source = settings.tiDefaultReportSource;
    if (settings.ociLabel) config.oci_label = settings.ociLabel;
    if (settings.tiAutoExtractEnabled !== undefined) config.auto_extract_enabled = settings.tiAutoExtractEnabled;
    if (settings.tiAutoExtractDebounceMs !== undefined) config.auto_extract_debounce_ms = settings.tiAutoExtractDebounceMs;
    if (settings.tiEnabledIOCTypes) config.enabled_ioc_types = settings.tiEnabledIOCTypes;
    if (settings.tiDefaultConfidence) config.default_confidence = settings.tiDefaultConfidence;
    downloadFile(JSON.stringify(config, null, 2), 'threatcaddy-config.json', 'application/json');
  };

  const toggleTypeInList = (list: IOCType[], type: IOCType): IOCType[] =>
    list.includes(type) ? list.filter((t) => t !== type) : [...list, type];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <Search size={16} />
        {t('intel.title')}
      </h3>

      {/* Extraction Behavior */}
      <div className="space-y-3">
        <span className="text-xs font-medium text-gray-400">{t('intel.extractionBehavior')}</span>

        {/* Auto-Extraction Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm text-gray-300">{t('intel.autoExtract')}</label>
            <p className="text-[10px] text-gray-600">{t('intel.autoExtractDesc')}</p>
          </div>
          <button
            onClick={() => updateSettings({ tiAutoExtractEnabled: !(settings.tiAutoExtractEnabled !== false) })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${settings.tiAutoExtractEnabled !== false ? 'bg-accent' : 'bg-gray-600'}`}
            role="switch"
            aria-checked={settings.tiAutoExtractEnabled !== false}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${settings.tiAutoExtractEnabled !== false ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>

        {/* Default Confidence Level */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm text-gray-400">{t('intel.defaultConfidence')}</label>
            <p className="text-[10px] text-gray-600">{t('intel.defaultConfidenceDesc')}</p>
          </div>
          <select
            value={settings.tiDefaultConfidence || 'medium'}
            onChange={(e) => updateSettings({ tiDefaultConfidence: e.target.value === 'medium' ? undefined : e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
          >
            {ALL_CONFIDENCE_LEVELS.map((c) => (
              <option key={c} value={c}>{CONFIDENCE_LEVELS[c].label}</option>
            ))}
          </select>
        </div>

        {/* Extraction Delay */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm text-gray-400">{t('intel.extractionDelay')}</label>
            <p className="text-[10px] text-gray-600">{t('intel.extractionDelayDesc')}</p>
          </div>
          <select
            value={settings.tiAutoExtractDebounceMs ?? 2000}
            onChange={(e) => {
              const val = Number(e.target.value);
              updateSettings({ tiAutoExtractDebounceMs: val === 2000 ? undefined : val });
            }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
          >
            {DEBOUNCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* IOC Type Toggles */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-400">{t('intel.enabledIocTypes')}</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateSettings({ tiEnabledIOCTypes: undefined })}
                className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-300"
              >
                {t('intel.enableAll')}
              </button>
              <button
                onClick={() => updateSettings({ tiEnabledIOCTypes: [] })}
                className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-300"
              >
                {t('intel.disableAll')}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ALL_IOC_TYPES.map((type) => {
              const { label, color } = IOC_TYPE_LABELS[type];
              const enabledTypes = settings.tiEnabledIOCTypes;
              const isEnabled = !enabledTypes || enabledTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => {
                    if (!enabledTypes) {
                      // Currently all enabled, switch to all-except-this
                      updateSettings({ tiEnabledIOCTypes: ALL_IOC_TYPES.filter((t) => t !== type) });
                    } else if (isEnabled) {
                      const next = enabledTypes.filter((t) => t !== type);
                      updateSettings({ tiEnabledIOCTypes: next.length === 0 ? [] : next });
                    } else {
                      const next = [...enabledTypes, type];
                      // If all types are now enabled, reset to undefined
                      updateSettings({ tiEnabledIOCTypes: next.length === ALL_IOC_TYPES.length ? undefined : next });
                    }
                  }}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${isEnabled ? 'border-accent/40 bg-accent/10' : 'border-gray-700 bg-gray-800 opacity-50'}`}
                  style={isEnabled ? { color } : { color: '#6b7280' }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <hr className="border-gray-800" />

      {/* Bulk JSON Import / Export */}
      <div>
        <input
          ref={bulkRef}
          type="file"
          accept=".json"
          onChange={handleBulkImport}
          className="hidden"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => bulkRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-200"
          >
            <FileJson size={16} />
            {t('intel.bulkJsonImport')}
          </button>
          <button
            onClick={handleConfigExport}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-200"
          >
            <Download size={16} />
            {t('intel.exportConfig')}
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          {t('intel.bulkImportHelp')}
        </p>
      </div>

      {/* Default values */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm text-gray-400">{t('intel.defaultClsLevel')}</label>
            {getSimpleValues('tiClsLevels').length === 0 && (
              <p className="text-[10px] text-gray-600">{t('intel.usingTlpDefaults')}</p>
            )}
          </div>
          <select
            value={settings.tiDefaultClsLevel || ''}
            onChange={(e) => updateSettings({ tiDefaultClsLevel: e.target.value || undefined })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
          >
            <option value="">{tc('none')}</option>
            {getEffectiveClsLevels(getSimpleValues('tiClsLevels')).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-400">{t('intel.defaultReportSource')}</label>
          <input
            type="text"
            value={settings.tiDefaultReportSource || ''}
            onChange={(e) => updateSettings({ tiDefaultReportSource: e.target.value || undefined })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent w-48"
            placeholder={t('intel.reportSourcePlaceholder')}
          />
        </div>
      </div>

      {/* Attribution Actors */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
            <Users size={12} />
            {t('intel.attributionActors')}
          </span>
          <div className="flex items-center gap-2">
            <input
              ref={actorsRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleActorsImport}
              className="hidden"
            />
            <button
              onClick={() => actorsRef.current?.click()}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-300"
            >
              <Upload size={12} />
              {t('intel.importCsv')}
            </button>
            {actors.length > 0 && (
              <button
                onClick={() => updateSettings({ attributionActors: [] })}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-red-400"
              >
                <X size={12} />
                {t('intel.clear')}
              </button>
            )}
          </div>
        </div>
        {actors.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('intel.actorsLoaded', { count: actors.length })}</p>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {actors.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300 border border-gray-700"
                >
                  {v}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <hr className="border-gray-800" />

      {/* Per-category sections (simple: cls levels, ioc statuses) */}
      {SIMPLE_CATEGORIES.map(({ key, labelKey }) => {
        const values = getSimpleValues(key);
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400">{t(labelKey)}</span>
              <div className="flex items-center gap-2">
                <input
                  ref={(el) => { fileRefs.current[key] = el; }}
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => handleCSVImport(key, e)}
                  className="hidden"
                />
                <button
                  onClick={() => fileRefs.current[key]?.click()}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-300"
                >
                  <Upload size={12} />
                  {t('intel.importCsv')}
                </button>
                {values.length > 0 && (
                  <button
                    onClick={() => updateSettings({ [key]: [] })}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-red-400"
                  >
                    <X size={12} />
                    {t('intel.clear')}
                  </button>
                )}
              </div>
            </div>
            {values.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">{t('intel.valuesLoaded', { count: values.length })}</p>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                  {values.map((v) => (
                    <span
                      key={v}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300 border border-gray-700"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <hr className="border-gray-800" />

      {/* IOC Subtypes — per-type editor */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-gray-400">{t('intel.iocSubtypes')}</span>
        <div className="space-y-1">
          {ALL_IOC_TYPES.map((type) => {
            const { label, color } = IOC_TYPE_LABELS[type];
            const { defaults, custom } = getSubtypesForType(type);
            const isExpanded = expandedSubtypeType === type;
            return (
              <div key={type} className="border border-gray-800 rounded-lg">
                <button
                  onClick={() => setExpandedSubtypeType(isExpanded ? null : type)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs"
                >
                  {isExpanded ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
                  <span style={{ color }} className="font-medium">{label}</span>
                  <span className="text-gray-600">{t('intel.subtypes', { count: defaults.length + custom.length })}</span>
                  {custom.length > 0 && <span className="text-accent">{t('intel.customSubtypes', { count: custom.length })}</span>}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-2 space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      {defaults.map((v) => (
                        <span key={v} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400 border border-gray-700">{v}</span>
                      ))}
                      {custom.map((v) => (
                        <span key={v} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-accent/10 text-accent border border-accent/30">
                          {v}
                          <button onClick={() => removeCustomSubtype(type, v)} className="hover:text-red-400"><X size={8} /></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        value={newSubtypeInput}
                        onChange={(e) => setNewSubtypeInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addCustomSubtype(type); }}
                        placeholder={t('intel.addCustomSubtype')}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                      />
                      <button onClick={() => addCustomSubtype(type)} className="text-accent hover:text-accent-hover p-0.5"><Plus size={14} /></button>
                    </div>
                    {custom.length > 0 && (
                      <button
                        onClick={() => resetSubtypesForType(type)}
                        className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300"
                      >
                        <RotateCcw size={10} /> {t('intel.resetToDefaults')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <hr className="border-gray-800" />

      {/* Relationship Types */}
      <div className="space-y-2">
        <button
          onClick={() => setShowRelTypes(!showRelTypes)}
          className="flex items-center gap-2 text-xs font-medium text-gray-400"
        >
          {showRelTypes ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t('intel.relationshipTypes')}
        </button>
        {showRelTypes && (
          <div className="space-y-2">
            {/* Default types (read-only) */}
            <p className="text-[10px] text-gray-600">{t('intel.builtinRelTypes')}</p>
            <div className="space-y-1">
              {Object.entries(DEFAULT_RELATIONSHIP_TYPES).map(([key, def]) => (
                <div key={key} className="flex items-center gap-2 px-2 py-1 bg-gray-800/50 rounded text-xs">
                  <span className="text-gray-300 font-medium flex-1">{def.label}</span>
                  <span className="text-gray-600 text-[10px]">
                    {def.sourceTypes.length > 0 ? def.sourceTypes.map((st) => IOC_TYPE_LABELS[st as IOCType]?.label || st).join(', ') : tc('any')}
                    {' → '}
                    {def.targetTypes.length > 0 ? def.targetTypes.map((st) => IOC_TYPE_LABELS[st as IOCType]?.label || st).join(', ') : tc('any')}
                  </span>
                </div>
              ))}
            </div>

            {/* Custom types */}
            {Object.keys(customRelTypes).length > 0 && (
              <>
                <p className="text-[10px] text-gray-600 mt-2">{t('intel.customRelTypes')}</p>
                <div className="space-y-1">
                  {Object.entries(customRelTypes).map(([key, def]) => (
                    <div key={key} className="flex items-center gap-2 px-2 py-1 bg-accent/5 rounded text-xs border border-accent/20">
                      <span className="text-accent font-medium flex-1">{def.label}</span>
                      <span className="text-gray-600 text-[10px]">
                        {def.sourceTypes.length > 0 ? def.sourceTypes.map((st) => IOC_TYPE_LABELS[st].label).join(', ') : tc('any')}
                        {' → '}
                        {def.targetTypes.length > 0 ? def.targetTypes.map((st) => IOC_TYPE_LABELS[st].label).join(', ') : tc('any')}
                      </span>
                      <button onClick={() => removeCustomRelType(key)} className="text-gray-500 hover:text-red-400"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Add custom type */}
            {addingRelType ? (
              <div className="border border-gray-700 rounded-lg p-2 space-y-2">
                <input
                  value={newRelLabel}
                  onChange={(e) => { setNewRelLabel(e.target.value); setNewRelKey(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')); }}
                  placeholder={t('intel.relLabelPlaceholder')}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                />
                <div>
                  <label className="text-[10px] text-gray-500">{t('intel.sourceTypes')}</label>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {ALL_IOC_TYPES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setNewRelSource(toggleTypeInList(newRelSource, t))}
                        className={`px-1.5 py-0.5 rounded text-[10px] border ${newRelSource.includes(t) ? 'bg-accent/20 text-accent border-accent/40' : 'bg-gray-800 text-gray-500 border-gray-700'}`}
                      >
                        {IOC_TYPE_LABELS[t].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">{t('intel.targetTypes')}</label>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {ALL_IOC_TYPES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setNewRelTarget(toggleTypeInList(newRelTarget, t))}
                        className={`px-1.5 py-0.5 rounded text-[10px] border ${newRelTarget.includes(t) ? 'bg-accent/20 text-accent border-accent/40' : 'bg-gray-800 text-gray-500 border-gray-700'}`}
                      >
                        {IOC_TYPE_LABELS[t].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={addCustomRelType} disabled={!newRelLabel.trim()} className="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50">{tc('add')}</button>
                  <button onClick={() => setAddingRelType(false)} className="text-xs px-2 py-0.5 rounded text-gray-500 hover:text-gray-300">{tc('cancel')}</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingRelType(true)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-accent"
              >
                <Plus size={12} /> {t('intel.addCustomRelType')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
