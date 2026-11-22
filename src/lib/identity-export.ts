/**
 * Identities as a spreadsheet: one row per identity and one column per detail label, so the
 * file reads naturally and imports straight back (Data Import › Identities). Private details
 * are left out unless the analyst asks for them. Every cell is formula-safe.
 */
import type { Folder, Identity } from '../types';
import { escapeCSVField } from './ioc-export';
import { byName, organizationOf, sameText } from './identity-model';
import { identityMappingFor } from './identity-import';

export const IDENTITY_CSV_COLUMNS = ['Name', 'Type', 'Investigation', 'Status', 'Contact', 'Description', 'Organization', 'Other names'] as const;
const TRAILING_COLUMNS = ['Connections', 'Classification', 'Created', 'Updated'] as const;

export function identitiesToCsv(identities: readonly Identity[], options: {
  byId: ReadonlyMap<string, Identity>;
  folders: readonly Folder[];
  includePrivate?: boolean;
}): string {
  const rows = [...identities].filter(identity => !identity.trashed).sort(byName);
  // Organisations and connections name only identities in the file, so importing it never
  // recreates one that was left out (archived, trashed or in another investigation).
  const exported = new Map(rows.map(identity => [identity.id, identity]));
  const shown = (identity: Identity) => identity.details.filter(detail => options.includePrivate || !detail.private);
  // One column per detail label, in the order labels first appear (labels differing only in case share
  // one). Private values get their own "(private)" column, so importing the file keeps them private.
  const columns: Array<{ label: string; private: boolean }> = [];
  for (const identity of rows) for (const detail of shown(identity)) {
    const isPrivate = !!detail.private;
    if (!columns.some(column => column.private === isPrivate && sameText(column.label) === sameText(detail.label))) columns.push({ label: detail.label.trim(), private: isPrivate });
  }
  // A label that would read as a fixed field on import ("Role", "Type") is marked as a detail.
  const header = [...IDENTITY_CSV_COLUMNS, ...columns.map(column => (column.private ? `${column.label} (private)`
    : identityMappingFor(column.label) === 'identity-detail' ? column.label : `${column.label} (detail)`)), ...TRAILING_COLUMNS];
  const lines = [header.map(escapeCSVField).join(',')];
  for (const identity of rows) {
    const values = (column: { label: string; private: boolean }) => shown(identity)
      .filter(detail => !!detail.private === column.private && sameText(detail.label) === sameText(column.label)).map(detail => detail.value).join('\n');
    const connections = identity.connections.map(connection => {
      const target = exported.get(connection.targetId);
      return target ? `${connection.label}: ${target.name}` : '';
    }).filter(Boolean).join('\n');
    const organization = organizationOf(identity, options.byId);
    const cells = [
      identity.name,
      identity.type,
      options.folders.find(folder => folder.id === identity.folderId)?.name ?? '',
      identity.status ?? '',
      identity.contact ? 'yes' : '',
      identity.description ?? '',
      organization && exported.has(organization.id) ? organization.name : '',
      identity.aliases.join('\n'),
      ...columns.map(values),
      connections,
      identity.clsLevel ?? '',
      new Date(identity.createdAt).toISOString(),
      new Date(identity.updatedAt).toISOString(),
    ];
    lines.push(cells.map(escapeCSVField).join(','));
  }
  // A byte-order mark so spreadsheet programs read names in any script correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
