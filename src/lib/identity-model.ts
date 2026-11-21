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
export const isConnectionPhrase = (label: string): label is ConnectionPhrase => Object.hasOwn(CONNECTION_PHRASES, label);
/** Phrases that tie a person, system or account to an organisation. */
const MEMBERSHIP: readonly string[] = ['works at', 'belongs to'];

/** Detail labels offered in forms (i18n keys under `detailLabel.`). Labels are stored as typed. */
export const DETAIL_LABELS = ['email', 'phone', 'username', 'handle', 'ipAddress', 'hostname', 'domain', 'iban', 'assetTag', 'website', 'address'] as const;
/** Details with these labels start out private (i18n keys under `detailLabel.`). */
export const PRIVATE_DETAIL_LABELS = ['phone', 'address', 'personalEmail', 'homeAddress', 'dateOfBirth'] as const;

/** Lower case, single spaces, trimmed: how names and details are compared. */
export const sameText = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
/** Also ignores accents, for "looks like" suggestions that a person confirms. */
export const looseText = (text: string) => sameText(text).normalize('NFKD').replace(/\p{M}/gu, '');

/** The type a person typed or picked: a built-in key when it names one (in English or in
 * the interface language), otherwise a type already in use with other letter case, otherwise as typed. */
export function canonicalType(input: string, builtinLabels: Readonly<Record<BuiltinType, string>>, typesInUse: readonly string[]): string {
  const text = input.trim();
  const key = sameText(text);
  const builtin = BUILTIN_TYPES.find(type => type === key || sameText(builtinLabels[type]) === key);
  if (builtin) return builtin;
  return typesInUse.find(type => sameText(type) === key) ?? text;
}

/** The built-in phrase a person typed or picked (in English or the interface language), or the text as typed. */
export function canonicalPhrase(input: string, phraseLabels: Readonly<Record<ConnectionPhrase, string>>): string {
  const key = sameText(input);
  return (Object.keys(CONNECTION_PHRASES) as ConnectionPhrase[]).find(phrase => phrase === key || sameText(phraseLabels[phrase]) === key) ?? input.trim();
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]];
  const second = parts.length > 1 ? [...parts[parts.length - 1]][0] : first[1] ?? '';
  return (first[0] + second).toUpperCase();
}

/** What a hidden private detail shows: enough to recognise it, never the whole value. */
export function maskDetail(detail: Pick<IdentityDetail, 'label' | 'value'>): string {
  const digits = detail.value.replace(/\D/g, '');
  if (/phone|tel|mobile/i.test(detail.label) && digits.length >= 6) return `•••• ${digits.slice(-4)}`;
  const at = detail.value.indexOf('@');
  return at > 0 ? `${[...detail.value][0]}•••••${detail.value.slice(at)}` : '•••••••';
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

/** Replaces the membership edge to an organisation, keeping every other connection. */
export function withOrganization(identity: Identity, organizationId: string | undefined, byId: ReadonlyMap<string, Identity>) {
  const kept = identity.connections.filter(edge => !(MEMBERSHIP.includes(edge.label) && byId.get(edge.targetId)?.type === 'organization'));
  if (!organizationId || organizationId === identity.id) return kept;
  return [...kept, { targetId: organizationId, label: isPerson(identity) ? 'works at' : 'belongs to' }];
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

/** Everyone who works at an organisation, arranged by "reports to" between them. */
export function orgChart(organization: Identity, identities: readonly Identity[]): OrgChart {
  const people = identities.filter(identity => live(identity) && isPerson(identity) && identity.folderId === organization.folderId
    && identity.connections.some(edge => edge.label === 'works at' && edge.targetId === organization.id));
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

/** Organisations with at least one person who works there. */
export function chartableOrganizations(identities: readonly Identity[]): Identity[] {
  return identities.filter(organization => live(organization) && isOrganization(organization)
    && identities.some(person => live(person) && isPerson(person) && person.folderId === organization.folderId
      && person.connections.some(edge => edge.label === 'works at' && edge.targetId === organization.id))).sort(byName);
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
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+:[0-9a-f:]*$/i;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
const SERVICE_ACCOUNT = /^(svc|srv|sa)[_-]|\$$/i;
const HOSTNAME = /^(?=.*[a-z])(?=.*[\d.-])[a-z0-9][a-z0-9.-]{1,62}$/i;

/** A first guess at what a name is; the person adding it can change it. */
export function guessIdentity(text: string): FoundName['guess'] {
  const compact = text.replace(/\s+/g, '');
  if (EMAIL.test(text)) return { type: 'account', detailLabel: 'email' };
  if (IBAN.test(compact)) return { type: 'account', detailLabel: 'iban' };
  if (SERVICE_ACCOUNT.test(text)) return { type: 'account' };
  if (IPV4.test(text) || (IPV6.test(text) && text.includes(':'))) return { type: 'system', detailLabel: 'ipAddress' };
  if (!/\s/.test(text) && HOSTNAME.test(text)) return { type: 'system', detailLabel: 'hostname' };
  return { type: 'person' };
}

export const foundKey = (folderId: string, text: string) => JSON.stringify([folderId, sameText(text)]);

/**
 * Names on timeline events (Actor, Assets), IOC attribution and email IOCs that match no
 * identity in their investigation. Threat actors from Settings are tracked separately and
 * left out, as are names the analyst chose to ignore. Most-mentioned first.
 */
export function foundNames(input: {
  identities: readonly Identity[];
  events: readonly TimelineEvent[];
  iocs: readonly StandaloneIOC[];
  threatActors?: readonly string[];
  ignored?: ReadonlySet<string>;
}): FoundName[] {
  const actors = new Set((input.threatActors ?? []).map(sameText));
  const known = new Map<string, Set<string>>();
  const loose = new Map<string, Map<string, Identity>>();
  for (const identity of input.identities) {
    if (!live(identity) || !identity.folderId) continue;
    const texts = known.get(identity.folderId) ?? new Set<string>();
    knownTexts(identity).forEach(text => texts.add(text));
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
    if (actors.has(same) || known.get(folderId)?.has(same)) return;
    const key = foundKey(folderId, text);
    if (input.ignored?.has(key)) return;
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
  return [...groups.values()].sort((a, b) => b.sources.length - a.sources.length || sameText(a.text).localeCompare(sameText(b.text)));
}
