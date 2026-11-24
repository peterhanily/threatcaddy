/**
 * Identities as a spreadsheet: one row per identity and one column per detail label, so the
 * file reads naturally and imports straight back (Data Import › Identities). Private details
 * are left out unless the analyst asks for them. Every cell is formula-safe.
 */
import type { Folder, Identity } from '../types';
import { escapeCSVField } from './ioc-export';
import { isPrivateLabel, organizationOf, sameText, sortedByName } from './identity-model';
import { identityMappingFor } from './identity-import';

export const IDENTITY_CSV_COLUMNS = ['Name', 'Type', 'Investigation', 'Status', 'Contact', 'Description', 'Organization', 'Other names'] as const;
const TRAILING_COLUMNS = ['Connections', 'Classification', 'Created', 'Updated'] as const;
/** A detail label in a column header, at most (a synced label can be far longer; labels people and
 * tools write are far shorter, so they round-trip). */
const MAX_LABEL = 500;
/** Detail labels with a column of their own, at most; the rest share one column as "label: value"
 * lines, so a file of thousands of distinct labels stays a spreadsheet of a sane width. */
const MAX_DETAIL_COLUMNS = 200;
const MORE_DETAILS = 'More details';

export function identitiesToCsv(identities: readonly Identity[], options: {
  byId: ReadonlyMap<string, Identity>;
  folders: readonly Folder[];
  includePrivate?: boolean;
  /** Labels private by default in the interface language, as well as in English (for "(public)"). */
  isPrivateLabel?: (label: string) => boolean;
}): string {
  const rows = sortedByName(identities.filter(identity => !identity.trashed));
  // Organisations and connections name only identities in the file, so importing it never
  // recreates one that was left out (archived, trashed or in another investigation).
  const exported = new Map(rows.map(identity => [identity.id, identity]));
  const shown = (identity: Identity) => identity.details.filter(detail => options.includePrivate || !detail.private);
  // One column per detail label, in the order labels first appear (labels differing only in case share
  // one). Private values get their own "(private)" column, so importing the file keeps them private.
  // Found by a set, not by scanning the columns for every detail; a label is capped like a name.
  const columnKey = (detail: { label: string; private?: boolean }) => `${detail.private ? 1 : 0}:${sameText(detail.label)}`;
  const columns: Array<{ label: string; private: boolean; key: string }> = [];
  const seen = new Set<string>();
  const headings = new Set<string>();
  for (const identity of rows) for (const detail of shown(identity)) {
    const key = columnKey(detail);
    if (seen.has(key) || seen.size >= MAX_DETAIL_COLUMNS) continue;
    seen.add(key);
    // Two long labels alike in their first MAX_LABEL characters still get two headers.
    const cut = detail.label.trim().slice(0, MAX_LABEL).replace(/[\uD800-\uDBFF]$/, '');
    let label = cut;
    for (let n = 2; headings.has(`${detail.private ? 1 : 0}:${sameText(label)}`); n++) label = `${cut} ${n}`;
    headings.add(`${detail.private ? 1 : 0}:${sameText(label)}`);
    columns.push({ label, private: !!detail.private, key });
  }
  // A label that would read as a fixed field on import ("Role", "Type") is marked as a detail.
  // A public detail whose label is private by default ("Phone" made public) is marked "(public)", so
  // it imports back public.
  // Details past the column limit, as "label: value" lines; a private one keeps its own column.
  const overflow = (identity: Identity, isPrivate: boolean) => shown(identity)
    .filter(detail => !!detail.private === isPrivate && !seen.has(columnKey(detail))).map(detail => `${detail.label}: ${detail.value}`).join('\n');
  const more = [false, true].filter(isPrivate => rows.some(identity => overflow(identity, isPrivate)));
  const header = [...IDENTITY_CSV_COLUMNS, ...columns.map(column => (column.private ? `${column.label} (private)`
    : isPrivateLabel(column.label) || options.isPrivateLabel?.(column.label) ? `${column.label} (public)`
    : identityMappingFor(column.label) === 'identity-detail' ? column.label : `${column.label} (detail)`)),
    ...more.map(isPrivate => (isPrivate ? `${MORE_DETAILS} (private)` : `${MORE_DETAILS} (detail)`)), ...TRAILING_COLUMNS];
  const lines = [header.map(escapeCSVField).join(',')];
  for (const identity of rows) {
    const byColumn = new Map<string, string[]>();
    for (const detail of shown(identity)) {
      const key = columnKey(detail);
      const values = byColumn.get(key);
      if (values) values.push(detail.value); else byColumn.set(key, [detail.value]);
    }
    const values = (column: { key: string }) => (byColumn.get(column.key) ?? []).join('\n');
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
      ...more.map(isPrivate => overflow(identity, isPrivate)),
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
