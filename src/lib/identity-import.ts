/**
 * Identities from a spreadsheet (Data Import). A row whose name or other name already exists in
 * the investigation fills in what is missing on that identity and never overwrites it, so
 * importing the same file twice changes nothing. Organisations named in a row are created when
 * missing; other connections must name an identity that exists or is in the file.
 */
import { nanoid } from 'nanoid';
import type { Identity, IdentityStatus } from '../types';
import type { ColumnMapping } from './data-import';
import {
  BUILTIN_TYPES, CONNECTION_PHRASES, PRIVATE_DETAIL_LABELS, canonicalPhrase, canonicalType, detailKey, guessIdentity,
  isOrganization, isPerson, sameText, type BuiltinType, type ConnectionPhrase,
} from './identity-model';

const ENGLISH_TYPES = Object.fromEntries(BUILTIN_TYPES.map(type => [type, type])) as Record<BuiltinType, string>;
const ENGLISH_PHRASES = Object.fromEntries(Object.keys(CONNECTION_PHRASES).map(phrase => [phrase, phrase])) as Record<ConnectionPhrase, string>;
/** Phone, address and similar labels start out private, as when added by hand (in English). */
const PRIVATE_LABELS = new Set(PRIVATE_DETAIL_LABELS.map(key => sameText(key.replace(/([A-Z])/g, ' $1'))));
const PRIVATE_SUFFIX = /\s*\(private\)\s*$/i;
const STATUSES: readonly IdentityStatus[] = ['compromised', 'suspicious', 'cleared'];
const MEMBERSHIP = new Set(['works at', 'belongs to']);
const MAX_ERRORS = 200;

/** Whether a file's columns look like a list of identities (as Identities › Export writes one). */
export function looksLikeIdentities(headers: readonly string[]): boolean {
  const keys = headers.map(sameText);
  return keys.some(key => /^(name|full name|display name)$/.test(key))
    && keys.some(key => /^(type|organi[sz]ation|company|other names|aliases|job title|status|contact|connections)$/.test(key))
    && !keys.some(key => /^(timestamp|time|date|datetime|@timestamp|event time)$/.test(key));
}

/** The mapping for each column of an identity list; unknown columns become details. */
export function identityMappingFor(header: string): ColumnMapping {
  const key = sameText(header);
  if (/^(name|full name|display name)$/.test(key)) return 'identity-name';
  if (/^(type|kind)$/.test(key)) return 'identity-type';
  if (/^(description|job title|title|role)$/.test(key)) return 'identity-description';
  if (/^(organi[sz]ation|company|employer)$/.test(key)) return 'identity-organization';
  if (/^(other names|aliases|aka|also known as)$/.test(key)) return 'identity-aliases';
  if (key === 'status') return 'identity-status';
  if (key === 'contact') return 'identity-contact';
  if (key === 'connections') return 'identity-connections';
  if (/^(investigation|classification|created|updated)$/.test(key)) return 'ignore';
  // A column named like a built-in phrase ("reports to", "used by") lists who or what it connects to.
  const phrase = canonicalPhrase(header, ENGLISH_PHRASES);
  if (phrase.label !== header.trim() || Object.hasOwn(CONNECTION_PHRASES, key)) return 'identity-connection';
  return 'identity-detail';
}

/** Undoes the apostrophe a formula-safe export puts before = + - @ (so "+44 …" comes back as written). */
const value = (raw: string | undefined) => (raw ?? '').replace(/^'(?=[=+\-@\t\r])/, '').trim();
const lines = (raw: string | undefined) => value(raw).split(/\r?\n/).map(line => value(line)).filter(Boolean);
const truthy = (raw: string | undefined) => /^(yes|y|true|1|x|✓)$/i.test(value(raw));

export interface IdentityImport {
  created: Identity[];
  /** Fields to change on identities that already existed. */
  updated: Array<{ id: string; changes: Partial<Identity> }>;
  errors: string[];
}

export function buildIdentities(rows: readonly Record<string, string>[], mappings: ReadonlyMap<string, ColumnMapping>, options: {
  folderId: string;
  existing: readonly Identity[];
  clsLevel?: string;
  /** Organisation for rows that name none. */
  defaultOrganizationId?: string;
  now?: number;
}): IdentityImport {
  const now = options.now ?? Date.now();
  const columns = (mapping: ColumnMapping) => [...mappings].filter(([, mapped]) => mapped === mapping).map(([column]) => column);
  const [nameColumn] = columns('identity-name');
  const errors: string[] = [];
  const error = (message: string) => { if (errors.length < MAX_ERRORS) errors.push(message); };
  if (!nameColumn) return { created: [], updated: [], errors: ['Map a column to “Identity: Name” to import identities.'] };

  // Working copies of the investigation's identities, then the new ones, found by any name.
  const original = new Map(options.existing.filter(identity => identity.folderId === options.folderId && !identity.trashed).map(identity => [identity.id, identity]));
  const records = new Map([...original].map(([id, identity]) => [id, { ...identity, aliases: [...identity.aliases], details: [...identity.details], connections: [...identity.connections] }]));
  const created = new Set<string>();
  const byName = new Map<string, string>();
  const remember = (text: string, id: string) => { const key = sameText(text); if (key && !byName.has(key)) byName.set(key, id); };
  for (const identity of records.values()) [identity.name, ...identity.aliases].forEach(text => remember(text, identity.id));
  const find = (text: string) => { const id = byName.get(sameText(text)); return id ? records.get(id) : undefined; };
  const typesInUse = [...new Set([...records.values()].map(identity => identity.type))];
  const create = (name: string, type: string): Identity => {
    const identity: Identity = { id: nanoid(), folderId: options.folderId, type, name, aliases: [], details: [], connections: [],
      tags: ['data-import'], clsLevel: options.clsLevel, trashed: false, archived: false, createdAt: now, updatedAt: now };
    records.set(identity.id, identity);
    created.add(identity.id);
    remember(name, identity.id);
    return identity;
  };
  const connect = (from: Identity, to: Identity, label: string) => {
    if (from.id !== to.id && !from.connections.some(edge => edge.targetId === to.id && edge.label === label)) from.connections.push({ targetId: to.id, label });
  };

  const [typeColumn] = columns('identity-type');
  const [descriptionColumn] = columns('identity-description');
  const [organizationColumn] = columns('identity-organization');
  const [statusColumn] = columns('identity-status');
  const [contactColumn] = columns('identity-contact');
  const defaultOrganization = options.defaultOrganizationId ? records.get(options.defaultOrganizationId) : undefined;

  // First every identity, so that connections can name any of them.
  rows.forEach((row, index) => {
    const name = value(row[nameColumn]);
    if (!name) { error(`Row ${index + 2}: no name; skipped.`); return; }
    const typed = typeColumn ? value(row[typeColumn]) : '';
    const identity = find(name) ?? create(name, typed ? canonicalType(typed, ENGLISH_TYPES, typesInUse) : guessIdentity(name).type);
    const description = descriptionColumn ? value(row[descriptionColumn]) : '';
    if (description && !identity.description) identity.description = description;
    for (const column of columns('identity-aliases')) for (const alias of lines(row[column])) {
      if (sameText(alias) === sameText(identity.name) || identity.aliases.some(known => sameText(known) === sameText(alias))) continue;
      identity.aliases.push(alias);
      remember(alias, identity.id);
    }
    const status = statusColumn ? sameText(value(row[statusColumn])) : '';
    if (!identity.status && STATUSES.includes(status as IdentityStatus)) identity.status = status as IdentityStatus;
    if (contactColumn && truthy(row[contactColumn]) && !identity.contact) identity.contact = true;
    for (const column of columns('identity-detail')) {
      const label = column.replace(PRIVATE_SUFFIX, '').trim();
      const isPrivate = PRIVATE_SUFFIX.test(column) || PRIVATE_LABELS.has(sameText(label));
      for (const detail of lines(row[column])) {
        if (identity.details.some(known => sameText(known.label) === sameText(label) && detailKey(known.value) === detailKey(detail))) continue;
        identity.details.push({ id: nanoid(), label, value: detail, ...(isPrivate ? { private: true } : {}) });
      }
    }
    const organizationName = organizationColumn ? value(row[organizationColumn]) : '';
    const organization = organizationName
      ? find(organizationName) ?? create(organizationName, 'organization')
      : defaultOrganization;
    if (organization && organization.id !== identity.id && !isOrganization(identity)
      && !identity.connections.some(edge => edge.targetId === organization.id && MEMBERSHIP.has(edge.label))) {
      connect(identity, organization, isPerson(identity) ? 'works at' : 'belongs to');
    }
  });

  // Then connections, by the column's phrase or by "phrase: name" lines.
  rows.forEach((row, index) => {
    const identity = find(value(row[nameColumn]));
    if (!identity) return;
    const link = (phraseText: string, targetName: string) => {
      const target = find(targetName);
      if (!target) { error(`Row ${index + 2}: “${targetName}” (${phraseText}) is not an identity in this investigation; that connection was skipped.`); return; }
      const { label, reversed } = canonicalPhrase(phraseText, ENGLISH_PHRASES);
      if (reversed) connect(target, identity, label); else connect(identity, target, label);
    };
    for (const column of columns('identity-connection')) for (const target of lines(row[column])) link(column, target);
    for (const column of columns('identity-connections')) for (const line of lines(row[column])) {
      const at = line.indexOf(': ');
      if (at > 0) link(line.slice(0, at), line.slice(at + 2));
      else error(`Row ${index + 2}: “${line}” is not “phrase: name”; skipped.`);
    }
  });

  const updated: IdentityImport['updated'] = [];
  for (const [id, before] of original) {
    const after = records.get(id) as Identity;
    const changes: Partial<Identity> = {};
    for (const field of ['description', 'aliases', 'status', 'contact', 'details', 'connections'] as const) {
      if (JSON.stringify(after[field]) !== JSON.stringify(before[field])) Object.assign(changes, { [field]: after[field] });
    }
    if (Object.keys(changes).length) updated.push({ id, changes });
  }
  return { created: [...created].map(id => records.get(id) as Identity), updated, errors };
}
