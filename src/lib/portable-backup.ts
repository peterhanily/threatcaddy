/** Versioned file adapters only. Canonical server/differential payloads are never rewritten here. */
import type { QuickLink } from '../types';
import { decryptBackup, type BackupPayload, type EncryptedBackupBlob } from './backup-crypto';
import { BACKUP_TABLES, type BackupTable } from './backup-tables';
import { assertBackupSize, isBackupObject, validateBackupJSON, validateBackupQuickLinks, validatePortableTables } from './backup-records';

export const PORTABLE_BACKUP_FORMAT = 'threatcaddy-backup';
export class BackupPasswordRequiredError extends Error {
  constructor() { super('This backup is encrypted. Enter its backup password and retry.'); this.name = 'BackupPasswordRequiredError'; }
}
export interface DecodedPortableBackup {
  payload: BackupPayload;
  quickLinks?: QuickLink[];
  sourceFormat: 'portable' | 'legacy-json' | 'legacy-cloud' | 'payload' | 'legacy-encrypted-cloud';
  encrypted: boolean;
  legacy: boolean;
  warnings: string[];
}

function invalid(): never { throw new Error('Invalid backup file format or unsupported version; nothing was imported.'); }
function fullPayload(raw: Record<string, unknown>): BackupPayload {
  // Header imports are whole-workspace imports. Scoped/differential restores
  // retain their separate preview, parent and reference-safety contract.
  if (raw.version !== 1 || raw.type !== 'full' || raw.scope !== 'all' || raw.scopeId !== undefined
    || typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)
    || Math.abs(raw.createdAt) > 8_640_000_000_000_000 || raw.deletedIds !== undefined) invalid();
  for (const key of Object.keys(raw)) if (!['version', 'type', 'scope', 'createdAt', 'data'].includes(key)) invalid();
  validatePortableTables(raw.data);
  return raw as unknown as BackupPayload;
}

function flat(raw: Record<string, unknown>, encrypted: boolean): DecodedPortableBackup {
  if (raw.version !== 1 || (raw.format !== undefined && raw.format !== PORTABLE_BACKUP_FORMAT)
    || !['notes', 'tasks'].every(name => Array.isArray(raw[name]))) invalid();
  if (raw.exportedAt !== undefined && (typeof raw.exportedAt !== 'number' || !Number.isFinite(raw.exportedAt)
    || Math.abs(raw.exportedAt) > 8_640_000_000_000_000)) invalid();
  const allowed = new Set<string>([...BACKUP_TABLES, 'version', 'format', 'exportedAt', 'quickLinks', 'redactions']);
  if (Object.keys(raw).some(name => !allowed.has(name))) invalid();
  if (raw.format === PORTABLE_BACKUP_FORMAT && !BACKUP_TABLES.every(name => Array.isArray(raw[name]))) invalid();
  const data = Object.fromEntries(BACKUP_TABLES.filter(name => Object.hasOwn(raw, name)).map(name => [name, raw[name]]));
  validatePortableTables(data, { allowLegacyDefaults: raw.format !== PORTABLE_BACKUP_FORMAT });
  if (raw.quickLinks !== undefined) validateBackupQuickLinks(raw.quickLinks);
  if (raw.redactions !== undefined && (!Array.isArray(raw.redactions)
    || raw.redactions.some(value => value !== 'installedIntegrations.config'))) invalid();
  return {
    payload: { version: 1, type: 'full', scope: 'all', createdAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0, data },
    ...(raw.quickLinks !== undefined ? { quickLinks: raw.quickLinks as QuickLink[] } : {}),
    sourceFormat: raw.format === PORTABLE_BACKUP_FORMAT ? 'portable' : 'legacy-json', encrypted, legacy: raw.format !== PORTABLE_BACKUP_FORMAT,
    warnings: Array.isArray(raw.redactions) && raw.redactions.length ? ['Integration configuration was omitted from this plaintext backup. Reconfigure restored integrations before enabling them.'] : [],
  };
}

export async function decodePortableBackup(json: string, password?: string): Promise<DecodedPortableBackup> {
  assertBackupSize(json);
  let raw: unknown = JSON.parse(json);
  let encrypted = false;
  if (isBackupObject(raw) && Object.hasOwn(raw, 'v')) {
    if (password === undefined || password.length === 0) throw new BackupPasswordRequiredError();
    raw = await decryptBackup<unknown>(password, raw as unknown as EncryptedBackupBlob);
    assertBackupSize(JSON.stringify(raw));
    encrypted = true;
  }
  if (!isBackupObject(raw)) invalid();
  validateBackupJSON(raw);
  if (raw.type === 'full-backup') {
    if (raw.version !== 1 || !isBackupObject(raw.payload)
      || Object.keys(raw).some(key => !['version', 'type', 'sharedBy', 'sharedAt', 'payload'].includes(key))) invalid();
    const result = flat(raw.payload, encrypted);
    return { ...result, sourceFormat: 'legacy-cloud' };
  }
  if (raw.type !== undefined || raw.scope !== undefined || raw.data !== undefined) {
    // Previously encrypted cloud files accidentally nested ExportData as data.
    // This exact legacy shape is recoverable; arbitrary nested envelopes are not.
    if (encrypted && raw.version === 1 && raw.type === 'full' && raw.scope === 'all' && raw.scopeId === undefined
      && isBackupObject(raw.data) && raw.data.version === 1 && Array.isArray(raw.data.notes)) {
      const envelope = { ...raw, data: {} };
      fullPayload(envelope);
      return { ...flat(raw.data, true), sourceFormat: 'legacy-encrypted-cloud' };
    }
    return { payload: fullPayload(raw), sourceFormat: 'payload', encrypted, legacy: false, warnings: [] };
  }
  return flat(raw, encrypted);
}

/** A restored configuration is inert until separately reviewed in this workspace. */
export function suspendRestoredAutomation(data: BackupPayload['data']): BackupPayload['data'] {
  const copy = structuredClone(data);
  for (const row of copy.folders ?? []) {
    const folder = row as Record<string, unknown>;
    if (folder.agentEnabled === true || folder.agentStatus === 'running' || folder.agentStatus === 'waiting') {
      folder.agentEnabled = false;
      folder.agentStatus = 'paused';
    }
  }
  for (const row of copy.installedIntegrations ?? []) (row as Record<string, unknown>).enabled = false;
  for (const row of copy.agentDeployments ?? []) {
    const deployment = row as Record<string, unknown>;
    deployment.status = 'paused';
    deployment.shift = 'resting';
    deployment.serverSideEnabled = false;
    delete deployment.serverBotConfigId;
    delete deployment.handoffState;
  }
  for (const row of copy.agentActions ?? []) {
    const action = row as Record<string, unknown>;
    if (action.status === 'pending' || action.status === 'approved') {
      action.status = 'rejected';
      action.resultSummary = 'Restored from backup; previous approval cannot authorize execution in this workspace. Review and propose a new action.';
      delete action.toolBinding;
      delete action.idempotencyKey;
    }
  }
  return copy;
}

export function portableTableCounts(data: BackupPayload['data']): Record<BackupTable, number> {
  return Object.fromEntries(BACKUP_TABLES.map(name => [name, data[name]?.length ?? 0])) as Record<BackupTable, number>;
}
