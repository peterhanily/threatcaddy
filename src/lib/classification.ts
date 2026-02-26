import { DEFAULT_CLS_LEVELS } from '../types';

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

/** Cascade: IOC-level > entity-level > global default > empty string. */
export function resolveIOCClsLevel(iocLevel?: string, entityLevel?: string, defaultLevel?: string): string {
  return iocLevel || entityLevel || defaultLevel || '';
}

/**
 * Official OASIS STIX 2.1 marking-definition objects for the Traffic Light Protocol.
 * UUIDs are the canonical ones from the STIX 2.1 specification.
 */
export const STIX_TLP_MARKING_DEFS: Record<string, {
  type: 'marking-definition';
  spec_version: '2.1';
  id: string;
  created: string;
  definition_type: 'tlp';
  name: string;
  definition: { tlp: string };
}> = {
  'TLP:CLEAR': {
    type: 'marking-definition',
    spec_version: '2.1',
    id: 'marking-definition--94868c89-83c2-464b-929b-a1a8aa3c8487',
    created: '2022-10-01T00:00:00.000Z',
    definition_type: 'tlp',
    name: 'TLP:CLEAR',
    definition: { tlp: 'clear' },
  },
  'TLP:GREEN': {
    type: 'marking-definition',
    spec_version: '2.1',
    id: 'marking-definition--bab4a63c-afd4-4e03-b846-b75e0496be71',
    created: '2022-10-01T00:00:00.000Z',
    definition_type: 'tlp',
    name: 'TLP:GREEN',
    definition: { tlp: 'green' },
  },
  'TLP:AMBER': {
    type: 'marking-definition',
    spec_version: '2.1',
    id: 'marking-definition--55d920b0-5e8b-4f79-9ee9-91f868d9b421',
    created: '2022-10-01T00:00:00.000Z',
    definition_type: 'tlp',
    name: 'TLP:AMBER',
    definition: { tlp: 'amber' },
  },
  'TLP:AMBER+STRICT': {
    type: 'marking-definition',
    spec_version: '2.1',
    id: 'marking-definition--939a9414-2ddd-4d32-a0cd-b7571b03f430',
    created: '2022-10-01T00:00:00.000Z',
    definition_type: 'tlp',
    name: 'TLP:AMBER+STRICT',
    definition: { tlp: 'amber+strict' },
  },
  'TLP:RED': {
    type: 'marking-definition',
    spec_version: '2.1',
    id: 'marking-definition--e828b379-4e03-4974-9ac4-e53a884c97c1',
    created: '2022-10-01T00:00:00.000Z',
    definition_type: 'tlp',
    name: 'TLP:RED',
    definition: { tlp: 'red' },
  },
};
