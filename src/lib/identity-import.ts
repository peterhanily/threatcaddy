/**
 * Identities from a spreadsheet (Data Import). A row whose name or other name already exists in
 * the investigation fills in what is missing on that identity and never overwrites it, so
 * importing the same file twice changes nothing. Organisations named in a row are created when
 * missing; other connections must name an identity that exists or is in the file.
 */
import { nanoid } from 'nanoid';
import type { Identity, IdentityStatus } from '../types';
import type { ColumnMapping } from './data-import';
import { IDENTITY_STATUSES } from './entity-enums';
import {
  CONNECTION_PHRASES, ENGLISH_PHRASE_LABELS, ENGLISH_TYPE_LABELS, MEMBERSHIP_PHRASES, canonicalPhrase, canonicalType, detailKey,
  guessIdentity, isBuiltinType, isConnectionPhrase, isOrganization, isPerson, isPrivateLabel as isPrivateLabelText, labelWords, sameText, withConnection,
  type BuiltinType, type ConnectionPhrase,
} from './identity-model';

const ENGLISH_TYPES = ENGLISH_TYPE_LABELS;
const ENGLISH_PHRASES = ENGLISH_PHRASE_LABELS;
// Anchored on the parenthesis (no leading \s*), so a long run of spaces cannot make them slow.
const PRIVATE_SUFFIX = /\(private\)\s*$/i;
const PUBLIC_SUFFIX = /\(public\)\s*$/i;
/** Export marks detail columns that would otherwise read as a fixed field ("Role (detail)"), as
 * private, or as public although their label is private by default ("Phone (public)"). */
const COLUMN_SUFFIX = /\((?:private|detail|public)\)\s*$/i;
/** A column header without its marker. */
const withoutSuffix = (header: string) => header.replace(COLUMN_SUFFIX, '').trimEnd();
const STATUSES: readonly IdentityStatus[] = IDENTITY_STATUSES;
const MEMBERSHIP = new Set(MEMBERSHIP_PHRASES);
const MAX_ERRORS = 200;
/** A connection phrase (100) and a name (200), with room for spacing. */
const MAX_CONNECTION_LINE = 400;

/** The column, marked "(detail)" or "(private)", where Identities › Export writes details past its 200
 * detail columns, as "label: value" lines; import reads them back under their own labels. */
export const MORE_DETAILS = 'More details';

/** A header as words ("displayName" → "display name", "job_title" → "job title"), for recognising columns. */
const headerKey = (header: string) => labelWords(header).join(' ');

/** Whether a file is an Identities › Export file (its Other names and Connections columns). */
export function isIdentityExport(headers: readonly string[]): boolean {
  const keys = new Set(headers.map(sameText));
  return keys.has('name') && keys.has('other names') && keys.has('connections');
}

/** A detail column whose values import as private (and stay out of the import's summary note):
 * marked "(private)", or a label private by default in English or, via `isPrivateLabel`, in the
 * interface language ("Telefon"), as in the Add form. */
export const isPrivateDetailColumn = (header: string, isPrivateLabel?: (label: string) => boolean) => {
  if (PUBLIC_SUFFIX.test(header)) return false;
  const label = value(withoutSuffix(withoutSuffix(header)));
  return PRIVATE_SUFFIX.test(header) || isPrivateLabelText(label) || !!isPrivateLabel?.(label);
};

/** Whether a file's columns look like a list of identities (as Identities › Export writes one). */
export function looksLikeIdentities(headers: readonly string[]): boolean {
  const keys = headers.map(headerKey);
  return keys.some(key => /^(name|full name|display name)$/.test(key))
    && keys.some(key => /^(type|organi[sz]ation|organi[sz]ation name|company|company name|other names|aliases|job title|status|contact|connections)$/.test(key))
    // Headers are read as words, so "DateTime" and "TimeStamp" arrive as "date time" and "time stamp".
    && !keys.some(key => /^(timestamp|time stamp|time|date|datetime|date time|@timestamp|event time)$/.test(key));
}

/** Columns that, beside a Name column, mark a list of identities: a type, an organisation, other
 * names, a job title, connections, or a detail column as Identities › Export writes it (a Status or
 * Contact column alone does not). */
export function hasIdentityOnlyColumns(headers: readonly string[]): boolean {
  return headers.some(header => COLUMN_SUFFIX.test(header)
    || /^(type|kind|organi[sz]ation|organi[sz]ation name|company|company name|employer|other names|aliases|aka|also known as|job title|connections)$/.test(headerKey(header)));
}

/** The mapping for each column of an identity list; unknown columns become details. */
export function identityMappingFor(header: string): ColumnMapping {
  const key = headerKey(header);
  if (COLUMN_SUFFIX.test(header)) return 'identity-detail';
  if (/^(name|full name|display name)$/.test(key)) return 'identity-name';
  if (/^(type|kind)$/.test(key)) return 'identity-type';
  if (/^(description|job title|title|role)$/.test(key)) return 'identity-description';
  if (/^(organi[sz]ation|organi[sz]ation name|company|company name|employer)$/.test(key)) return 'identity-organization';
  if (/^(other names|aliases|aka|also known as)$/.test(key)) return 'identity-aliases';
  if (key === 'status') return 'identity-status';
  if (key === 'contact') return 'identity-contact';
  if (key === 'connections') return 'identity-connections';
  if (key === 'classification') return 'identity-classification';
  if (key === 'tags') return 'identity-tags';
  if (/^(investigation|created|updated)$/.test(key)) return 'ignore';
  // A column named like a built-in phrase ("reports to", "used by") lists who or what it connects to.
  const phrase = canonicalPhrase(header, ENGLISH_PHRASES);
  if (phrase.label !== header.trim() || Object.hasOwn(CONNECTION_PHRASES, key)) return 'identity-connection';
  return 'identity-detail';
}

/** Undoes the apostrophe a formula-safe export puts before = + - @ (so "+44 …" comes back as written). */
const value = (raw: string | undefined) => (raw ?? '').replace(/^'(?=[=+\-@\t\r])/, '').trim();
const lines = (raw: string | undefined) => value(raw).split(/\r?\n/).map(line => value(line)).filter(Boolean);
const YES = ['yes', 'y', 'true', '1', 'x', '✓'];
const NO = ['no', 'n', 'false', '0', '-'];

/** The interface language's words for types, statuses, connections, yes and no (as the Add form and the
 * profile show them), read besides English: a sheet written in the interface language imports as one in
 * English does. */
export interface ImportWords {
  types?: Readonly<Record<BuiltinType, string>>;
  statuses?: Readonly<Partial<Record<IdentityStatus, string>>>;
  phrases?: Readonly<Record<ConnectionPhrase, string>>;
  reversePhrases?: Readonly<Record<ConnectionPhrase, string>>;
  yes?: string;
  no?: string;
}
/** Reads types, statuses, yes, no and connection phrases in English or the interface language, for the
 * import and its preview alike. Each distinct value is worked out once: a sheet of 100,000 rows holds few. */
function wordReader(words: ImportWords | undefined, typesInUse: readonly string[]) {
  const once = <T>(read: (text: string) => T) => {
    const seen = new Map<string, T>();
    return (text: string): T => { if (!seen.has(text)) seen.set(text, read(text)); return seen.get(text) as T; };
  };
  const statuses = new Map<string, IdentityStatus>();
  for (const status of STATUSES) {
    const label = words?.statuses?.[status];
    if (label) statuses.set(sameText(label), status);
  }
  for (const status of STATUSES) statuses.set(status, status);
  const yes = new Set([...YES, ...(words?.yes ? [sameText(words.yes)] : [])]);
  const no = new Set([...NO, ...(words?.no ? [sameText(words.no)] : [])]);
  return {
    type: once(typed => canonicalType(typed, words?.types ?? ENGLISH_TYPES, typesInUse)),
    status: once((raw): IdentityStatus | undefined => statuses.get(sameText(raw))),
    yes: once(raw => yes.has(sameText(value(raw)))),
    no: once(raw => no.has(sameText(value(raw)))),
    phrase: once(text => canonicalPhrase(text, words?.phrases ?? ENGLISH_PHRASES, words?.reversePhrases)),
  };
}

/** Where a "phrase: name" line splits: a custom phrase or a name may itself hold ": ", so at the first
 * ": " followed by a name `isName` knows, else at the first. */
function splitConnection(line: string, isName: (text: string) => boolean): { phrase: string; name: string } | undefined {
  const splits = [...line.matchAll(/: /g)].map(match => match.index).filter(at => at > 0);
  const at = splits.find(at => isName(line.slice(at + 2))) ?? splits[0];
  return at === undefined ? undefined : { phrase: line.slice(0, at), name: line.slice(at + 2) };
}

export interface IdentityImport {
  created: Identity[];
  /** Fields to change on identities that already existed. */
  updated: Array<{ id: string; changes: Partial<Identity> }>;
  errors: string[];
}

export function buildIdentities(rows: readonly Record<string, string>[], mappings: ReadonlyMap<string, ColumnMapping>, options: {
  /** The level an identity without its own exports as (its investigation's, else the default). */
  inheritedClsLevel?: string;
  folderId: string;
  existing: readonly Identity[];
  clsLevel?: string;
  /** Organisation for rows that name none, given only to identities that belong to no organisation. */
  defaultOrganizationId?: string;
  /** Who imported, recorded as the author of new identities and of the changes. */
  author?: string;
  /** Labels private by default in the interface language. */
  isPrivateLabel?: (label: string) => boolean;
  /** The detail columns a person chose to import as private (the preview's Private choice). When
   * given, it decides for every detail column; otherwise each column's label does. */
  privateColumns?: ReadonlySet<string>;
  /** The interface language's words, read besides English. */
  words?: ImportWords;
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
  // Every identity each name or other name belongs to: a name two identities share is ambiguous,
  // and the import does not choose between them.
  const byName = new Map<string, Set<string>>();
  const remember = (text: string, id: string) => {
    const key = sameText(text);
    if (!key) return;
    const ids = byName.get(key);
    if (ids) ids.add(id); else byName.set(key, new Set([id]));
  };
  for (const identity of records.values()) [identity.name, ...identity.aliases].forEach(text => remember(text, identity.id));
  const owners = (text: string) => [...(byName.get(sameText(text)) ?? [])].map(id => records.get(id) as Identity);
  const find = (text: string) => { const found = owners(text); return found.length === 1 ? found[0] : undefined; };
  const ambiguous = (text: string) => owners(text).length > 1;
  const typesInUse = [...new Set([...records.values()].map(identity => identity.type))];
  const create = (name: string, type: string, clsLevel?: string): Identity => {
    const identity: Identity = { id: nanoid(), folderId: options.folderId, type, name, aliases: [], details: [], connections: [],
      tags: ['data-import'], clsLevel: clsLevel || options.clsLevel, trashed: false, archived: false, createdAt: now, updatedAt: now,
      ...(options.author ? { createdBy: options.author, updatedBy: options.author } : {}) };
    records.set(identity.id, identity);
    created.add(identity.id);
    remember(name, identity.id);
    return identity;
  };
  // The rule the profile, the graph and the AI tools follow: once, never to itself, and "works at" or
  // "belongs to" only toward an organisation. False when refused.
  // What each identity holds, as keys: a value is checked once, not against every earlier one, so a
  // crafted cell of thousands of lines for one identity takes linear time.
  const held = new Map<string, { tags: Set<string>; aliases: Set<string>; details: Map<string, number> }>();
  const detailKeyOf = (label: string, text: string) => `${sameText(label)}\u0000${detailKey(text)}`;
  const holding = (identity: Identity) => {
    let entry = held.get(identity.id);
    if (!entry) {
      identity.tags = [...identity.tags]; // the working copy shares its tags with the stored row until now
      entry = { tags: new Set(identity.tags), aliases: new Set(identity.aliases.map(sameText)),
        details: new Map(identity.details.map((detail, at) => [detailKeyOf(detail.label, detail.value), at])) };
      held.set(identity.id, entry);
    }
    return entry;
  };
  const connect = (from: Identity, to: Identity, label: string) => {
    const next = withConnection(from, to, label);
    if (next) from.connections = next;
    return !!next;
  };

  const [typeColumn] = columns('identity-type');
  const [descriptionColumn] = columns('identity-description');
  const [organizationColumn] = columns('identity-organization');
  const [statusColumn] = columns('identity-status');
  const [contactColumn] = columns('identity-contact');
  const [classificationColumn] = columns('identity-classification');
  // Worked out once per import, not once per row (a header can be long; a file can hold 100,000 rows).
  const aliasColumns = columns('identity-aliases');
  const tagColumns = columns('identity-tags');
  const ownExport = isIdentityExport([...mappings.keys()]);
  const detailColumns = columns('identity-detail').map(column => ({ column, label: value(withoutSuffix(withoutSuffix(column))),
    more: COLUMN_SUFFIX.test(column) && sameText(withoutSuffix(withoutSuffix(column))) === sameText(MORE_DETAILS),
    isPrivate: options.privateColumns ? options.privateColumns.has(column) : isPrivateDetailColumn(column, options.isPrivateLabel) }));
  const read = wordReader(options.words, typesInUse);
  const connectionColumns = columns('identity-connection').map(column => ({ column, phrase: read.phrase(column) }));
  const connectionsColumns = columns('identity-connections');
  const defaultOrganization = options.defaultOrganizationId ? records.get(options.defaultOrganizationId) : undefined;

  // First every identity, so that connections can name any of them.
  rows.forEach((row, index) => {
    const name = value(row[nameColumn]);
    if (!name) { error(`Row ${index + 2}: no name; skipped.`); return; }
    if (ambiguous(name)) { error(`Row ${index + 2}: “${name}” names more than one identity in this investigation; skipped. Merge them, then import again.`); return; }
    const typed = typeColumn ? value(row[typeColumn]) : '';
    // A classification as exported is kept, so a round trip never lowers it; otherwise the investigation's.
    const classification = classificationColumn ? value(row[classificationColumn]).slice(0, 100) : '';
    const identity = find(name) ?? create(name, typed ? read.type(typed) : guessIdentity(name).type, classification);
    // The level the export writes for an identity without its own (its investigation's, else the
    // default) is read back as inherited, not fixed on it.
    if (classification && !identity.clsLevel && classification !== options.inheritedClsLevel) identity.clsLevel = classification;
    const description = descriptionColumn ? value(row[descriptionColumn]) : '';
    if (description && !identity.description) identity.description = description;
    // Tags as exported (one per line) are added to those it has; import never removes one.
    // One tag a line, as exported (a tag may hold a comma); in other tools' files a comma or semicolon also separates tags.
    for (const column of tagColumns) for (const tag of lines(row[column]).flatMap(line => (ownExport ? [line] : line.split(/[,;]/))).map(text => value(text).slice(0, 100)).filter(Boolean)) {
      const { tags } = holding(identity);
      if (!tags.has(tag)) { tags.add(tag); identity.tags.push(tag); }
    }
    const nameKey = sameText(identity.name);
    for (const column of aliasColumns) for (const alias of lines(row[column])) {
      const { aliases } = holding(identity);
      const key = sameText(alias);
      if (key === nameKey || aliases.has(key)) continue;
      // Another identity's name as an other name would make that name ambiguous everywhere.
      if (owners(alias).some(other => other.id !== identity.id)) {
        error(`Row ${index + 2}: “${alias}” is already another identity's name; not added as another name of “${identity.name}”.`);
        continue;
      }
      identity.aliases.push(alias);
      aliases.add(key);
      remember(alias, identity.id);
    }
    const status = statusColumn ? read.status(value(row[statusColumn])) : undefined;
    if (!identity.status && status) identity.status = status;
    if (contactColumn && read.yes(row[contactColumn] ?? '') && !identity.contact) identity.contact = true;
    for (const { column, label: columnLabel, isPrivate, more } of detailColumns) {
      for (const line of lines(row[column])) {
        const at = more ? line.indexOf(': ') : -1;
        const [label, detail] = at > 0 ? [line.slice(0, at).slice(0, 100), line.slice(at + 2)] : [columnLabel, line];
        const { details } = holding(identity);
        const key = detailKeyOf(label, detail);
        const known = details.get(key);
        // Already held: a column imported as private makes it private (never the reverse: import only
        // fills in, and making something public is a person's choice on the profile).
        if (known !== undefined) { if (isPrivate && !identity.details[known].private) identity.details[known] = { ...identity.details[known], private: true }; continue; }
        details.set(key, identity.details.length);
        identity.details.push({ id: nanoid(), label, value: detail, ...(isPrivate ? { private: true } : {}) });
      }
    }
    const organizationName = organizationColumn ? value(row[organizationColumn]) : '';
    // The chosen organisation only fills a gap: someone who already belongs to one keeps theirs.
    const member = identity.connections.some(edge => MEMBERSHIP.has(edge.label));
    let organization = organizationName
      ? find(organizationName) ?? (ambiguous(organizationName) ? undefined : create(organizationName, 'organization'))
      : member ? undefined : defaultOrganization;
    if (organizationName && (!organization || !isOrganization(organization))) {
      error(`Row ${index + 2}: “${organizationName}” is not one organization in this investigation; its organization was skipped.`);
      organization = undefined;
    }
    if (organization && organization.id !== identity.id && !isOrganization(identity)
      && !identity.connections.some(edge => edge.targetId === organization.id && MEMBERSHIP.has(edge.label))) {
      connect(identity, organization, isPerson(identity) ? 'works at' : 'belongs to');
    }
  });

  // Then connections, by the column's phrase or by "phrase: name" lines.
  rows.forEach((row, index) => {
    const identity = find(value(row[nameColumn]));
    if (!identity) return;
    const link = (phraseText: string, targetName: string, phrase = read.phrase(phraseText)) => {
      const target = find(targetName);
      if (!target) {
        error(ambiguous(targetName)
          ? `Row ${index + 2}: “${targetName}” (${phraseText}) names more than one identity in this investigation; that connection was skipped.`
          : `Row ${index + 2}: “${targetName}” (${phraseText}) is not an identity in this investigation; that connection was skipped.`);
        return;
      }
      const [source, other] = phrase.reversed ? [target, identity] : [identity, target];
      if (!connect(source, other, phrase.label) && source.id !== other.id) error(`Row ${index + 2}: “${other.name}” is not an organization, so “${phraseText}” was skipped.`);
    };
    for (const { column, phrase } of connectionColumns) for (const target of lines(row[column])) link(column, target, phrase);
    for (const column of connectionsColumns) for (const line of lines(row[column])) {
      // A phrase and a name: anything far longer is not a connection, and is refused before it is split.
      if (line.length > MAX_CONNECTION_LINE) { error(`Row ${index + 2}: a connection longer than ${MAX_CONNECTION_LINE} characters was skipped.`); continue; }
      const split = splitConnection(line, text => !!find(text));
      if (split) link(split.phrase, split.name);
      else error(`Row ${index + 2}: “${line}” is not “phrase: name”; skipped.`);
    }
  });

  const updated: IdentityImport['updated'] = [];
  for (const [id, before] of original) {
    const after = records.get(id) as Identity;
    const changes: Partial<Identity> = {};
    for (const field of ['description', 'aliases', 'status', 'contact', 'details', 'connections', 'clsLevel', 'tags'] as const) {
      if (JSON.stringify(after[field]) !== JSON.stringify(before[field])) Object.assign(changes, { [field]: after[field] });
    }
    if (Object.keys(changes).length) updated.push({ id, changes: options.author ? { ...changes, updatedBy: options.author } : changes });
  }
  return { created: [...created].map(id => records.get(id) as Identity), updated, errors };
}

/** Values the import will not read as a built-in type, a status, yes or no, or a built-in connection (in
 * English or the interface language), at most `limit` of each, to show before importing: a type is kept
 * as a type of its own, a status or contact value is not imported, a phrase is kept as written. */
export function unrecognisedIdentityValues(rows: readonly Record<string, string>[], mappings: ReadonlyMap<string, ColumnMapping>, options: {
  words?: ImportWords;
  /** Types the investigation already uses: not new. */
  typesInUse?: readonly string[];
  /** Names and other names already in the investigation, to split "phrase: name" lines as the import does. */
  names?: readonly string[];
  limit?: number;
} = {}): { types: string[]; statuses: string[]; contacts: string[]; phrases: string[] } {
  const limit = options.limit ?? 10;
  const found = { types: new Map<string, string>(), statuses: new Map<string, string>(), contacts: new Map<string, string>(), phrases: new Map<string, string>() };
  const note = (kind: keyof typeof found, text: string) => { if (found[kind].size < limit && !found[kind].has(sameText(text))) found[kind].set(sameText(text), text); };
  const columns = (mapping: ColumnMapping) => [...mappings].filter(([, mapped]) => mapped === mapping).map(([column]) => column);
  const typesInUse = options.typesInUse ?? [];
  const inUse = new Set(typesInUse.map(sameText));
  const read = wordReader(options.words, typesInUse);
  const [nameColumn] = columns('identity-name');
  const [typeColumn] = columns('identity-type');
  const [statusColumn] = columns('identity-status');
  const [contactColumn] = columns('identity-contact');
  for (const column of columns('identity-connection')) if (!isConnectionPhrase(read.phrase(column).label)) note('phrases', value(column));
  const connectionsColumns = columns('identity-connections');
  const aliasColumns = columns('identity-aliases');
  // The names the import will know: the investigation's and the file's.
  const names = new Set((options.names ?? []).map(sameText));
  if (connectionsColumns.length) for (const row of rows) [nameColumn ? value(row[nameColumn]) : '', ...aliasColumns.flatMap(column => lines(row[column]))].forEach(text => names.add(sameText(text)));
  for (const row of rows) {
    const typed = typeColumn ? value(row[typeColumn]) : '';
    if (typed && !isBuiltinType(read.type(typed)) && !inUse.has(sameText(typed))) note('types', typed);
    const status = statusColumn ? value(row[statusColumn]) : '';
    if (status && !read.status(status)) note('statuses', status);
    const contact = contactColumn ? value(row[contactColumn]) : '';
    if (contact && !read.yes(contact) && !read.no(contact)) note('contacts', contact);
    for (const column of connectionsColumns) for (const line of lines(row[column])) {
      const split = line.length <= MAX_CONNECTION_LINE ? splitConnection(line, text => names.has(sameText(text))) : undefined;
      if (split && !isConnectionPhrase(read.phrase(split.phrase).label)) note('phrases', split.phrase);
    }
  }
  return { types: [...found.types.values()], statuses: [...found.statuses.values()], contacts: [...found.contacts.values()], phrases: [...found.phrases.values()] };
}
