import { db } from '../db';
import i18n from '../i18n';
import { isFolderLocalOnly, isShareableFolder } from './ai-scope';
import { isBuiltinType, looseText, organizationOf } from './identity-model';

export interface MentionSuggestion {
  type: 'note' | 'ioc' | 'investigation' | 'identity';
  id: string;
  label: string;
  /** Short preview for the dropdown */
  preview?: string;
}

import { mentionCategoryLabel } from './i18n-labels';
import { sliceText } from './utils';

/** Category options shown when user types just '@' */
export const MENTION_CATEGORIES = [
  { type: 'note' as const, get label() { return mentionCategoryLabel('note'); }, prefix: '@note:' },
  { type: 'ioc' as const, get label() { return mentionCategoryLabel('ioc'); }, prefix: '@ioc:' },
  { type: 'investigation' as const, get label() { return mentionCategoryLabel('investigation'); }, prefix: '@investigation:' },
  { type: 'identity' as const, get label() { return mentionCategoryLabel('identity'); }, prefix: '@identity:' },
];

/** Every token resolveMentions reads an entity for. */
const MENTION_TOKEN = /@(note|ioc|investigation|identity):([^\s]+)/;

/** Model-written text must not carry one: a click would read the entity with no approval card. */
export function hasMentionToken(text: string): boolean {
  return MENTION_TOKEN.test(text);
}

/** The tool gate's `hidden` rule (tool-reach.ts): trashed, or in a local-only
 * investigation while the conversation's investigation can sync. */
async function isHidden(row: { folderId?: string; trashed?: boolean }, hideLocalOnly: boolean): Promise<boolean> {
  return !!row.trashed || (hideLocalOnly && !!row.folderId && await isFolderLocalOnly(row.folderId));
}

/**
 * Search entities matching a partial query for the autocomplete dropdown.
 * Called as the user types after '@note:', '@ioc:', or '@investigation:'.
 */
export async function searchMentions(
  type: 'note' | 'ioc' | 'investigation' | 'identity',
  query: string,
  folderId?: string,
  limit = 8,
): Promise<MentionSuggestion[]> {
  const q = query.toLowerCase();

  // Pre-filter cap — large enough to give "most recent matching" fidelity but
  // bounded so the global (no folderId) path doesn't full-scan the notes or
  // IOCs table on every keystroke.
  const GLOBAL_RECENT_CAP = 200;

  if (type === 'note') {
    let notes;
    if (folderId) {
      notes = await db.notes.where('folderId').equals(folderId).and(n => !n.trashed).toArray();
      notes.sort((a, b) => b.updatedAt - a.updatedAt);
    } else {
      // Walk the updatedAt index in reverse; Dexie stops after the limit is met.
      notes = await db.notes.orderBy('updatedAt').reverse().filter(n => !n.trashed).limit(GLOBAL_RECENT_CAP).toArray();
    }
    if (q) notes = notes.filter(n => n.title.toLowerCase().includes(q));
    return notes.slice(0, limit).map(n => ({
      type: 'note',
      id: n.id,
      label: n.title,
      preview: n.content.slice(0, 60).replace(/\n/g, ' '),
    }));
  }

  if (type === 'ioc') {
    let iocs;
    if (folderId) {
      iocs = await db.standaloneIOCs.where('folderId').equals(folderId).and(i => !i.trashed).toArray();
      iocs.sort((a, b) => b.updatedAt - a.updatedAt);
    } else {
      iocs = await db.standaloneIOCs.orderBy('updatedAt').reverse().filter(i => !i.trashed).limit(GLOBAL_RECENT_CAP).toArray();
    }
    if (q) iocs = iocs.filter(i => i.value.toLowerCase().includes(q) || i.type.toLowerCase().includes(q));
    return iocs.slice(0, limit).map(i => ({
      type: 'ioc',
      id: i.id,
      label: `${i.type}: ${i.value}`,
      preview: i.analystNotes?.slice(0, 60),
    }));
  }

  if (type === 'identity') {
    let identities;
    if (folderId) {
      identities = await db.identities.where('folderId').equals(folderId).and(i => !i.trashed && !i.archived).toArray();
      identities.sort((a, b) => b.updatedAt - a.updatedAt);
    } else {
      identities = await db.identities.orderBy('updatedAt').reverse().filter(i => !i.trashed && !i.archived).limit(GLOBAL_RECENT_CAP).toArray();
    }
    // Names and other names only: private details are never searched.
    const wanted = looseText(q);
    if (wanted) identities = identities.filter(i => [i.name, ...i.aliases].some(name => looseText(name).includes(wanted)));
    // The type as the Identities view names it; a custom type is shown as written.
    await i18n.loadNamespaces('identities').catch(() => undefined);
    const typeName = (type: string) => (isBuiltinType(type) ? i18n.t(`type.${type}`, { ns: 'identities' }) : type);
    return identities.slice(0, limit).map(i => ({
      type: 'identity',
      id: i.id,
      label: i.name,
      preview: [typeName(i.type), i.description].filter(Boolean).join(' · ').slice(0, 60),
    }));
  }

  if (type === 'investigation') {
    let folders = await db.folders.toArray();
    if (await isShareableFolder(folderId)) {
      // isFolderLocalOnly for every folder, with the persisted markers (keys JSON.stringify(['localOnly', id])) read once:
      // this runs on each keystroke.
      const markers = await db.table('_syncMeta').where('key').startsWith('["localOnly",').toArray();
      const marked = new Set(markers.filter(row => row.value === true).map(row => row.key as string));
      folders = folders.filter(f => !f.localOnly && !marked.has(JSON.stringify(['localOnly', f.id])));
    }
    if (q) folders = folders.filter(f => f.name.toLowerCase().includes(q));
    folders.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    return folders.slice(0, limit).map(f => ({
      type: 'investigation',
      id: f.id,
      label: f.name,
      preview: f.description?.slice(0, 60),
    }));
  }

  return [];
}

/**
 * Parse @mention tokens from user text and resolve them to full entity data
 * that gets injected into the LLM context.
 * Returns the cleaned display text and the context injection string.
 * An entity the conversation's investigation may not see stays an unresolved token.
 */
export async function resolveMentions(text: string, homeFolderId: string | undefined): Promise<{
  displayText: string;
  contextBlock: string;
  hasMentions: boolean;
}> {
  const mentionPattern = new RegExp(MENTION_TOKEN.source, 'g');
  const mentions: { full: string; type: string; id: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(text)) !== null) {
    mentions.push({ full: match[0], type: match[1], id: match[2] });
  }

  if (mentions.length === 0) {
    return { displayText: text, contextBlock: '', hasMentions: false };
  }

  const contextParts: string[] = [];
  let displayText = text;
  const hideLocalOnly = await isShareableFolder(homeFolderId);

  for (const m of mentions) {
    if (m.type === 'note') {
      const note = await db.notes.get(m.id);
      if (note && !await isHidden(note, hideLocalOnly)) {
        contextParts.push(`[Referenced Note: "${note.title}"]\n${note.content.slice(0, 4000)}`);
        // A function, so "$&" or "$'" in a stored name is not read as a replacement pattern.
        displayText = displayText.replace(m.full, () => `@${note.title}`);
      }
    } else if (m.type === 'ioc') {
      const ioc = await db.standaloneIOCs.get(m.id);
      if (ioc && !await isHidden(ioc, hideLocalOnly)) {
        const details = [
          `Type: ${ioc.type}`,
          `Value: ${ioc.value}`,
          ioc.confidence ? `Confidence: ${ioc.confidence}` : '',
          ioc.analystNotes ? `Notes: ${ioc.analystNotes}` : '',
          ioc.attribution ? `Attribution: ${ioc.attribution}` : '',
          ioc.iocStatus ? `Status: ${ioc.iocStatus}` : '',
        ].filter(Boolean).join('\n');
        contextParts.push(`[Referenced IOC: ${ioc.type}:${ioc.value}]\n${details}`);
        displayText = displayText.replace(m.full, () => `@${ioc.type}:${ioc.value}`);
      }
    } else if (m.type === 'identity') {
      const identity = await db.identities.get(m.id);
      if (identity && !await isHidden(identity, hideLocalOnly)) {
        // What anyone can see: never a private detail (owner decision 7).
        // The same organisation the Identities view shows: a live organisation in the same investigation.
        const sameInvestigation = identity.folderId ? await db.identities.where('folderId').equals(identity.folderId).toArray() : [];
        const organizationName = organizationOf(identity, new Map(sameInvestigation.map(row => [row.id, row])))?.name;
        const details = [
          `Name: ${identity.name}`,
          `Type: ${identity.type}`,
          identity.status ? `Status: ${identity.status}` : '',
          identity.description ? `Description: ${identity.description}` : '',
          identity.aliases.length ? `Other names: ${identity.aliases.join('; ')}` : '',
          organizationName ? `Organization: ${organizationName}` : '',
          ...identity.details.filter(detail => !detail.private).map(detail => `${detail.label}: ${detail.value}`),
        ].filter(Boolean).join('\n');
        // Capped as a note mention is: an identity can hold thousands of details.
        const shortName = sliceText(identity.name, 200);
        contextParts.push(`[Referenced Identity: "${shortName}"]\n${details.length > 4000 ? `${sliceText(details, 4000)}…` : details}`);
        displayText = displayText.replace(m.full, () => `@${shortName}`);
      }
    } else if (m.type === 'investigation') {
      const folder = await db.folders.get(m.id);
      if (folder && !await isHidden({ folderId: folder.id }, hideLocalOnly)) {
        const [noteCount, taskCount, iocCount, eventCount, identityCount] = await Promise.all([
          db.notes.where('folderId').equals(folder.id).and(n => !n.trashed).count(),
          db.tasks.where('folderId').equals(folder.id).and(t => !t.trashed).count(),
          db.standaloneIOCs.where('folderId').equals(folder.id).and(i => !i.trashed).count(),
          db.timelineEvents.where('folderId').equals(folder.id).and(e => !e.trashed).count(),
          db.identities.where('folderId').equals(folder.id).and(i => !i.trashed).count(),
        ]);
        const details = [
          `Name: ${folder.name}`,
          folder.description ? `Description: ${folder.description}` : '',
          `Status: ${folder.status || 'active'}`,
          `Entities: ${noteCount} notes, ${taskCount} tasks, ${iocCount} IOCs, ${eventCount} timeline events, ${identityCount} identities`,
        ].filter(Boolean).join('\n');
        contextParts.push(`[Referenced Investigation: "${folder.name}"]\n${details}`);
        displayText = displayText.replace(m.full, () => `@${folder.name}`);
      }
    }
  }

  const contextBlock = contextParts.length > 0
    ? '\n\n--- Referenced Entities ---\n' + contextParts.join('\n\n') + '\n--- End Referenced Entities ---'
    : '';

  return { displayText, contextBlock, hasMentions: true };
}
