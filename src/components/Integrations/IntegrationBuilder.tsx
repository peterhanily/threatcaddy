import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ChevronUp, ChevronDown, ChevronRight, ChevronDown as ChevronDownIcon, Eye, Save, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useIntegrations } from '../../hooks/useIntegrations';
import { useToast } from '../../contexts/ToastContext';
import type {
  IntegrationTemplate,
  IntegrationCategory,
  IntegrationTriggerType,
  IntegrationConfigField,
  IntegrationStep,
  IntegrationOutput,
  IntegrationOutputType,
  IntegrationStepType,
  TransformOp,
} from '../../types/integration-types';
import type { IOCType } from '../../types';
import { Modal } from '../Common/Modal';

const CATEGORIES: { value: IntegrationCategory; label: string }[] = [
  { value: 'enrichment', label: 'Enrichment' },
  { value: 'threat-feed', label: 'Threat Feed' },
  { value: 'siem-soar', label: 'SIEM/SOAR' },
  { value: 'notification', label: 'Notification' },
  { value: 'export', label: 'Export' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'utility', label: 'Utility' },
];

const TRIGGER_TYPES: { value: IntegrationTriggerType; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'on-entity-create', label: 'On Entity Create' },
  { value: 'on-entity-update', label: 'On Entity Update' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'webhook', label: 'Webhook' },
];

const IOC_TYPES: { value: IOCType; label: string }[] = [
  { value: 'ipv4', label: 'IPv4' },
  { value: 'ipv6', label: 'IPv6' },
  { value: 'domain', label: 'Domain' },
  { value: 'url', label: 'URL' },
  { value: 'email', label: 'Email' },
  { value: 'md5', label: 'MD5' },
  { value: 'sha1', label: 'SHA1' },
  { value: 'sha256', label: 'SHA256' },
  { value: 'cve', label: 'CVE' },
  { value: 'mitre-attack', label: 'MITRE ATT&CK' },
  { value: 'yara-rule', label: 'YARA Rule' },
  { value: 'sigma-rule', label: 'Sigma Rule' },
  { value: 'file-path', label: 'File Path' },
];

const STEP_TYPES: { value: IntegrationStepType; label: string }[] = [
  { value: 'http', label: 'HTTP Request' },
  { value: 'transform', label: 'Transform' },
  { value: 'condition', label: 'Condition' },
  { value: 'set-variable', label: 'Set Variable' },
  { value: 'create-entity', label: 'Create Entity' },
  { value: 'delay', label: 'Delay' },
];

const OUTPUT_TYPES: { value: IntegrationOutputType; label: string }[] = [
  { value: 'display', label: 'Display' },
  { value: 'create-ioc', label: 'Create IOC' },
  { value: 'create-note', label: 'Create Note' },
  { value: 'create-task', label: 'Create Task' },
  { value: 'create-timeline-event', label: 'Create Timeline Event' },
  { value: 'update-ioc', label: 'Update IOC' },
  { value: 'notify', label: 'Notify' },
];

const CONFIG_FIELD_TYPES: { value: IntegrationConfigField['type']; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'password', label: 'Password' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'select', label: 'Select' },
];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const TRANSFORM_OPS: { value: TransformOp['op']; label: string }[] = [
  { value: 'extract', label: 'Extract' },
  { value: 'map', label: 'Map' },
  { value: 'filter', label: 'Filter' },
  { value: 'flatten', label: 'Flatten' },
  { value: 'join', label: 'Join' },
  { value: 'template', label: 'Template' },
  { value: 'lookup', label: 'Lookup' },
];

// --- Subcomponents ---

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</h4>
      {children}
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  textarea,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  textarea?: boolean;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-400">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent font-mono resize-y"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
        />
      )}
    </div>
  );
}

function KeyValueEditor({
  label,
  entries,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
}: {
  label: string;
  entries: Array<[string, string]>;
  onChange: (entries: Array<[string, string]>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-400">{label}</label>
      <div className="space-y-1">
        {entries.map(([key, value], idx) => (
          <div key={idx} className="flex gap-1">
            <input
              type="text"
              value={key}
              onChange={(e) => {
                const updated = [...entries];
                updated[idx] = [e.target.value, value];
                onChange(updated);
              }}
              placeholder={keyPlaceholder}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              value={value}
              onChange={(e) => {
                const updated = [...entries];
                updated[idx] = [key, e.target.value];
                onChange(updated);
              }}
              placeholder={valuePlaceholder}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
            <button
              onClick={() => onChange(entries.filter((_, i) => i !== idx))}
              className="p-1 text-gray-500 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange([...entries, ['', '']])}
          className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-1"
        >
          <Plus size={10} />
          Add
        </button>
      </div>
    </div>
  );
}

// --- Step Editor Subcomponents ---

function HttpStepEditor({
  step,
  onChange,
}: {
  step: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}) {
  const headers = step.headers as Record<string, string> | undefined;
  const queryParams = step.queryParams as Record<string, string> | undefined;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="w-28">
          <label className="text-xs text-gray-400">Method</label>
          <select
            value={(step.method as string) || 'GET'}
            onChange={(e) => onChange({ method: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <InputField
            label="URL"
            value={(step.url as string) || ''}
            onChange={(v) => onChange({ url: v })}
            placeholder="https://api.example.com/{{ioc.value}}"
            required
          />
        </div>
      </div>

      <KeyValueEditor
        label="Headers"
        entries={headers ? Object.entries(headers) : []}
        onChange={(entries) => onChange({ headers: Object.fromEntries(entries) })}
      />

      <KeyValueEditor
        label="Query Parameters"
        entries={queryParams ? Object.entries(queryParams) : []}
        onChange={(entries) => onChange({ queryParams: Object.fromEntries(entries) })}
      />

      {(step.method as string) !== 'GET' && (
        <InputField
          label="Body (JSON)"
          value={typeof step.body === 'string' ? step.body : step.body ? JSON.stringify(step.body) : ''}
          onChange={(v) => {
            try {
              onChange({ body: JSON.parse(v) });
            } catch {
              onChange({ body: v });
            }
          }}
          placeholder='{"key": "{{ioc.value}}"}'
          textarea
        />
      )}

      <div className="flex gap-2">
        <div className="w-1/2">
          <label className="text-xs text-gray-400">Response Type</label>
          <select
            value={(step.responseType as string) || 'json'}
            onChange={(e) => onChange({ responseType: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function TransformStepEditor({
  step,
  onChange,
}: {
  step: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}) {
  const operations = (step.operations as TransformOp[]) || [];

  const updateOp = (idx: number, updates: Partial<TransformOp>) => {
    const updated = [...operations];
    updated[idx] = { ...updated[idx], ...updates } as TransformOp;
    onChange({ operations: updated });
  };

  const removeOp = (idx: number) => {
    onChange({ operations: operations.filter((_, i) => i !== idx) });
  };

  const addOp = () => {
    onChange({ operations: [...operations, { op: 'extract', path: '', as: '' }] });
  };

  return (
    <div className="space-y-3">
      <InputField
        label="Input Expression"
        value={(step.input as string) || ''}
        onChange={(v) => onChange({ input: v })}
        placeholder="{{steps.stepId.response.data}}"
      />

      <div className="space-y-2">
        <label className="text-xs text-gray-400">Operations</label>
        {operations.map((op, idx) => (
          <div key={idx} className="bg-gray-900 border border-gray-700 rounded p-2 space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={op.op}
                onChange={(e) => updateOp(idx, { op: e.target.value as TransformOp['op'] })}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
              >
                {TRANSFORM_OPS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={'as' in op ? (op as { as: string }).as : ''}
                onChange={(e) => updateOp(idx, { as: e.target.value } as Partial<TransformOp>)}
                placeholder="Output variable name"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
              <button onClick={() => removeOp(idx)} className="p-1 text-gray-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
            {'path' in op && (op.op as string) !== 'template' && (
              <input
                type="text"
                value={(op as { path: string }).path}
                onChange={(e) => updateOp(idx, { path: e.target.value } as Partial<TransformOp>)}
                placeholder="Path (e.g. data.results)"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
            )}
            {op.op === 'template' && (
              <input
                type="text"
                value={(op as { template: string }).template}
                onChange={(e) => updateOp(idx, { template: e.target.value } as Partial<TransformOp>)}
                placeholder="Template string (e.g. {{vars.name}})"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
            )}
            {op.op === 'filter' && (
              <input
                type="text"
                value={(op as { condition: string }).condition}
                onChange={(e) => updateOp(idx, { condition: e.target.value } as Partial<TransformOp>)}
                placeholder="Condition expression"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
            )}
            {op.op === 'join' && (
              <input
                type="text"
                value={(op as { separator: string }).separator}
                onChange={(e) => updateOp(idx, { separator: e.target.value } as Partial<TransformOp>)}
                placeholder="Separator (e.g. , )"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
            )}
          </div>
        ))}
        <button
          onClick={addOp}
          className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-1"
        >
          <Plus size={10} />
          Add Operation
        </button>
      </div>
    </div>
  );
}

function ConditionStepEditor({
  step,
  onChange,
}: {
  step: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <InputField
        label="Expression"
        value={(step.expression as string) || ''}
        onChange={(v) => onChange({ expression: v })}
        placeholder="{{steps.lookup.response.data.found}} == true"
      />
      <InputField
        label="Then Steps (comma-separated step IDs)"
        value={Array.isArray(step.thenSteps) ? (step.thenSteps as string[]).join(', ') : ''}
        onChange={(v) => onChange({ thenSteps: v.split(',').map((s) => s.trim()).filter(Boolean) })}
        placeholder="step1, step2"
      />
      <InputField
        label="Else Steps (comma-separated step IDs)"
        value={Array.isArray(step.elseSteps) ? (step.elseSteps as string[]).join(', ') : ''}
        onChange={(v) => onChange({ elseSteps: v.split(',').map((s) => s.trim()).filter(Boolean) })}
        placeholder="step3"
      />
    </div>
  );
}

function SetVariableStepEditor({
  step,
  onChange,
}: {
  step: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}) {
  const vars = (step.variables as Record<string, string>) || {};

  return (
    <KeyValueEditor
      label="Variables"
      entries={Object.entries(vars)}
      onChange={(entries) => onChange({ variables: Object.fromEntries(entries) })}
      keyPlaceholder="Variable name"
      valuePlaceholder="Expression"
    />
  );
}

// --- Main Builder ---

interface IntegrationBuilderProps {
  onBack: () => void;
}

export function IntegrationBuilder({ onBack }: IntegrationBuilderProps) {
  const { t } = useTranslation('integrations');
  const { t: tt } = useTranslation('toast');
  const { installTemplate, createInstallation } = useIntegrations();
  const { addToast } = useToast();

  // Basic info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IntegrationCategory>('enrichment');
  const [color, setColor] = useState('#3b82f6');
  const [author, setAuthor] = useState('');

  // Triggers
  const [triggerTypes, setTriggerTypes] = useState<Set<IntegrationTriggerType>>(new Set(['manual']));
  const [manualIOCTypes, setManualIOCTypes] = useState<Set<IOCType>>(new Set());

  // Config schema
  const [configFields, setConfigFields] = useState<IntegrationConfigField[]>([]);

  // Steps
  const [steps, setSteps] = useState<IntegrationStep[]>([]);
  const [expandedStepIdx, setExpandedStepIdx] = useState<number | null>(null);

  // Outputs
  const [outputs, setOutputs] = useState<IntegrationOutput[]>([]);

  // Required domains
  const [domainInput, setDomainInput] = useState('');
  const [requiredDomains, setRequiredDomains] = useState<string[]>([]);

  // Rate limits
  const [maxPerHour, setMaxPerHour] = useState('');
  const [maxPerDay, setMaxPerDay] = useState('');

  // Preview
  const [showPreview, setShowPreview] = useState(false);

  // Toggle trigger type
  const toggleTrigger = (t: IntegrationTriggerType) => {
    setTriggerTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  // Toggle IOC type for manual trigger
  const toggleIOCType = (t: IOCType) => {
    setManualIOCTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  // Config field management
  const addConfigField = () => {
    setConfigFields((prev) => [
      ...prev,
      { key: '', label: '', type: 'string', required: false },
    ]);
  };

  const updateConfigField = (idx: number, updates: Partial<IntegrationConfigField>) => {
    setConfigFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  };

  const removeConfigField = (idx: number) => {
    setConfigFields((prev) => prev.filter((_, i) => i !== idx));
  };

  // Step management
  const addStep = (type: IntegrationStepType) => {
    const id = nanoid(8);
    const base = { id, type, label: `Step ${steps.length + 1}`, continueOnError: false };
    let newStep: IntegrationStep;

    switch (type) {
      case 'http':
        newStep = { ...base, type: 'http', method: 'GET', url: '', responseType: 'json' };
        break;
      case 'transform':
        newStep = { ...base, type: 'transform', input: '', operations: [] };
        break;
      case 'condition':
        newStep = { ...base, type: 'condition', expression: '', thenSteps: [] };
        break;
      case 'set-variable':
        newStep = { ...base, type: 'set-variable', variables: {} };
        break;
      case 'create-entity':
        newStep = { ...base, type: 'create-entity', entityType: 'note', fields: {} };
        break;
      case 'delay':
        newStep = { ...base, type: 'delay', ms: 1000 };
        break;
      default:
        newStep = { ...base, type: 'set-variable', variables: {} };
    }

    setSteps((prev) => [...prev, newStep]);
    setExpandedStepIdx(steps.length);
  };

  const updateStep = (idx: number, updates: Record<string, unknown>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...updates } as IntegrationStep : s)),
    );
  };

  const removeStep = (idx: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
    if (expandedStepIdx === idx) setExpandedStepIdx(null);
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= steps.length) return;
    setSteps((prev) => {
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
    setExpandedStepIdx(newIdx);
  };

  // Output management
  const addOutput = () => {
    setOutputs((prev) => [...prev, { type: 'display', template: {} }]);
  };

  const updateOutput = (idx: number, updates: Partial<IntegrationOutput>) => {
    setOutputs((prev) => prev.map((o, i) => (i === idx ? { ...o, ...updates } : o)));
  };

  const removeOutput = (idx: number) => {
    setOutputs((prev) => prev.filter((_, i) => i !== idx));
  };

  // Domain management
  const addDomain = () => {
    if (!domainInput.trim()) return;
    setRequiredDomains((prev) => [...prev, domainInput.trim()]);
    setDomainInput('');
  };

  // Build template
  const buildTemplate = (): IntegrationTemplate => {
    const now = Date.now();
    const triggers = Array.from(triggerTypes).map((type) => {
      if (type === 'manual' && manualIOCTypes.size > 0) {
        return { type, iocTypes: Array.from(manualIOCTypes) };
      }
      return { type };
    });

    const rateLimit =
      maxPerHour || maxPerDay
        ? {
            maxPerHour: maxPerHour ? Number(maxPerHour) : 100,
            maxPerDay: maxPerDay ? Number(maxPerDay) : 1000,
          }
        : undefined;

    return {
      id: nanoid(),
      schemaVersion: '1.0',
      version: '1.0.0',
      name: name || 'Untitled Integration',
      description: description || '',
      author: author || 'Custom',
      icon: name.charAt(0).toUpperCase() || 'C',
      color,
      category,
      tags: [],
      triggers,
      configSchema: configFields.filter((f) => f.key),
      steps,
      outputs,
      rateLimit,
      requiredDomains,
      source: 'user',
      createdAt: now,
      updatedAt: now,
    };
  };

  const handlePreview = () => {
    setShowPreview(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      addToast('error', tt('integration.nameRequired'));
      return;
    }

    try {
      const template = buildTemplate();
      await installTemplate(template);
      await createInstallation(template.id, {});
      addToast('success', tt('integration.createdAndInstalled', { name: template.name }));
      onBack();
    } catch (err) {
      addToast('error', tt('integration.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={onBack}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors mb-1 flex items-center gap-1"
          >
            <ChevronRight size={12} className="rotate-180" />
            {t('builder.backToCatalog')}
          </button>
          <h3 className="text-sm font-semibold text-gray-200">{t('builder.createIntegration')}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-gray-400 text-xs font-medium hover:text-gray-200 hover:bg-gray-700 transition-colors"
          >
            <Eye size={12} />
            {t('builder.previewJson')}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
          >
            <Save size={12} />
            {t('builder.saveAndInstall')}
          </button>
        </div>
      </div>

      {/* Basic Info */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
        <SectionHeader title="Basic Information" />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Name" value={name} onChange={setName} placeholder="My Integration" required />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-400">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as IntegrationCategory)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="w-20">
              <label className="text-xs text-gray-400">Color</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full h-[34px] bg-gray-800 border border-gray-700 rounded cursor-pointer"
              />
            </div>
          </div>
        </div>
        <InputField label="Description" value={description} onChange={setDescription} placeholder="What does this integration do?" />
        <InputField label="Author" value={author} onChange={setAuthor} placeholder="Your name" />
      </div>

      {/* Triggers */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
        <SectionHeader title="Triggers" />
        <div className="flex flex-wrap gap-2">
          {TRIGGER_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => toggleTrigger(t.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                triggerTypes.has(t.value)
                  ? 'bg-accent/15 text-accent border-accent/30'
                  : 'bg-gray-900 text-gray-500 border-gray-700 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {triggerTypes.has('manual') && (
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400">IOC Types (leave empty for all)</label>
            <div className="flex flex-wrap gap-1.5">
              {IOC_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => toggleIOCType(t.value)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                    manualIOCTypes.has(t.value)
                      ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                      : 'bg-gray-900 text-gray-600 border-gray-700 hover:text-gray-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Config Schema */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
        <SectionHeader title="Configuration Fields">
          <button
            onClick={addConfigField}
            className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-1"
          >
            <Plus size={10} />
            Add Field
          </button>
        </SectionHeader>

        {configFields.length === 0 && (
          <p className="text-xs text-gray-600 italic">No config fields defined. Add fields for API keys, settings, etc.</p>
        )}

        {configFields.map((field, idx) => (
          <div key={idx} className="bg-gray-900 border border-gray-700 rounded p-2 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={field.key}
                onChange={(e) => updateConfigField(idx, { key: e.target.value })}
                placeholder="key"
                className="w-28 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent font-mono"
              />
              <input
                type="text"
                value={field.label}
                onChange={(e) => updateConfigField(idx, { label: e.target.value })}
                placeholder="Label"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
              <select
                value={field.type}
                onChange={(e) => updateConfigField(idx, { type: e.target.value as IntegrationConfigField['type'] })}
                className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
              >
                {CONFIG_FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateConfigField(idx, { required: e.target.checked })}
                  className="rounded border-gray-600"
                />
                Req
              </label>
              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                <input
                  type="checkbox"
                  checked={field.secret || false}
                  onChange={(e) => updateConfigField(idx, { secret: e.target.checked })}
                  className="rounded border-gray-600"
                />
                Secret
              </label>
              <button onClick={() => removeConfigField(idx)} className="p-1 text-gray-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Steps */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
        <SectionHeader title="Steps" />

        {steps.length === 0 && (
          <p className="text-xs text-gray-600 italic">No steps defined. Add steps to build the integration logic.</p>
        )}

        {steps.map((step, idx) => {
          const isExpanded = expandedStepIdx === idx;
          return (
            <div key={step.id} className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
              {/* Step header */}
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() => setExpandedStepIdx(isExpanded ? null : idx)}
                  className="text-gray-400 hover:text-gray-200"
                >
                  {isExpanded ? <ChevronDownIcon size={14} /> : <ChevronRight size={14} />}
                </button>
                <span className="text-[10px] text-gray-600 font-mono w-8">#{idx + 1}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 font-medium uppercase">
                  {step.type}
                </span>
                <input
                  type="text"
                  value={step.label}
                  onChange={(e) => updateStep(idx, { label: e.target.value })}
                  className="flex-1 bg-transparent border-none text-xs text-gray-200 focus:outline-none"
                  placeholder="Step label"
                />
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => moveStep(idx, -1)}
                    disabled={idx === 0}
                    className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-50"
                    title="Move up"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    onClick={() => moveStep(idx, 1)}
                    disabled={idx === steps.length - 1}
                    className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-50"
                    title="Move down"
                  >
                    <ChevronDown size={12} />
                  </button>
                  <button
                    onClick={() => removeStep(idx)}
                    className="p-1 text-gray-500 hover:text-red-400"
                    title="Remove step"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Step body */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-700 pt-3 space-y-3">
                  <div className="flex gap-2">
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-400">
                      <input
                        type="checkbox"
                        checked={step.continueOnError || false}
                        onChange={(e) => updateStep(idx, { continueOnError: e.target.checked })}
                        className="rounded border-gray-600"
                      />
                      Continue on error
                    </label>
                    <div className="flex-1">
                      <input
                        type="text"
                        value={step.condition || ''}
                        onChange={(e) => updateStep(idx, { condition: e.target.value || undefined })}
                        placeholder="Condition (optional, e.g. {{vars.shouldRun}})"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
                      />
                    </div>
                  </div>

                  {step.type === 'http' && (
                    <HttpStepEditor
                      step={step as unknown as Record<string, unknown>}
                      onChange={(updates) => updateStep(idx, updates)}
                    />
                  )}
                  {step.type === 'transform' && (
                    <TransformStepEditor
                      step={step as unknown as Record<string, unknown>}
                      onChange={(updates) => updateStep(idx, updates)}
                    />
                  )}
                  {step.type === 'condition' && (
                    <ConditionStepEditor
                      step={step as unknown as Record<string, unknown>}
                      onChange={(updates) => updateStep(idx, updates)}
                    />
                  )}
                  {step.type === 'set-variable' && (
                    <SetVariableStepEditor
                      step={step as unknown as Record<string, unknown>}
                      onChange={(updates) => updateStep(idx, updates)}
                    />
                  )}
                  {step.type === 'create-entity' && (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-gray-400">Entity Type</label>
                        <select
                          value={(step as unknown as Record<string, unknown>).entityType as string || 'note'}
                          onChange={(e) => updateStep(idx, { entityType: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
                        >
                          <option value="ioc">IOC</option>
                          <option value="note">Note</option>
                          <option value="task">Task</option>
                          <option value="timeline-event">Timeline Event</option>
                        </select>
                      </div>
                      <InputField
                        label="Fields (JSON)"
                        value={JSON.stringify((step as unknown as Record<string, unknown>).fields || {}, null, 2)}
                        onChange={(v) => {
                          try {
                            updateStep(idx, { fields: JSON.parse(v) });
                          } catch { /* ignore parse errors while typing */ }
                        }}
                        placeholder='{"title": "{{ioc.value}}"}'
                        textarea
                      />
                    </div>
                  )}
                  {step.type === 'delay' && (
                    <InputField
                      label="Delay (ms)"
                      value={String((step as unknown as Record<string, unknown>).ms || 1000)}
                      onChange={(v) => updateStep(idx, { ms: Number(v) || 0 })}
                      type="number"
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Add step dropdown */}
        <div className="flex flex-wrap gap-1.5">
          {STEP_TYPES.map((st) => (
            <button
              key={st.value}
              onClick={() => addStep(st.value)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-gray-900 text-gray-400 border border-gray-700 hover:text-gray-200 hover:border-gray-600 transition-colors"
            >
              <Plus size={10} />
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Outputs */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
        <SectionHeader title="Outputs">
          <button
            onClick={addOutput}
            className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-1"
          >
            <Plus size={10} />
            Add Output
          </button>
        </SectionHeader>

        {outputs.length === 0 && (
          <p className="text-xs text-gray-600 italic">No outputs defined. Add a &quot;display&quot; output to show results.</p>
        )}

        {outputs.map((output, idx) => (
          <div key={idx} className="bg-gray-900 border border-gray-700 rounded p-2 space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={output.type}
                onChange={(e) => updateOutput(idx, { type: e.target.value as IntegrationOutputType })}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
              >
                {OUTPUT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={output.condition || ''}
                onChange={(e) => updateOutput(idx, { condition: e.target.value || undefined })}
                placeholder="Condition (optional)"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
              <button onClick={() => removeOutput(idx)} className="p-1 text-gray-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
            <div>
              <label className="text-xs text-gray-400">Template (JSON)</label>
              <textarea
                value={JSON.stringify(output.template, null, 2)}
                onChange={(e) => {
                  try {
                    updateOutput(idx, { template: JSON.parse(e.target.value) });
                  } catch { /* ignore parse errors while typing */ }
                }}
                placeholder='{"title": "{{vars.result}}"}'
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent font-mono resize-y"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Required Domains */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
        <SectionHeader title="Required Domains" />
        <div className="flex flex-wrap gap-1.5">
          {requiredDomains.map((domain, idx) => (
            <span
              key={idx}
              className="px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1"
            >
              {domain}
              <button
                onClick={() => setRequiredDomains((prev) => prev.filter((_, i) => i !== idx))}
                className="hover:text-red-400"
              >
                <X size={8} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDomain();
              }
            }}
            placeholder="api.example.com"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
          />
          <button
            onClick={addDomain}
            className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-xs hover:bg-gray-600 transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      {/* Rate Limits */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
        <SectionHeader title="Rate Limits" />
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Max per Hour"
            value={maxPerHour}
            onChange={setMaxPerHour}
            placeholder="100"
            type="number"
          />
          <InputField
            label="Max per Day"
            value={maxPerDay}
            onChange={setMaxPerDay}
            placeholder="1000"
            type="number"
          />
        </div>
      </div>

      {/* Preview Modal */}
      <Modal open={showPreview} onClose={() => setShowPreview(false)} title="Template Preview" wide>
        <pre className="bg-gray-800 border border-gray-700 rounded p-3 text-[10px] text-gray-300 overflow-x-auto max-h-[60vh] overflow-y-auto font-mono">
          {JSON.stringify(buildTemplate(), null, 2)}
        </pre>
      </Modal>
    </div>
  );
}
