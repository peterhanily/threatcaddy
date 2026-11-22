/**
 * The AI's identity tools. Private details never leave this file: results carry only the
 * details anyone can see, searches never look at private values, and nothing a tool says
 * depends on what a private detail holds (owner decision 7: private values are never sent to
 * an AI provider). Identity names and details are data the model reads, never instructions.
 */
import { nanoid } from 'nanoid';
import DOMPurify from 'dompurify';
import { db } from '../db';
import type { Identity, IdentityStatus } from '../types';
import {
  BUILTIN_TYPES, CONNECTION_PHRASES, PRIVATE_DETAIL_LABELS, byName, canonicalPhrase, canonicalType, detailKey, guessIdentity,
  identityMatches, isOrganization, isPerson, organizationOf, sameText, type BuiltinType, type ConnectionPhrase,
} from './identity-model';
import { withCreatorTags } from './tool-creator';

const ENGLISH_TYPES = Object.fromEntries(BUILTIN_TYPES.map(type => [type, type])) as Record<BuiltinType, string>;
const ENGLISH_PHRASES = Object.fromEntries(Object.keys(CONNECTION_PHRASES).map(phrase => [phrase, phrase])) as Record<ConnectionPhrase, string>;
const PRIVATE_LABELS = new Set(PRIVATE_DETAIL_LABELS.map(key => sameText(key.replace(/([A-Z])/g, ' $1'))));
const STATUSES: readonly IdentityStatus[] = ['compromised', 'suspicious', 'cleared'];
const MEMBERSHIP = new Set(['works at', 'belongs to']);
const MAX_NAME = 200;
const MAX_TEXT = 2000;
const MAX_ITEMS = 30;

/** Plain text, no markup, bounded. */
const clean = (value: unknown, max: number) => DOMPurify.sanitize(String(value ?? ''), { ALLOWED_TAGS: [] }).replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value: unknown) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]).slice(0, MAX_ITEMS);
const error = (message: string) => JSON.stringify({ error: message });

/** Identities the call may see: its investigation's, or every one when the conversation has none. Trashed ones never. */
async function scope(folderId?: string): Promise<Identity[]> {
  const rows = folderId ? await db.identities.where('folderId').equals(folderId).toArray() : await db.identities.toArray();
  return rows.filter(identity => !identity.trashed);
}

/** The details anyone can see; private ones are never returned. */
const publicDetails = (identity: Identity) => identity.details.filter(detail => !detail.private).map(({ label, value }) => ({ label, value }));

function summary(identity: Identity, byId: ReadonlyMap<string, Identity>) {
  return {
    id: identity.id, name: identity.name, type: identity.type, status: identity.status, contact: !!identity.contact,
    description: identity.description, otherNames: identity.aliases, organization: organizationOf(identity, byId)?.name,
    archived: identity.archived || undefined,
  };
}

/** By id, or by exact name or other name in the investigation; refuses a name two identities share. */
function find(rows: readonly Identity[], input: { id?: unknown; name?: unknown }): Identity | string {
  const id = clean(input.id, 100);
  if (id) return rows.find(identity => identity.id === id) ?? 'Identity not found in this investigation.';
  const name = clean(input.name, MAX_NAME);
  if (!name) return 'Give the identity\'s id or name.';
  const matches = rows.filter(identity => [identity.name, ...identity.aliases].some(text => sameText(text) === sameText(name)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return `"${name}" names ${matches.length} identities (${matches.map(identity => `${identity.id}: ${identity.type}`).join(', ')}); give the id.`;
  return `No identity named "${name}" in this investigation; search_identities lists them.`;
}

export async function executeSearchIdentities(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const query = clean(input.query, MAX_NAME);
  const type = clean(input.type, 50).toLowerCase();
  const status = clean(input.status, 20).toLowerCase();
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const rows = await scope(folderId);
  const byId = new Map(rows.map(identity => [identity.id, identity]));
  // identityMatches looks at the name, other names, description, type and details that are not private.
  const matched = rows.filter(identity => !identity.archived && (!type || sameText(identity.type) === type)
    && (!status || identity.status === status) && identityMatches(identity, query, identity.type)).sort(byName);
  return JSON.stringify({ count: matched.length, identities: matched.slice(0, limit).map(identity => summary(identity, byId)) });
}

export async function executeReadIdentity(input: Record<string, unknown>, folderId?: string): Promise<string> {
  const id = clean(input.id, 100);
  // By id, the dispatcher's reach check has already decided whether another investigation may be read.
  const stored = id ? await db.identities.get(id) : undefined;
  const rows = id ? (stored && !stored.trashed ? await scope(stored.folderId) : []) : await scope(folderId);
  const identity = find(rows, input);
  if (typeof identity === 'string') return error(identity);
  const byId = new Map(rows.map(row => [row.id, row]));
  const connections = [
    ...identity.connections.map(edge => ({ phrase: edge.label, direction: 'out' as const, other: byId.get(edge.targetId) })),
    ...rows.flatMap(other => other.connections.filter(edge => edge.targetId === identity.id)
      .map(edge => ({ phrase: edge.label, direction: 'in' as const, other }))),
  ].flatMap(({ phrase, direction, other }) => (other && !other.trashed ? [{ phrase, direction, id: other.id, name: other.name }] : []));
  return JSON.stringify({
    ...summary(identity, byId),
    details: publicDetails(identity),
    connections,
    tags: identity.tags, clsLevel: identity.clsLevel,
    createdAt: identity.createdAt, updatedAt: identity.updatedAt,
  });
}

/** New details: private when the label is private by default (Phone, Home address…), or when the
 * value is already held privately; the reply is the same either way, so it reveals nothing. */
function addDetails(identity: Identity, raw: unknown): number {
  let added = 0;
  for (const entry of list(raw)) {
    const label = clean((entry as { label?: unknown })?.label, 100);
    const value = clean((entry as { value?: unknown })?.value, MAX_TEXT);
    if (!label || !value) continue;
    const key = detailKey(value);
    if (identity.details.some(detail => !detail.private && sameText(detail.label) === sameText(label) && detailKey(detail.value) === key)) continue;
    const isPrivate = PRIVATE_LABELS.has(sameText(label)) || identity.details.some(detail => detail.private && detailKey(detail.value) === key);
    identity.details.push({ id: nanoid(), label, value, ...(isPrivate ? { private: true } : {}) });
    added++;
  }
  return added;
}

/** Other names that are nobody else's name in the investigation. */
function addOtherNames(identity: Identity, raw: unknown, rows: readonly Identity[]): { added: number; skipped: string[] } {
  const skipped: string[] = [];
  let added = 0;
  for (const entry of list(raw)) {
    const name = clean(entry, MAX_NAME);
    if (!name || sameText(name) === sameText(identity.name) || identity.aliases.some(alias => sameText(alias) === sameText(name))) continue;
    if (rows.some(other => other.id !== identity.id && [other.name, ...other.aliases].some(text => sameText(text) === sameText(name)))) { skipped.push(name); continue; }
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
    type: typed ? canonicalType(typed, ENGLISH_TYPES, [...new Set(rows.map(row => row.type))]) : guessIdentity(name).type,
    description: clean(input.description, MAX_TEXT) || undefined,
    status: (statusText as IdentityStatus) || undefined,
    contact: input.contact === true || undefined,
    aliases: [], details: [], connections: [],
    tags: withCreatorTags([], creator), clsLevel: folder?.clsLevel,
    trashed: false, archived: false, createdBy: creator, createdAt: now, updatedAt: now,
  };
  const otherNames = addOtherNames(identity, input.otherNames, rows);
  const detailsAdded = addDetails(identity, input.details);
  if (organization) identity.connections.push({ targetId: organization.id, label: isPerson(identity) ? 'works at' : 'belongs to' });
  await db.identities.add(identity);
  return JSON.stringify({ success: true, id: identity.id, name: identity.name, type: identity.type, detailsAdded,
    ...(otherNames.skipped.length ? { otherNamesSkipped: otherNames.skipped, reason: 'already another identity\'s name' } : {}) });
}

export async function executeUpdateIdentity(input: Record<string, unknown>, creator?: string): Promise<string> {
  const id = clean(input.id, 100);
  if (!id) return error('id is required');
  const stored = await db.identities.get(id);
  if (!stored || stored.trashed) return error('Identity not found');
  const rows = await scope(stored.folderId);
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
  const detailsAdded = addDetails(identity, input.addDetails);
  if (otherNames.added) updates.aliases = identity.aliases;
  if (detailsAdded) updates.details = identity.details;
  await db.identities.update(id, updates);
  return JSON.stringify({ success: true, id, name: stored.name, detailsAdded, otherNamesAdded: otherNames.added,
    ...(otherNames.skipped.length ? { otherNamesSkipped: otherNames.skipped, reason: 'already another identity\'s name' } : {}) });
}

export async function executeConnectIdentities(input: Record<string, unknown>, folderId?: string, creator?: string): Promise<string> {
  const phraseText = clean(input.phrase, 100);
  if (!phraseText) return error('phrase is required, for example "works at" or "reports to"');
  // Both ends in one investigation: the one the first names, else the conversation's.
  const first = clean(input.fromId, 100) ? await db.identities.get(clean(input.fromId, 100)) : undefined;
  const rows = await scope(first?.folderId ?? folderId);
  if (!first?.folderId && !folderId) return error('Open an investigation first, or give both ids.');
  const from = find(rows, { id: input.fromId, name: input.fromName });
  if (typeof from === 'string') return error(`from: ${from}`);
  const to = find(rows, { id: input.toId, name: input.toName });
  if (typeof to === 'string') return error(`to: ${to} Both identities must be in the same investigation.`);
  if (from.id === to.id) return error('An identity cannot be connected to itself.');
  const { label, reversed } = canonicalPhrase(phraseText, ENGLISH_PHRASES);
  const [source, target] = reversed ? [to, from] : [from, to];
  if (MEMBERSHIP.has(label) && !isOrganization(target)) return error(`"${label}" connects to an organization; "${target.name}" is not one.`);
  if (source.connections.some(edge => edge.targetId === target.id && edge.label === label)) {
    return JSON.stringify({ success: true, id: source.id, unchanged: true, connection: `${source.name} ${label} ${target.name}` });
  }
  await db.identities.update(source.id, { connections: [...source.connections, { targetId: target.id, label }], updatedAt: Date.now(),
    ...(creator ? { updatedBy: creator } : {}) });
  return JSON.stringify({ success: true, id: source.id, connection: `${source.name} ${label} ${target.name}` });
}
