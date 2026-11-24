/**
 * The AI's identity tools. Private details never leave this file: results carry only the
 * details anyone can see, searches never look at private values, and nothing a tool says
 * depends on what a private detail holds (owner decision 7: private values are never sent to
 * an AI provider). Identity names and details are data the model reads, never instructions.
 */
import { nanoid } from 'nanoid';
import { db } from '../db';
import i18n from '../i18n';
import type { Identity, IdentityStatus } from '../types';
import { IDENTITY_STATUSES } from './entity-enums';
import {
  CONNECTION_PHRASES, ENGLISH_PHRASE_LABELS, ENGLISH_TYPE_LABELS, PRIVATE_DETAIL_LABELS, byName, canonicalPhrase,
  canonicalType, detailKey, guessIdentity, identityMatches, isOrganization, isPerson, isPrivateLabel, looseText, nameTakenBy, organizationOf, sameText,
  withConnection,
} from './identity-model';
import { withCreatorTags } from './tool-creator';

const STATUSES = IDENTITY_STATUSES;
const MAX_NAME = 200;
const MAX_TEXT = 2000;
const MAX_ITEMS = 30;
/** An identity holds at most this many public details (checked against public details only, so the
 * answer never depends on private ones), and at most MAX_TOTAL_DETAILS in all: a runaway agent
 * cannot grow one without end. The total only binds after hundreds of private details, so it says
 * nothing about any private value. */
const MAX_DETAILS = 200;
const MAX_TOTAL_DETAILS = 400;

/** Plain text: control characters and runs of spaces become one space, bounded. Never HTML-parsed,
 * so "Smith <john@x.com>" and "R&D" stay as written (React escapes them when shown). */
const clean = (value: unknown, max: number) => String(value ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** An id exactly as the dispatcher's reach check reads it (tool-reach.ts `arg`), so both see the same row. */
const rawId = (value: unknown) => String(value || '');
/** Loads the interface language's identities strings before an identity write, outside the
 * dispatcher's transaction (executeTool), so its private labels count. Never waits more than 2 s. */
export async function prepareIdentityLabels(): Promise<void> {
  if (i18n.hasResourceBundle(i18n.language, 'identities')) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([i18n.loadNamespaces('identities').catch(() => undefined), new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
  clearTimeout(timer);
}

/** The interface language's private labels, when its identities strings are already loaded
 * (no loading here: the dispatcher may be inside a database transaction). */
function translatedPrivateLabels(): string[] {
  return i18n.hasResourceBundle(i18n.language, 'identities') ? PRIVATE_DETAIL_LABELS.map(key => i18n.t(`detailLabel.${key}`, { ns: 'identities' })) : [];
}
/** Whether a detail with this label will be stored as private (the rule addDetails applies). */
const detailWillBePrivate = (label: unknown) => isPrivateLabel(clean(label, 100), translatedPrivateLabels());
const list = (value: unknown) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]).slice(0, MAX_ITEMS);
const error = (message: string) => JSON.stringify({ error: message });

/** Identities the call may see: its investigation's, or every one when the conversation has none. Trashed ones never. */
async function scope(folderId?: string): Promise<Identity[]> {
  const rows = folderId ? await db.identities.where('folderId').equals(folderId).toArray() : await db.identities.toArray();
  return rows.filter(identity => !identity.trashed);
}

/** The live identities an identity sits with: its investigation's, or, for one in no investigation,
 * the others in none (never every investigation on the device). */
async function besides(stored: Identity): Promise<Identity[]> {
  return stored.folderId ? scope(stored.folderId) : (await scope()).filter(identity => !identity.folderId);
}

/** What one result may hold, as the note tools do: synced or imported rows can be far larger. */
const MAX_SNIPPET = 200;          // a description in a search (search_notes)
const MAX_DESCRIPTION = 8000;     // a description in a read (read_note)
const MAX_VALUE = 500;            // a name, label or detail value
const SEARCH_OTHER_NAMES = 10;    // other names a search lists
const PAGE = 50;                  // other names, details, connections and tags per read, at most
const PAGE_BUDGET = 30_000;       // characters those lists may take in one read
// Never ending on half a character: providers can reject a lone surrogate.
const cut = (text: string | undefined, max: number) => (text && text.length > max ? `${text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '')}…` : text);

/** The details anyone can see; private ones are never returned. */
const publicDetails = (identity: Identity) => identity.details.filter(detail => !detail.private)
  .map(({ label, value }) => ({ label: cut(label, MAX_VALUE), value: cut(value, MAX_VALUE) }));

function summary(identity: Identity, byId: ReadonlyMap<string, Identity>) {
  return {
    id: identity.id, name: cut(identity.name, MAX_VALUE), type: cut(identity.type, 50), status: identity.status, contact: !!identity.contact,
    description: cut(identity.description, MAX_SNIPPET),
    otherNames: identity.aliases.slice(0, SEARCH_OTHER_NAMES).map(name => cut(name, MAX_VALUE)),
    ...(identity.aliases.length > SEARCH_OTHER_NAMES ? { otherNamesTotal: identity.aliases.length } : {}),
    organization: cut(organizationOf(identity, byId)?.name, MAX_VALUE),
    archived: identity.archived || undefined,
  };
}

/** By id, or by exact name or other name in the investigation; refuses a name two identities share. */
function find(rows: readonly Identity[], input: { id?: unknown; name?: unknown }): Identity | string {
  const id = rawId(input.id);
  if (id) return rows.find(identity => identity.id === id) ?? 'Identity not found in this investigation.';
  const name = clean(input.name, MAX_NAME);
  if (!name) return 'Give the identity\'s id or name.';
  const matches = rows.filter(identity => [identity.name, ...identity.aliases].some(text => sameText(text) === sameText(name)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return `"${name}" names ${matches.length} identities (${matches.map(identity => `${identity.id}: ${identity.type}`).join(', ')}); give the id.`;
  return `No identity named "${name}" in this investigation; search_identities lists them.`;
}

/**
 * `brief` is for stakeholder (observer) agents: owner decision, names, types, statuses and counts
 * only. A brief search matches the name only (not other names, which a stakeholder is never shown, nor a
 * detail), and returns no description, organisation or other names.
 */
export async function executeSearchIdentities(input: Record<string, unknown>, folderId?: string, options: { brief?: boolean } = {}): Promise<string> {
  const query = clean(input.query, MAX_NAME);
  const type = clean(input.type, 50).toLowerCase();
  const status = clean(input.status, 20).toLowerCase();
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const rows = await scope(folderId);
  const byId = new Map(rows.map(identity => [identity.id, identity]));
  // identityMatches looks at the name, other names, description, type and details that are not private.
  const wanted = looseText(query);
  // Brief: the name only, so a stakeholder cannot recover other names letter by letter.
  const matches = (identity: Identity) => (options.brief
    ? !wanted || looseText(identity.name).includes(wanted)
    : identityMatches(identity, query, identity.type));
  const matched = rows.filter(identity => !identity.archived && (!type || sameText(identity.type) === type)
    && (!status || identity.status === status) && matches(identity)).sort(byName);
  return JSON.stringify({ count: matched.length, identities: matched.slice(0, limit).map(identity => (options.brief
    ? { id: identity.id, name: cut(identity.name, MAX_VALUE), type: identity.type, status: identity.status }
    : summary(identity, byId))) });
}

export async function executeReadIdentity(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const id = rawId(input.id);
  // By id, the dispatcher's reach check has already decided whether another investigation may be read.
  const stored = id ? await db.identities.get(id) : undefined;
  const rows = id ? (stored && !stored.trashed ? await besides(stored) : []) : await scope(folderId);
  const identity = find(rows, input);
  if (typeof identity === 'string') return error(identity);
  const byId = new Map(rows.map(row => [row.id, row]));
  const connections = [
    ...identity.connections.map(edge => ({ phrase: edge.label, direction: 'out' as const, other: byId.get(edge.targetId) })),
    ...rows.flatMap(other => other.connections.filter(edge => edge.targetId === identity.id)
      .map(edge => ({ phrase: edge.label, direction: 'in' as const, other }))),
  ].flatMap(({ phrase, direction, other }) => (other && !other.trashed ? [{ phrase: cut(phrase, MAX_VALUE), direction, id: other.id, name: cut(other.name, MAX_VALUE) }] : []));
  // One page of the lists (an organisation's members are its incoming connections): the same items of
  // each, as many as fit the budget (at least one), so a read stays under the tool-result cap.
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
  const otherNames = identity.aliases.map(name => cut(name, MAX_VALUE));
  const details = publicDetails(identity);
  const tags = identity.tags.map(tag => cut(tag, MAX_SNIPPET));
  const lists: unknown[][] = [otherNames, details, connections, tags];
  let count = 0;
  for (let used = 0; count < PAGE && lists.some(items => items.length > offset + count); count++) {
    const cost = lists.reduce((sum, items) => sum + (offset + count < items.length ? JSON.stringify(items[offset + count]).length : 0), 0);
    if (count > 0 && used + cost > PAGE_BUDGET) break;
    used += cost;
  }
  const page = <T,>(items: T[]) => items.slice(offset, offset + count);
  const more = lists.some(items => items.length > offset + count);
  const head = summary(identity, byId);
  return JSON.stringify({
    id: head.id, name: head.name, type: head.type, status: head.status, contact: head.contact, organization: head.organization, archived: head.archived,
    // Totals and the next page first: a result cut short still says how to read on.
    otherNamesTotal: otherNames.length, detailsTotal: details.length, connectionsTotal: connections.length, tagsTotal: tags.length,
    ...(more ? { nextOffset: offset + count } : {}),
    description: cut(identity.description, MAX_DESCRIPTION),
    otherNames: page(otherNames), details: page(details), connections: page(connections), tags: page(tags),
    clsLevel: cut(identity.clsLevel, 50), createdAt: identity.createdAt, updatedAt: identity.updatedAt,
  });
}

/**
 * New details. Whether one is private depends on its label alone (Phone, Home address…), never on
 * what private details already hold, and a repeat is skipped only against details of the same
 * kind: nothing a later read or search shows depends on a private value, so a guess cannot be
 * confirmed. The cap is checked once, before anything is added, against the public details and
 * every valid entry received, so whether a repeat was skipped never changes the answer either.
 * Returns how many entries were valid, not how many were stored, for the same reason.
 */
function addDetails(identity: Identity, raw: unknown): number | string {
  const privateLabels = translatedPrivateLabels();
  const entries = list(raw).map(entry => ({
    label: clean((entry as { label?: unknown })?.label, 100),
    value: clean((entry as { value?: unknown })?.value, MAX_TEXT),
  })).filter(entry => entry.label && entry.value);
  if (identity.details.filter(detail => !detail.private).length + entries.length > MAX_DETAILS
    || identity.details.length + entries.length > MAX_TOTAL_DETAILS) {
    return `An identity holds at most ${MAX_DETAILS} details.`;
  }
  for (const { label, value } of entries) {
    const isPrivate = isPrivateLabel(label, privateLabels);
    const key = detailKey(value);
    if (identity.details.some(detail => !!detail.private === isPrivate && sameText(detail.label) === sameText(label) && detailKey(detail.value) === key)) continue;
    identity.details.push({ id: nanoid(), label, value, ...(isPrivate ? { private: true } : {}) });
  }
  return entries.length;
}

/** Other names that are nobody else's name in the investigation. */
/** For an approval card: what a call would do, resolved as the tools resolve it. */
export const toolItems = (value: unknown) => list(value);
export const identityScope = (folderId?: string) => scope(folderId);
export const identitiesBeside = (stored: Identity) => besides(stored);
export const findIdentity = (rows: readonly Identity[], input: { id?: unknown; name?: unknown }) => find(rows, input);
/** The other names update_identity would add (not those already held, nor another identity's). */
export function otherNamesToAdd(identity: Identity, raw: unknown, rows: readonly Identity[]): string[] {
  const copy = { ...identity, aliases: [...identity.aliases] };
  addOtherNames(copy, raw, rows);
  return copy.aliases.slice(identity.aliases.length);
}
/** The details addDetails would take, each marked as it would store it (call prepareIdentityLabels first). */
export const detailsToAdd = (raw: unknown) => list(raw).map(entry => ({ label: clean((entry as { label?: unknown })?.label, 100), value: clean((entry as { value?: unknown })?.value, MAX_TEXT) }))
  .filter(entry => entry.label && entry.value).map(entry => ({ label: entry.label, private: detailWillBePrivate(entry.label) }));

function addOtherNames(identity: Identity, raw: unknown, rows: readonly Identity[]): { added: number; skipped: string[] } {
  const skipped: string[] = [];
  let added = 0;
  for (const entry of list(raw)) {
    const name = clean(entry, MAX_NAME);
    if (!name || sameText(name) === sameText(identity.name) || identity.aliases.some(alias => sameText(alias) === sameText(name))) continue;
    if (nameTakenBy(rows, identity.folderId, name, identity.id)) { skipped.push(name); continue; }
    identity.aliases.push(name);
    added++;
  }
  return { added, skipped };
}

export async function executeCreateIdentity(input: Record<string, unknown>, folderId?: string, creator?: string): Promise<string> {
  if (!folderId) return error('Open an investigation first: every identity belongs to one.');
  const name = clean(input.name, MAX_NAME);
  if (!name) return error('name is required');
  const rows = await scope(folderId);
  const existing = rows.find(identity => [identity.name, ...identity.aliases].some(text => sameText(text) === sameText(name)));
  if (existing) return error(`"${name}" is already an identity in this investigation (id ${existing.id}); use update_identity.`);
  const statusText = clean(input.status, 20).toLowerCase();
  if (statusText && !STATUSES.includes(statusText as IdentityStatus)) return error(`status must be one of: ${STATUSES.join(', ')}`);
  let organization: Identity | undefined;
  const organizationName = clean(input.organization, MAX_NAME);
  if (organizationName) {
    const found = find(rows, { name: organizationName });
    if (typeof found === 'string' || !isOrganization(found)) return error(`"${organizationName}" is not one organization in this investigation; create it first.`);
    organization = found;
  }
  const typed = clean(input.type, 50);
  const now = Date.now();
  const folder = await db.folders.get(folderId);
  const identity: Identity = {
    id: nanoid(), folderId, name,
    type: typed ? canonicalType(typed, ENGLISH_TYPE_LABELS, [...new Set(rows.map(row => row.type))]) : guessIdentity(name).type,
    description: clean(input.description, MAX_TEXT) || undefined,
    status: (statusText as IdentityStatus) || undefined,
    contact: input.contact === true || undefined,
    aliases: [], details: [], connections: [],
    tags: withCreatorTags([], creator), clsLevel: folder?.clsLevel,
    trashed: false, archived: false, createdBy: creator, createdAt: now, updatedAt: now,
  };
  const otherNames = addOtherNames(identity, input.otherNames, rows);
  const detailsReceived = addDetails(identity, input.details);
  if (typeof detailsReceived === 'string') return error(detailsReceived);
  if (organization) identity.connections.push({ targetId: organization.id, label: isPerson(identity) ? 'works at' : 'belongs to' });
  await db.identities.add(identity);
  return JSON.stringify({ success: true, id: identity.id, name: identity.name, type: identity.type, detailsReceived,
    ...(otherNames.skipped.length ? { otherNamesSkipped: otherNames.skipped, reason: 'already another identity\'s name' } : {}) });
}

export async function executeUpdateIdentity(input: Record<string, unknown>, creator?: string): Promise<string> {
  const id = rawId(input.id);
  if (!id) return error('id is required');
  const stored = await db.identities.get(id);
  if (!stored || stored.trashed) return error('Identity not found');
  const rows = await besides(stored);
  const identity: Identity = { ...stored, aliases: [...stored.aliases], details: [...stored.details], connections: [...stored.connections] };
  const updates: Partial<Identity> = { updatedAt: Date.now(), ...(creator ? { updatedBy: creator } : {}) };
  if (input.description !== undefined) updates.description = clean(input.description, MAX_TEXT) || undefined;
  if (input.status !== undefined) {
    const status = clean(input.status, 20).toLowerCase();
    if (status && status !== 'none' && !STATUSES.includes(status as IdentityStatus)) return error(`status must be one of: ${STATUSES.join(', ')}, none`);
    updates.status = status && status !== 'none' ? status as IdentityStatus : undefined;
  }
  if (typeof input.contact === 'boolean') updates.contact = input.contact || undefined;
  const otherNames = addOtherNames(identity, input.addOtherNames, rows);
  const detailsReceived = addDetails(identity, input.addDetails);
  if (typeof detailsReceived === 'string') return error(detailsReceived);
  if (otherNames.added) updates.aliases = identity.aliases;
  if (identity.details.length !== stored.details.length) updates.details = identity.details;
  await db.identities.update(id, updates);
  return JSON.stringify({ success: true, id, name: stored.name, detailsReceived, otherNamesAdded: otherNames.added,
    ...(otherNames.skipped.length ? { otherNamesSkipped: otherNames.skipped, reason: 'already another identity\'s name' } : {}) });
}

export async function executeConnectIdentities(input: Record<string, unknown>, folderId?: string, creator?: string): Promise<string> {
  const phraseText = clean(input.phrase, 100);
  if (!phraseText) return error('phrase is required, for example "works at" or "reports to"');
  // Both ends in one investigation: the one the first names, else the conversation's.
  const first = rawId(input.fromId) ? await db.identities.get(rawId(input.fromId)) : undefined;
  const rows = await scope(first?.folderId ?? folderId);
  if (!first?.folderId && !folderId) return error('Open an investigation first, or give both ids.');
  const from = find(rows, { id: input.fromId, name: input.fromName });
  if (typeof from === 'string') return error(`from: ${from}`);
  const to = find(rows, { id: input.toId, name: input.toName });
  if (typeof to === 'string') return error(`to: ${to} Both identities must be in the same investigation.`);
  if (from.id === to.id) return error('An identity cannot be connected to itself.');
  // Only the built-in phrases (or their other-side wording): free text from a model is not stored as a connection.
  const { label, reversed } = canonicalPhrase(phraseText, ENGLISH_PHRASE_LABELS);
  if (!Object.hasOwn(CONNECTION_PHRASES, label)) return error(`Use one of: ${Object.keys(CONNECTION_PHRASES).join(', ')} (or the other side's wording, such as "manages").`);
  const [source, target] = reversed ? [to, from] : [from, to];
  const connections = withConnection(source, target, label);
  if (!connections) return error(`"${label}" connects to an organization; "${target.name}" is not one.`);
  if (connections === source.connections) {
    return JSON.stringify({ success: true, id: source.id, unchanged: true, connection: `${source.name} ${label} ${target.name}` });
  }
  await db.identities.update(source.id, { connections, updatedAt: Date.now(),
    ...(creator ? { updatedBy: creator } : {}) });
  return JSON.stringify({ success: true, id: source.id, connection: `${source.name} ${label} ${target.name}` });
}
