/**
 * Typed accessor functions for localized label constants.
 *
 * These replace direct access to the hardcoded label Records in types.ts etc.
 * Each function calls i18n.t() lazily at render time (never at module init),
 * so translations are resolved after i18next has initialized.
 *
 * Usage: import { iocTypeLabel } from '../lib/i18n-labels';
 *        const label = iocTypeLabel('ipv4'); // "IPv4"
 */
import i18n from '../i18n';
import type {
  ClosureResolution,
  KPIMetricId,
  IOCType,
  IOCStatusValue,
  ConfidenceLevel,
  TimelineEventType,
  ActivityCategory,
} from '../types';
import type { SessionDuration } from './encryptionStore';

const t = (key: string) => i18n.t(key, { ns: 'labels' });

/**
 * Creates a proxy that lazily resolves label strings via i18n.t() on access.
 * This lets existing code continue using `LABELS[key]` syntax while routing
 * through the translation system. The proxy returns the i18n value on every
 * property access — no caching, so language changes take effect immediately.
 */
export function createLabelProxy<K extends string>(
  prefix: string,
  keys: readonly K[],
): Record<K, string> {
  const handler: ProxyHandler<Record<K, string>> = {
    get(_target, prop: string) {
      if (typeof prop === 'string' && keys.includes(prop as K)) {
        return t(`${prefix}.${prop}`);
      }
      return undefined;
    },
    ownKeys() {
      return [...keys];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'string' && keys.includes(prop as K)) {
        return { configurable: true, enumerable: true, value: t(`${prefix}.${prop}`) };
      }
      return undefined;
    },
  };
  return new Proxy({} as Record<K, string>, handler);
}

/**
 * Like createLabelProxy but for Records where value is { label, color }.
 * Color stays static (not translated), label resolves via i18n.
 */
export function createLabelColorProxy<K extends string>(
  prefix: string,
  colorMap: Record<K, string>,
): Record<K, { label: string; color: string }> {
  const keys = Object.keys(colorMap) as K[];
  const handler: ProxyHandler<Record<K, { label: string; color: string }>> = {
    get(_target, prop: string) {
      if (typeof prop === 'string' && keys.includes(prop as K)) {
        return { label: t(`${prefix}.${prop}`), color: colorMap[prop as K] };
      }
      return undefined;
    },
    ownKeys() {
      return [...keys];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'string' && keys.includes(prop as K)) {
        return {
          configurable: true,
          enumerable: true,
          value: { label: t(`${prefix}.${prop}`), color: colorMap[prop as K] },
        };
      }
      return undefined;
    },
  };
  return new Proxy({} as Record<K, { label: string; color: string }>, handler);
}

// ─── Direct accessor functions (for new code) ──────────────────

export function closureResolutionLabel(key: ClosureResolution): string {
  return t(`closureResolution.${key}`);
}

export function kpiMetricLabel(key: KPIMetricId): string {
  return t(`kpiMetric.${key}`);
}

export function iocTableColumnLabel(key: string): string {
  return t(`iocTableColumn.${key}`);
}

export function iocTypeLabel(type: IOCType): string {
  return t(`iocType.${type}`);
}

export function iocStatusLabel(status: IOCStatusValue): string {
  return t(`iocStatus.${status}`);
}

export function confidenceLabel(level: ConfidenceLevel): string {
  return t(`confidence.${level}`);
}

export function timelineEventTypeLabel(type: TimelineEventType): string {
  return t(`timelineEventType.${type}`);
}

export function activityCategoryLabel(category: ActivityCategory): string {
  return t(`activityCategory.${category}`);
}

export function sessionDurationLabel(duration: SessionDuration): string {
  return t(`sessionDuration.${duration}`);
}

export function fieldLabel(field: string): string {
  return t(`field.${field}`);
}

export function mappingLabel(mapping: string): string {
  return t(`mapping.${mapping}`);
}

export function mentionCategoryLabel(type: string): string {
  return t(`mentionCategory.${type}`);
}

export function noteColorLabel(index: number): string {
  const keys = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
  const key = keys[index];
  return key ? t(`noteColor.${key}`) : '';
}
