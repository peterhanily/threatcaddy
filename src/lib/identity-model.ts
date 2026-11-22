/**
 * Pure helpers behind the Identities view: types, connection phrases, organisations and
 * their charts, search, masking of private details, and the names found in an
 * investigation that are not identities yet. No storage or React here.
 */
import type { Identity, IdentityDetail, StandaloneIOC, TimelineEvent } from '../types';

/** Built-in types are stored as these keys and translated for display; any other word is kept as typed. */
export const BUILTIN_TYPES = ['person', 'organization', 'system', 'account'] as const;
export type BuiltinType = typeof BUILTIN_TYPES[number];
export const isBuiltinType = (type: string): type is BuiltinType => (BUILTIN_TYPES as readonly string[]).includes(type);
export const isPerson = (identity: Pick<Identity, 'type'>) => identity.type === 'person';
export const isOrganization = (identity: Pick<Identity, 'type'>) => identity.type === 'organization';

/** Built-in connection phrases, stored as these English values so charts and both-sided
 * reading work in every language. The value is the i18n key under `connection.`. */
export const CONNECTION_PHRASES = {
  'works at': 'worksAt', 'reports to': 'reportsTo', uses: 'uses', administers: 'administers', 'belongs to': 'belongsTo',
  'logs on to': 'logsOnTo', 'communicated with': 'communicatedWith', impersonated: 'impersonated', paid: 'paid',
} as const;
export type ConnectionPhrase = keyof typeof CONNECTION_PHRASES;
/** How each built-in phrase reads from the other side. "communicated with" reads the same. */
const REVERSE_PHRASES: Readonly<Record<ConnectionPhrase, string>> = {
  'works at': 'employs', 'reports to': 'manages', uses: 'used by', administers: 'administered by', 'belongs to': 'owns',
  'logs on to': 'logged on to by', 'communicated with': 'communicated with', impersonated: 'impersonated by', paid: 'paid by',
};
export const isConnectionPhrase = (label: string): label is ConnectionPhrase => Object.hasOwn(CONNECTION_PHRASES, label);
/** Phrases that tie a person, system or account to an organisation. */
export const MEMBERSHIP_PHRASES: readonly string[] = ['works at', 'belongs to'];
const MEMBERSHIP = MEMBERSHIP_PHRASES;
/** The built-in types and phrases keyed to themselves: how import and the AI tools read English. */
export const ENGLISH_TYPE_LABELS = Object.fromEntries(BUILTIN_TYPES.map(type => [type, type])) as Record<BuiltinType, string>;
export const ENGLISH_PHRASE_LABELS = Object.fromEntries(Object.keys(CONNECTION_PHRASES).map(phrase => [phrase, phrase])) as Record<ConnectionPhrase, string>;

/** Detail labels offered in forms (i18n keys under `detailLabel.`). Labels are stored as typed. */
export const DETAIL_LABELS = ['email', 'phone', 'username', 'handle', 'ipAddress', 'hostname', 'domain', 'iban', 'assetTag', 'website', 'address'] as const;
/** Details with these labels start out private (i18n keys under `detailLabel.`). */
export const PRIVATE_DETAIL_LABELS = ['phone', 'address', 'personalEmail', 'homeAddress', 'dateOfBirth'] as const;
/** A label as lower-case words: camelCase, underscores, dots, brackets and the like all separate
 * words, so "MobilePhone", "home_phone", "telephoneNumber" and "Phone [Optional]" read naturally. */
export function labelWords(label: string): string[] {
  return label.normalize('NFC')
    // "IPv4"/"IPv6" are single words, not "I" + "Pv4".
    .replace(/IPv(?=[46])/g, 'ipv')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
/** Any one of these words makes a label private: phones, street addresses, birth dates, government
 * numbers and special categories of personal data, in English and the main European languages
 * (accents ignored: "Teléfono", "Dirección", "Geburtsdatum"). */
const PRIVATE_WORDS = new Set([
  'phone', 'phones', 'telephone', 'tel', 'mobile', 'cell', 'cellphone', 'fax', 'sms', 'whatsapp', 'pager', 'landline',
  'street', 'postcode', 'zip', 'zipcode', 'postal', 'pobox', 'birth', 'birthday', 'birthdate', 'dob',
  'passport', 'ssn', 'nino', 'nhs', 'medicare', 'aadhaar', 'pps', 'dni', 'nie', 'cpf', 'bsn', 'nir', 'nss',
  'gender', 'sex', 'ethnicity', 'religion', 'medical', 'health', 'disability', 'salary',
  // German, Spanish, French, Italian, Portuguese and Dutch
  'telefon', 'telefonnummer', 'handy', 'handynummer', 'mobil', 'mobilnummer', 'mobiltelefon', 'adresse', 'anschrift', 'geburtsdatum',
  'geburtstag', 'postleitzahl', 'plz', 'strasse', 'ausweis', 'ausweisnummer', 'steuernummer', 'sozialversicherungsnummer', 'reisepass',
  'telefono', 'movil', 'celular', 'direccion', 'domicilio', 'calle', 'nacimiento', 'pasaporte',
  'domicile', 'naissance', 'passeport', 'cellulare', 'indirizzo', 'nascita', 'passaporto', 'residenza',
  'telefone', 'endereco', 'morada', 'nascimento', 'passaporte', 'telefoon', 'telefoonnummer', 'mobiel', 'adres', 'woonadres',
  'geboortedatum', 'paspoort',
]);
/** Words that make "address", "mobile", "health" and the like name a mailbox, a network, a system or
 * attacker infrastructure rather than a person ("Email address", "Sender address", "IPv4 address",
 * "C2 address", "Mobile device ID", "Phone model", "Health check URL"): such a label stays public. */
const NOT_PERSONAL_WORDS = new Set([
  'email', 'mail', 'e', 'smtp', 'proxy', 'sender', 'from', 'reply', 'to', 'cc', 'bcc', 'recipient', 'return', 'sip',
  'correo', 'courriel', 'elettronica', 'electronica', 'electronico', 'eletronico',
  'ip', 'ipv4', 'ipv6', 'mac', 'dns', 'gateway', 'broadcast', 'multicast', 'source', 'destination', 'remote', 'local', 'nat',
  'web', 'url', 'uri', 'wallet', 'bitcoin', 'btc', 'eth', 'crypto', 'server', 'host', 'network', 'ethernet', 'wifi',
  'c2', 'callback', 'beacon', 'listener', 'implant', 'payload',
  'device', 'app', 'application', 'os', 'platform', 'model', 'brand', 'check', 'endpoint', 'status', 'monitor', 'tower', 'service',
]);
/** Whether a detail label starts out private: by its words (from a form, an AI tool or a spreadsheet
 * header such as "MobilePhone", "Street address" or "Telefonnummer"), or as one of `translated`
 * (the interface language's private labels). */
export function isPrivateLabel(label: string, translated: readonly string[] = []): boolean {
  const words = labelWords(label).map(word => word.normalize('NFKD').replace(/\p{M}/gu, ''));
  const has = (...wanted: string[]) => wanted.some(word => words.includes(word));
  const personal = !words.some(word => NOT_PERSONAL_WORDS.has(word));
  if (personal && words.some(word => PRIVATE_WORDS.has(word))) return true;
  if (personal && has('address', 'addresses')) return true;
  if (words.join('') === 'dob') return true; // "D.O.B."
  if (has('post') && has('code', 'box')) return true;
  if (has('po') && has('box')) return true;
  if (has('contact') && has('number', 'no')) return true;
  if (has('email', 'mail', 'emails') && has('personal', 'private', 'home')) return true;
  if (has('social') && has('security', 'insurance')) return true;
  if (has('national', 'government') && has('insurance', 'id', 'identity', 'identification', 'number')) return true;
  if (has('ni') && has('number', 'no')) return true;
  if (has('sin') && (words.length === 1 || has('number', 'no'))) return true;
  if (has('identity', 'id') && has('card', 'document')) return true;
  if (has('identity') && has('number')) return true;
  if (has('personal') && has('id', 'number', 'code', 'identity')) return true;
  if (has('tax') && has('id', 'number', 'code', 'file')) return true;
  if (has('codice') && has('fiscale')) return true;
  if (has('visa') && has('number', 'no')) return true;
  if (has('driver', 'drivers', 'driving') && has('license', 'licence')) return true;
  if (has('kin') || (has('emergency') && has('contact'))) return true;
  const key = sameText(label);
  return translated.some(text => sameText(text) === key);
}

/** Lower case, single spaces, trimmed: how names and details are compared. */
export const sameText = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
/** How detail values are compared: also without spaces, so "GB33 BUKB 2020…" matches "GB33BUKB2020…". */
export const detailKey = (text: string) => sameText(text).replace(/\s/g, '');
/** Also ignores accents, for "looks like" suggestions that a person confirms. */
export const looseText = (text: string) => sameText(text).normalize('NFKD').replace(/\p{M}/gu, '');

/** English spellings of built-in types besides their keys. */
const TYPE_SPELLINGS: Readonly<Record<string, BuiltinType>> = { organisation: 'organization' };

/** The type a person typed or picked: a built-in key when it names one (in English or in
 * the interface language), otherwise a type already in use with other letter case, otherwise as typed. */
export function canonicalType(input: string, builtinLabels: Readonly<Record<BuiltinType, string>>, typesInUse: readonly string[]): string {
  const text = input.trim();
  const key = sameText(text);
  const builtin = (Object.hasOwn(TYPE_SPELLINGS, key) ? TYPE_SPELLINGS[key] : undefined) ?? BUILTIN_TYPES.find(type => type === key || sameText(builtinLabels[type]) === key);
  if (builtin) return builtin;
  return typesInUse.find(type => sameText(type) === key) ?? text;
}

/**
 * The built-in phrase a person typed or picked (in English or the interface language), or the
 * text as typed. Typing the other side's wording ("manages", as the profile shows it) gives the
 * built-in phrase with `reversed`, so the edge is stored on the other identity ("reports to").
 */
export function canonicalPhrase(input: string, phraseLabels: Readonly<Record<ConnectionPhrase, string>>,
  reverseLabels?: Readonly<Record<ConnectionPhrase, string>>): { label: string; reversed: boolean } {
  const key = sameText(input);
  const phrases = Object.keys(CONNECTION_PHRASES) as ConnectionPhrase[];
  const forward = phrases.find(phrase => phrase === key || sameText(phraseLabels[phrase]) === key);
  if (forward) return { label: forward, reversed: false };
  const backward = phrases.find(phrase => sameText(REVERSE_PHRASES[phrase]) === key || (reverseLabels && sameText(reverseLabels[phrase]) === key));
  if (backward) return { label: backward, reversed: backward !== 'communicated with' };
  return { label: input.trim(), reversed: false };
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]];
  const second = parts.length > 1 ? [...parts[parts.length - 1]][0] : first[1] ?? '';
  return (first[0] + second).toUpperCase();
}

/** What a hidden private detail shows: enough to recognise it, never the whole value.
 * `full` hides every character, for screensharing. */
export function maskDetail(detail: Pick<IdentityDetail, 'label' | 'value'>, full = false): string {
  if (full) return '•••••••';
  const digits = detail.value.replace(/\D/g, '');
  if (/\b(?:phone|tel|mobile|cell)\b/i.test(detail.label) && digits.length >= 6) return `•••• ${digits.slice(-4)}`;
  // Only a real email address keeps its domain; any other value shows nothing.
  return isEmail(detail.value.trim()) ? `${[...detail.value][0]}•••••${detail.value.slice(detail.value.indexOf('@'))}` : '•••••••';
}

const live = (identity: Identity) => !identity.trashed;

/** The organisation a person works at, or a system or account belongs to. */
export function organizationOf(identity: Identity, byId: ReadonlyMap<string, Identity>): Identity | undefined {
  for (const edge of identity.connections) {
    const target = MEMBERSHIP.includes(edge.label) ? byId.get(edge.targetId) : undefined;
    if (target && live(target) && isOrganization(target) && target.folderId === identity.folderId) return target;
  }
  return undefined;
}

/** Moves the membership edge from one organisation to another, leaving every other connection
 * (including membership of further organisations) untouched. */
export function withOrganization(identity: Identity, previousId: string | undefined, nextId: string | undefined) {
  if (previousId === nextId) return identity.connections;
  const kept = identity.connections.filter(edge => !(previousId && edge.targetId === previousId && MEMBERSHIP.includes(edge.label)));
  if (!nextId || nextId === identity.id || kept.some(edge => edge.targetId === nextId && MEMBERSHIP.includes(edge.label))) return kept;
  return [...kept, { targetId: nextId, label: isPerson(identity) ? 'works at' : 'belongs to' }];
}

export const byName = (a: Identity, b: Identity) => sameText(a.name).localeCompare(sameText(b.name)) || a.id.localeCompare(b.id);

/** An organisation's people (contacts first) and its systems and accounts. */
export function membersOf(organization: Identity, identities: readonly Identity[]) {
  const members = identities.filter(identity => live(identity) && identity.id !== organization.id && identity.folderId === organization.folderId
    && identity.connections.some(edge => edge.targetId === organization.id && MEMBERSHIP.includes(edge.label)));
  return {
    people: members.filter(isPerson).sort((a, b) => Number(!!b.contact) - Number(!!a.contact) || byName(a, b)),
    things: members.filter(identity => !isPerson(identity)).sort(byName),
  };
}

export interface ShownConnection {
  other: Identity;
  /** The phrase as stored. */
  label: string;
  /** True when this identity holds the edge ("Dana reports to Lee"); false when the other one does. */
  outgoing: boolean;
  /** The identity that holds the edge, and the edge's position in its list. */
  ownerId: string;
  index: number;
}

/** Connections from both sides. An organisation's members are listed under People instead. */
export function connectionsOf(identity: Identity, byId: ReadonlyMap<string, Identity>, identities: readonly Identity[]): ShownConnection[] {
  const shown: ShownConnection[] = [];
  identity.connections.forEach((edge, index) => {
    const other = byId.get(edge.targetId);
    if (other && live(other)) shown.push({ other, label: edge.label, outgoing: true, ownerId: identity.id, index });
  });
  for (const other of identities) {
    if (other.id === identity.id || !live(other)) continue;
    other.connections.forEach((edge, index) => {
      if (edge.targetId !== identity.id) return;
      if (isOrganization(identity) && MEMBERSHIP.includes(edge.label)) return;
      shown.push({ other, label: edge.label, outgoing: false, ownerId: other.id, index });
    });
  }
  return shown;
}

export interface OrgChart {
  organization: Identity;
  /** People with nobody above them and someone below. */
  roots: Identity[];
  /** People with neither a manager nor a report recorded. */
  unplaced: Identity[];
  reportsOf: (person: Identity) => Identity[];
  /** Everyone below, at any depth. */
  teamSize: (person: Identity) => number;
  /** Whether a team should open by default: someone in it is flagged or is a contact. */
  flagged: (person: Identity) => boolean;
}

/** Everyone at an organisation (as listed under its People), arranged by "reports to" between them. */
export function orgChart(organization: Identity, identities: readonly Identity[]): OrgChart {
  const people = membersOf(organization, identities).people;
  const ids = new Set(people.map(person => person.id));
  const manager = new Map<string, string>();
  for (const person of people) {
    const edge = person.connections.find(edge => edge.label === 'reports to' && ids.has(edge.targetId) && edge.targetId !== person.id);
    if (edge) manager.set(person.id, edge.targetId);
  }
  // A reporting loop has no top: break it at the first person met, so everyone still appears.
  for (const person of people) {
    const seen = new Set<string>();
    let current: string | undefined = person.id;
    while (current && manager.has(current)) {
      if (seen.has(current)) { manager.delete(current); break; }
      seen.add(current);
      current = manager.get(current);
    }
  }
  const reports = new Map<string, Identity[]>();
  for (const person of people) {
    const above = manager.get(person.id);
    if (above) reports.set(above, [...(reports.get(above) ?? []), person]);
  }
  for (const list of reports.values()) list.sort(byName);
  const reportsOf = (person: Identity) => reports.get(person.id) ?? [];
  const teamSize = (person: Identity): number => reportsOf(person).reduce((sum, report) => sum + 1 + teamSize(report), 0);
  const flagged = (person: Identity): boolean => person.status === 'compromised' || person.status === 'suspicious' || !!person.contact || reportsOf(person).some(flagged);
  return {
    organization,
    roots: people.filter(person => !manager.has(person.id) && reports.has(person.id)).sort(byName),
    unplaced: people.filter(person => !manager.has(person.id) && !reports.has(person.id)).sort(byName),
    reportsOf, teamSize, flagged,
  };
}

/** Organisations with at least one person, as listed under their People. */
export function chartableOrganizations(identities: readonly Identity[]): Identity[] {
  // One pass over the people (as membersOf counts them), not one per organisation: a staff list
  // can hold 20,000 identities and a thousand organisations.
  const byId = new Map(identities.map(identity => [identity.id, identity]));
  const withPeople = new Set<string>();
  for (const person of identities) {
    if (!live(person) || !isPerson(person)) continue;
    for (const edge of person.connections) {
      const organization = MEMBERSHIP.includes(edge.label) ? byId.get(edge.targetId) : undefined;
      if (organization && organization.id !== person.id && organization.folderId === person.folderId) withPeople.add(organization.id);
    }
  }
  return identities.filter(organization => live(organization) && isOrganization(organization) && withPeople.has(organization.id)).sort(byName);
}

/** Search over the name, other names, description, type and details that are not private. */
export function identityMatches(identity: Identity, query: string, typeLabel: string): boolean {
  const wanted = looseText(query);
  if (!wanted) return true;
  return [identity.name, identity.description ?? '', identity.type, typeLabel, ...identity.aliases,
    ...identity.details.filter(detail => !detail.private).map(detail => detail.value)].some(text => looseText(text).includes(wanted));
}

/** The words an identity is known by: its name, other names and details that are not private. */
export function knownTexts(identity: Identity): string[] {
  return [identity.name, ...identity.aliases, ...identity.details.filter(detail => !detail.private).map(detail => detail.value)]
    .map(sameText).filter(Boolean);
}

/** Identities in other investigations with the same name or a shared detail that is not private. */
export function alsoElsewhere(identity: Identity, identities: readonly Identity[]): Identity[] {
  const mine = new Set(knownTexts(identity));
  return identities.filter(other => live(other) && other.folderId !== identity.folderId && other.id !== identity.id
    && knownTexts(other).some(text => mine.has(text))).sort(byName);
}

export type FoundSource = { kind: 'actor' | 'asset' | 'attribution' | 'email'; id: string; title: string };
export interface FoundName {
  /** Stable for this investigation and text; used to ignore it. */
  key: string;
  folderId: string;
  text: string;
  sources: FoundSource[];
  guess: { type: BuiltinType; detailLabel?: 'email' | 'ipAddress' | 'iban' | 'hostname' };
  /** An identity whose name differs only by accents, to suggest linking. */
  looksLike?: Identity;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** An email address is at most 254 characters; longer text is never tested (the pattern's time grows with its square). */
const isEmail = (text: string) => text.length <= 254 && EMAIL.test(text);
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
/** At least two colons (fe80::1), so a port (DC01:443) or a time (12:30) is not an address. */
const IPV6 = /^(?=(?:[^:]*:){2})[0-9a-f:]{2,39}$/i;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
const SERVICE_ACCOUNT = /^(svc|srv|sa)[_-]|\$$/i;
/** A dotted name (fin-db01.corp.local) or letters, digits and a hyphen (WS-0231, recipe-server-01).
 * Group names such as APT29 and hyphenated names such as Jean-Luc are not hostnames. */
const HOSTNAME = /^(?=.{2,63}$)(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$|^(?=.{2,63}$)(?=.*\d)(?=.*[a-z])[a-z0-9]+(?:-[a-z0-9]+)+$/i;

/** A first guess at what a name is; the person adding it can change it. `thing` says it was
 * listed as an asset, which names a system or an account, never a person. */
export function guessIdentity(text: string, thing = false): FoundName['guess'] {
  const compact = text.replace(/\s+/g, '');
  if (isEmail(text)) return { type: 'account', detailLabel: 'email' };
  if (IBAN.test(compact)) return { type: 'account', detailLabel: 'iban' };
  if (SERVICE_ACCOUNT.test(text)) return { type: 'account' };
  if (IPV4.test(text) || IPV6.test(text)) return { type: 'system', detailLabel: 'ipAddress' };
  if (HOSTNAME.test(text)) return { type: 'system', detailLabel: 'hostname' };
  return { type: thing ? 'system' : 'person' };
}

export const foundKey = (folderId: string, text: string) => JSON.stringify([folderId, sameText(text)]);
/** How an ignored found name is stored: FNV-1a, 64-bit, as hex. Stable and fast; a short name
 * could still be guessed from it, but it is never readable in browser storage. */
export function ignoredHash(key: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(key)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

/**
 * Names on timeline events (Actor, Assets), IOC attribution and email IOCs that match no
 * identity in their investigation (archived ones included). Threat actors from Settings are
 * tracked separately and left out, as are names the analyst chose to ignore, and values an
 * identity already holds as a private detail (left out silently: private details never
 * link or show anything). Most-mentioned first.
 */
export function foundNames(input: {
  identities: readonly Identity[];
  events: readonly TimelineEvent[];
  iocs: readonly StandaloneIOC[];
  threatActors?: readonly string[];
  /** Whether the analyst ignored a name in an investigation. */
  isIgnored?: (folderId: string, text: string) => boolean;
}): FoundName[] {
  const actors = new Set((input.threatActors ?? []).map(sameText));
  const known = new Map<string, Set<string>>();
  const loose = new Map<string, Map<string, Identity>>();
  for (const identity of input.identities) {
    if (!live(identity) || !identity.folderId) continue;
    const texts = known.get(identity.folderId) ?? new Set<string>();
    knownTexts(identity).forEach(text => texts.add(text));
    identity.details.forEach(detail => { texts.add(sameText(detail.value)); texts.add(detailKey(detail.value)); });
    known.set(identity.folderId, texts);
    const near = loose.get(identity.folderId) ?? new Map<string, Identity>();
    [identity.name, ...identity.aliases].forEach(text => { if (!near.has(looseText(text))) near.set(looseText(text), identity); });
    loose.set(identity.folderId, near);
  }
  const groups = new Map<string, FoundName>();
  const add = (folderId: string | undefined, raw: string | undefined, source: FoundSource) => {
    const text = raw?.trim();
    if (!folderId || !text || text.length > 200) return;
    const same = sameText(text);
    if (actors.has(same) || known.get(folderId)?.has(same) || known.get(folderId)?.has(detailKey(text))) return;
    const key = foundKey(folderId, text);
    if (input.isIgnored?.(folderId, text)) return;
    const group = groups.get(key);
    if (group) { if (!group.sources.some(seen => seen.kind === source.kind && seen.id === source.id)) group.sources.push(source); return; }
    groups.set(key, { key, folderId, text, sources: [source], guess: guessIdentity(text), looksLike: loose.get(folderId)?.get(looseText(text)) });
  };
  for (const event of input.events) {
    if (event.trashed || event.archived) continue;
    add(event.folderId, event.actor, { kind: 'actor', id: event.id, title: event.title });
    for (const asset of event.assets ?? []) add(event.folderId, asset, { kind: 'asset', id: event.id, title: event.title });
  }
  for (const ioc of input.iocs) {
    if (ioc.trashed || ioc.archived) continue;
    add(ioc.folderId, ioc.attribution, { kind: 'attribution', id: ioc.id, title: ioc.value });
    if (ioc.type === 'email') add(ioc.folderId, ioc.value, { kind: 'email', id: ioc.id, title: ioc.value });
  }
  for (const group of groups.values()) group.guess = guessIdentity(group.text, group.sources.some(source => source.kind === 'asset'));
  return [...groups.values()].sort((a, b) => b.sources.length - a.sources.length || sameText(a.text).localeCompare(sameText(b.text)));
}
