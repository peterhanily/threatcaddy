import type { AgentDeployment, ConfidenceLevel, Priority, TaskStatus, TimelineEventType } from '../types';

/** The values backup-records.ts accepts. Kept free of runtime imports: db.ts uses them. */
export const TASK_PRIORITIES: readonly Priority[] = ['none', 'low', 'medium', 'high'];
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in-progress', 'done'];
export const CONFIDENCE_VALUES: readonly ConfidenceLevel[] = ['low', 'medium', 'high', 'confirmed'];
export const TIMELINE_EVENT_TYPES: readonly TimelineEventType[] = [
  'initial-access', 'execution', 'persistence', 'privilege-escalation', 'defense-evasion', 'credential-access', 'discovery', 'lateral-movement',
  'collection', 'exfiltration', 'command-and-control', 'impact', 'detection', 'containment', 'eradication', 'recovery', 'communication', 'evidence', 'other',
];
export const AGENT_COMPETITIVENESS: readonly NonNullable<AgentDeployment['competitiveness']>[] = ['cooperative', 'competitive', 'independent'];

/** Models write 'High' or 'lateral_movement'; anything else stays unsupported. */
export function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase().replace(/_/g, '-');
  return allowed.find(entry => entry === normalized);
}
