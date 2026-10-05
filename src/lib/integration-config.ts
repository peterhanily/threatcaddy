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
    if (!field.required) return false;
    const value = Object.hasOwn(config, field.key) ? config[field.key] : undefined;
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) {
      return field.type !== 'multi-select' || value.length === 0
        || value.some(selection => typeof selection !== 'string' || selection.trim().length === 0);
    }
    if (typeof value === 'number') return !Number.isFinite(value);
    return typeof value !== 'boolean';
  }).map(field => ({ key: field.key, label: field.label || field.key }));
}
