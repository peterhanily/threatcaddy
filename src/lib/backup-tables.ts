/** Portable entity tables; internal queues and credentials cannot be selected by a caller-provided name. */
export const BACKUP_TABLES = [
  'notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards',
  'standaloneIOCs', 'evidenceItems', 'chatThreads', 'agentActions', 'agentProfiles',
  'agentDeployments', 'agentMeetings', 'noteTemplates', 'playbookTemplates',
  'integrationTemplates', 'installedIntegrations', 'customSlashCommands',
] as const;

export type BackupTable = typeof BACKUP_TABLES[number];

export function isBackupTable(value: string): value is BackupTable {
  return (BACKUP_TABLES as readonly string[]).includes(value);
}

export function investigationOf(table: BackupTable, row: Record<string, unknown>): unknown {
  if (table === 'folders') return row.id;
  if (['agentActions', 'agentDeployments', 'agentMeetings'].includes(table)) return row.investigationId;
  return row.folderId;
}

export function parseEntityScope(scopeId: string | undefined): { table: BackupTable; id: string } {
  const separator = scopeId?.indexOf(':') ?? -1;
  const table = scopeId?.slice(0, separator) ?? '';
  const id = scopeId?.slice(separator + 1) ?? '';
  if (separator < 1 || !isBackupTable(table) || !id.trim()) {
    throw new Error('Entity scope must identify a supported table and entity: tableName:entityId.');
  }
  return { table, id };
}
