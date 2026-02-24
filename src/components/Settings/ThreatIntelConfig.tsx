import { useRef } from 'react';
import { Upload, X, ShieldCheck, FileJson } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

interface ConfigCategory {
  key: 'tiClsLevels' | 'tiIocSubtypes' | 'tiRelationshipTypes' | 'tiIocStatuses';
  label: string;
}

const CATEGORIES: ConfigCategory[] = [
  { key: 'tiClsLevels', label: 'Classification Levels' },
  { key: 'tiIocSubtypes', label: 'IOC Subtypes' },
  { key: 'tiRelationshipTypes', label: 'Relationship Types' },
  { key: 'tiIocStatuses', label: 'IOC Statuses' },
];

const BULK_KEY_MAP: Record<string, ConfigCategory['key']> = {
  cls_levels: 'tiClsLevels',
  ioc_subtypes: 'tiIocSubtypes',
  relationship_types: 'tiRelationshipTypes',
  ioc_statuses: 'tiIocStatuses',
};

export function ThreatIntelConfig() {
  const { settings, updateSettings } = useSettings();
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const bulkRef = useRef<HTMLInputElement>(null);

  const getValues = (key: ConfigCategory['key']): string[] => settings[key] ?? [];

  const handleCSVImport = (key: ConfigCategory['key'], e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = text.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.length > 0);
      const current = getValues(key);
      const unique = [...new Set([...current, ...parsed])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
      updateSettings({ [key]: unique });
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
        const updates: Partial<Record<ConfigCategory['key'], string[]>> = {};
        for (const [jsonKey, settingsKey] of Object.entries(BULK_KEY_MAP)) {
          if (Array.isArray(data[jsonKey])) {
            const current = getValues(settingsKey);
            const parsed = (data[jsonKey] as unknown[]).map(String).filter((s) => s.length > 0);
            updates[settingsKey] = [...new Set([...current, ...parsed])].sort((a, b) =>
              a.localeCompare(b, undefined, { sensitivity: 'base' })
            );
          }
        }
        if (Object.keys(updates).length > 0) {
          updateSettings(updates);
        }
      } catch {
        // invalid JSON - silently ignore
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <ShieldCheck size={16} />
        Threat Intel Configuration
      </h3>

      {/* Bulk JSON Import */}
      <div>
        <input
          ref={bulkRef}
          type="file"
          accept=".json"
          onChange={handleBulkImport}
          className="hidden"
        />
        <button
          onClick={() => bulkRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-200"
        >
          <FileJson size={16} />
          Bulk JSON Import
        </button>
        <p className="text-xs text-gray-600 mt-1">
          Accepts {'{'} cls_levels: [...], ioc_subtypes: [...], relationship_types: [...], ioc_statuses: [...] {'}'}
        </p>
      </div>

      {/* Default values */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-400">Default Classification Level</label>
          <select
            value={settings.tiDefaultClsLevel || ''}
            onChange={(e) => updateSettings({ tiDefaultClsLevel: e.target.value || undefined })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
          >
            <option value="">None</option>
            {getValues('tiClsLevels').map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-400">Default Report Source</label>
          <input
            type="text"
            value={settings.tiDefaultReportSource || ''}
            onChange={(e) => updateSettings({ tiDefaultReportSource: e.target.value || undefined })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent w-48"
            placeholder="e.g. Internal"
          />
        </div>
      </div>

      <hr className="border-gray-800" />

      {/* Per-category sections */}
      {CATEGORIES.map(({ key, label }) => {
        const values = getValues(key);
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400">{label}</span>
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
                  Import CSV
                </button>
                {values.length > 0 && (
                  <button
                    onClick={() => updateSettings({ [key]: [] })}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-red-400"
                  >
                    <X size={12} />
                    Clear
                  </button>
                )}
              </div>
            </div>
            {values.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">{values.length} value{values.length !== 1 ? 's' : ''} loaded</p>
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
    </div>
  );
}
