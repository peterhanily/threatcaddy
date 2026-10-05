import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveIntegrationConfig, validateIntegrationConfig } from '../../lib/integration-config';
import type { IntegrationConfigField } from '../../types/integration-types';

export function IntegrationConfigForm({ fields, values, onSave, onCancel }: {
  fields: IntegrationConfigField[];
  values: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation('integrations');
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [formValues, setFormValues] = useState(() => {
    const initial = resolveIntegrationConfig(fields, values);
    for (const field of fields) {
      // An unchecked switch represents false, not a missing string value.
      if (initial[field.key] == null) initial[field.key] = field.type === 'boolean' ? false : '';
    }
    return initial;
  });
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const invalid = new Set(submitted ? validateIntegrationConfig(fields, formValues).map((field) => field.key) : []);
  const updateField = (key: string, value: unknown) => {
    setFormValues((previous) => ({ ...previous, [key]: value }));
    setSaveError(false);
  };
  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent';

  return (
    <form ref={formRef} noValidate className="border border-gray-700 rounded-lg p-3 space-y-3 bg-gray-800/50 mt-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (savingRef.current) return;
        setSubmitted(true);
        const errors = validateIntegrationConfig(fields, formValues);
        if (errors.length) {
          const index = fields.findIndex((field) => field.key === errors[0].key);
          formRef.current?.querySelector<HTMLElement>(`[id="${id}-field-${index}"]`)?.focus();
          return;
        }
        savingRef.current = true;
        setSaving(true);
        setSaveError(false);
        try {
          await onSave(formValues);
          // Only this editor session may close itself; a replacement editor
          // for the same installation must survive an older save completion.
          if (mountedRef.current) onCancel();
        } catch {
          // Storage/provider errors can contain config values. Keep feedback generic.
          if (mountedRef.current) setSaveError(true);
        } finally {
          savingRef.current = false;
          if (mountedRef.current) setSaving(false);
        }
      }}>
      {fields.map((field, index) => {
        const fieldId = `${id}-field-${index}`;
        const errorId = `${fieldId}-error`;
        const descriptionId = `${fieldId}-description`;
        const common = {
          id: fieldId,
          disabled: saving,
          'aria-required': field.required,
          'aria-invalid': invalid.has(field.key) || undefined,
          'aria-describedby': [field.description && descriptionId, invalid.has(field.key) && errorId].filter(Boolean).join(' ') || undefined,
        };
        const value = formValues[field.key];
        // Existing integrations use scalar multi-selects. Preserve their shape; imported
        // array configurations get a multiple control instead of being flattened on save.
        const multiple = field.type === 'multi-select' && Array.isArray(value);
        return <div key={field.key} className="space-y-1">
          <label htmlFor={fieldId} className="text-xs text-gray-400">
            {field.label}{field.required && <span aria-hidden="true" className="text-red-400 ms-0.5">*</span>}
          </label>
          {field.description && <p id={descriptionId} className="text-[10px] text-gray-600">{field.description}</p>}
          {field.type === 'boolean' ? (
            <button {...common} type="button" role="switch" aria-checked={!!value}
              onClick={() => updateField(field.key, !value)}
              className={`relative flex h-6 w-10 items-center rounded-full transition-colors ${value ? 'bg-accent' : 'bg-gray-600'}`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${value ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
            </button>
          ) : field.type === 'select' || field.type === 'multi-select' ? (
            <select {...common} multiple={multiple} value={multiple ? (value as unknown[]).map(String) : String(value ?? '')}
              onChange={(event) => updateField(field.key, multiple ? Array.from(event.target.selectedOptions, (option) => option.value) : event.target.value)} className={inputClass}>
              {!multiple && <option value="">{t('config.selectPlaceholder', 'Select...')}</option>}
              {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : field.type === 'password' ? (
            <div className="relative">
              <input {...common} type={showPasswords[field.key] ? 'text' : 'password'} value={String(value ?? '')}
                onChange={(event) => updateField(field.key, event.target.value)} placeholder={field.placeholder}
                autoComplete="off" data-1p-ignore data-lpignore="true" className={`${inputClass} pe-16`} />
              <button type="button" disabled={saving} aria-controls={fieldId} aria-pressed={!!showPasswords[field.key]}
                aria-label={t('config.togglePassword', { defaultValue: 'Show or hide {{label}}', label: field.label })}
                onClick={() => setShowPasswords((previous) => ({ ...previous, [field.key]: !previous[field.key] }))}
                className="absolute end-2 top-1/2 -translate-y-1/2 min-h-6 text-[10px] text-gray-500 hover:text-gray-300">
                {showPasswords[field.key] ? t('config.hide') : t('config.show')}
              </button>
            </div>
          ) : (
            <input {...common} type={field.type === 'number' ? 'number' : 'text'} value={String(value ?? '')}
              onChange={(event) => updateField(field.key, field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}
              placeholder={field.placeholder} className={inputClass} />
          )}
          {invalid.has(field.key) && <p id={errorId} className="text-xs text-red-400">{t('config.requiredField', { defaultValue: '{{label}} is required.', label: field.label })}</p>}
        </div>;
      })}
      {saveError && <p role="alert" className="text-xs text-red-400">{t('config.saveFailed', 'Could not save configuration. Your entries are still here; try again.')}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-50">
          {saving ? t('config.saving', 'Saving…') : t('config.save', 'Save')}
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className="px-3 py-1.5 rounded-lg text-gray-400 text-xs font-medium hover:text-gray-200 transition-colors">
          {t('config.cancel', 'Cancel')}
        </button>
      </div>
    </form>
  );
}
