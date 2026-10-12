import type { IntegrationConfigField } from '../types/integration-types';

export interface MissingIntegrationConfigField {
  key: string;
  label: string;
}

/** Apply defaults only to absent/undefined settings, never to an explicit clear. */
export function resolveIntegrationConfig(
  fields: readonly IntegrationConfigField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = { ...values };
  for (const field of fields) {
    if ((!Object.hasOwn(values, field.key) || values[field.key] === undefined) && field.default !== undefined) {
      // Define an own data property even for unusual imported schema keys.
      Object.defineProperty(resolved, field.key, { value: field.default, enumerable: true, writable: true, configurable: true });
    }
  }
  return resolved;
}

/**
 * Required-setting presence checks shared by the form and execution preflight.
 * This is not transport authorization or a replacement for template validation.
 * Return field metadata only, never configured values (which may be secrets).
 */
export function validateIntegrationConfig(
  fields: readonly IntegrationConfigField[],
  values: Record<string, unknown>,
): MissingIntegrationConfigField[] {
  const config = resolveIntegrationConfig(fields, values);
  return fields.filter(field => {
    const value = Object.hasOwn(config, field.key) ? config[field.key] : undefined;
    if (value === null || value === undefined || value === '') return field.required;
    switch (field.type) {
      case 'number': return typeof value !== 'number' || !Number.isFinite(value);
      case 'boolean': return typeof value !== 'boolean';
      case 'string': case 'password': return typeof value !== 'string' || (field.required && !value.trim());
      case 'select': case 'multi-select': {
        const selections = field.type === 'multi-select' && Array.isArray(value) ? value : [value];
        if (!selections.length) return field.required;
        return selections.some(selection => typeof selection !== 'string' || !selection.trim()
          || (field.options !== undefined && !field.options.some(option => option.value === selection)));
      }
      default: return true;
    }
  }).map(field => ({ key: field.key, label: field.label || field.key }));
}
