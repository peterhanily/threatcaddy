import { DEFAULT_CLS_LEVELS } from '../types';
export { STIX_TLP_MARKING_DEFS } from './stix-common-objects';

/** Tailwind-compatible style classes for a classification level badge. */
export interface ClsBadgeStyle {
  bg: string;
  text: string;
  border: string;
}

const TLP_STYLES: Record<string, ClsBadgeStyle> = {
  'TLP:RED':          { bg: 'bg-red-500/20',    text: 'text-red-400',    border: 'border-red-500/40' },
  'TLP:AMBER+STRICT': { bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-500/60' },
  'TLP:AMBER':        { bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-500/40' },
  'TLP:GREEN':        { bg: 'bg-green-500/20',  text: 'text-green-400',  border: 'border-green-500/40' },
  'TLP:CLEAR':        { bg: 'bg-gray-500/20',   text: 'text-gray-400',   border: 'border-gray-500/40' },
  'PAP:RED':          { bg: 'bg-red-500/20',    text: 'text-red-400',    border: 'border-red-500/40' },
  'PAP:AMBER':        { bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-500/40' },
  'PAP:GREEN':        { bg: 'bg-green-500/20',  text: 'text-green-400',  border: 'border-green-500/40' },
  'PAP:WHITE':        { bg: 'bg-gray-500/20',   text: 'text-gray-400',   border: 'border-gray-500/40' },
};

const NEUTRAL_STYLE: ClsBadgeStyle = { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/40' };

/** Returns Tailwind classes for a classification badge. Falls back to neutral gray for custom levels. */
export function getClsBadgeStyle(level: string): ClsBadgeStyle {
  return TLP_STYLES[level.toUpperCase()] ?? NEUTRAL_STYLE;
}

/** Returns the user's configured cls levels if non-empty, otherwise the built-in TLP defaults. */
export function getEffectiveClsLevels(userLevels?: string[]): string[] {
  return userLevels && userLevels.length > 0 ? userLevels : DEFAULT_CLS_LEVELS;
}

/**
 * Returns true if the item should be hidden during screenshare mode.
 * - No level → visible (not sensitive)
 * - Unknown level (not in hierarchy) → hidden (conservative)
 * - Otherwise compare indices: hidden if item index > max index
 */
export function isAboveClsThreshold(itemLevel: string | undefined, maxLevel: string, effectiveLevels: string[]): boolean {
  if (!itemLevel) return false;
  const itemIdx = effectiveLevels.indexOf(itemLevel);
  const maxIdx = effectiveLevels.indexOf(maxLevel);
  if (itemIdx === -1) return true; // unknown level → hide conservatively
  if (maxIdx === -1) return true;  // unknown max → hide conservatively
  return itemIdx > maxIdx;
}

/** Cascade: IOC-level > entity-level > global default > empty string. */
export function resolveIOCClsLevel(iocLevel?: string, entityLevel?: string, defaultLevel?: string): string {
  return iocLevel || entityLevel || defaultLevel || '';
}

/** Combining handling restrictions never selects the weaker of duplicate labels. */
export function conservativeClsLevel(levels: Array<string | undefined>): string | undefined {
  const unique = [...new Set(levels.filter((v): v is string => !!v))];
  if (!unique.length) return undefined;
  const unknown = unique.filter(level => !DEFAULT_CLS_LEVELS.includes(level));
  if (unknown.length) return unique.join(' & ');
  return unique.reduce((a, b) => DEFAULT_CLS_LEVELS.indexOf(a) >= DEFAULT_CLS_LEVELS.indexOf(b) ? a : b);
}
