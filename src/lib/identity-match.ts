/**
 * Links text in an investigation to its identities by matching at display time. Owner
 * decision 1: no identity IDs are stored on events, notes or IOCs, so renaming or merging
 * an identity never rewrites them. Matching is per investigation, ignores case and spacing,
 * and treats a difference only in accents as a "looks like" that a person confirms.
 */
import type { Identity, Note, StandaloneIOC, TimelineEvent } from '../types';
import { byName, knownTexts, looseText, sameText } from './identity-model';

/** Longer text (a pasted paragraph in Actor, say) is never matched. */
export const MAX_MATCH_LENGTH = 200;
/** The longest name an `@` mention can name, in characters. */
const MAX_MENTION_LENGTH = 100;
/** Shorter names and details are not looked for in note text: too many false mentions. */
const MIN_MENTION_LENGTH = 3;

export interface FolderIndex {
  /** Names, other names and details that are not private, of identities that can be linked, A–Z. */
  exact: Map<string, Identity[]>;
  /** Names and other names only, for `@` mentions. */
  names: Map<string, Identity[]>;
  /** Names and other names without accents, for "looks like" suggestions. */
  loose: Map<string, Identity>;
  /** Text that is known but never linked or offered: private detail values, and the
   * names and details of archived identities or ones hidden while screensharing. */
  known: Set<string>;
  /** Linkable identities, A–Z. */
  identities: Identity[];
}

export interface IdentityIndex {
  folders: Map<string, FolderIndex>;
  /** Threat actor names from Settings; tracked separately from identities. */
  actors: Set<string>;
}

export type TextLink =
  /** Names an identity. `others` counts further identities with the same name or detail. */
  | { state: 'linked'; identity: Identity; others: number }
  /** Not in Identities yet: can be added, linked as another name, or ignored. */
  | { state: 'notYet'; looksLike?: Identity }
  /** Shown as plain text: a threat actor, an ignored name, a concealed match, or no investigation. */
  | { state: 'plain' };

const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
};

/**
 * Indexes identities per investigation. Trashed identities are left out; archived ones and
 * those `isVisible` rejects (screenshare) are known but never linked.
 */
export function buildIdentityIndex(identities: readonly Identity[], options: {
  isVisible?: (identity: Identity) => boolean;
  threatActors?: readonly string[];
} = {}): IdentityIndex {
  const folders = new Map<string, FolderIndex>();
  for (const identity of [...identities].sort(byName)) {
    if (identity.trashed || !identity.folderId) continue;
    let folder = folders.get(identity.folderId);
    if (!folder) folders.set(identity.folderId, folder = { exact: new Map(), names: new Map(), loose: new Map(), known: new Set(), identities: [] });
    identity.details.filter(detail => detail.private).forEach(detail => folder.known.add(sameText(detail.value)));
    if (identity.archived || (options.isVisible && !options.isVisible(identity))) {
      knownTexts(identity).forEach(text => folder.known.add(text));
      continue;
    }
    folder.identities.push(identity);
    knownTexts(identity).forEach(text => push(folder.exact, text, identity));
    for (const name of [identity.name, ...identity.aliases]) {
      push(folder.names, sameText(name), identity);
      const loose = looseText(name);
      if (loose && !folder.loose.has(loose)) folder.loose.set(loose, identity);
    }
  }
  return { folders, actors: new Set((options.threatActors ?? []).map(sameText)) };
}

/** How text in an investigation shows: linked to an identity, not yet in Identities, or plain. */
export function linkFor(index: IdentityIndex, folderId: string | undefined, raw: string | undefined,
  isIgnored?: (folderId: string, text: string) => boolean): TextLink {
  const text = raw?.trim() ?? '';
  if (!folderId || !text || text.length > MAX_MATCH_LENGTH) return { state: 'plain' };
  const key = sameText(text);
  const folder = index.folders.get(folderId);
  const exact = folder?.exact.get(key);
  if (exact?.length) return { state: 'linked', identity: exact[0], others: exact.length - 1 };
  if (folder?.known.has(key) || index.actors.has(key) || isIgnored?.(folderId, text)) return { state: 'plain' };
  return { state: 'notYet', looksLike: folder?.loose.get(looseText(text)) };
}

/** The identity an IOC belongs to: one whose name, other name or public detail is the IOC's value. */
export function belongsTo(index: IdentityIndex, ioc: Pick<StandaloneIOC, 'folderId' | 'value'>): Identity | undefined {
  if (!ioc.folderId || !ioc.value || ioc.value.length > MAX_MATCH_LENGTH) return undefined;
  return index.folders.get(ioc.folderId)?.exact.get(sameText(ioc.value))?.[0];
}

const WORD = /[\p{L}\p{N}_]/u;
/** Where an `@` can start a mention: at the start, or after a space or an opening bracket. */
const MENTION_START = /[\s(]/;

export interface Mention { start: number; end: number; identity: Identity }

/**
 * `@Name` mentions in text: the longest name or other name of an identity in the
 * investigation that follows an `@` and ends at a word boundary. Linear in the text: each
 * `@` tries at most `MAX_MENTION_LENGTH` end positions, with no regex built from names.
 */
export function findMentions(text: string, folder: FolderIndex | undefined): Mention[] {
  if (!folder || folder.names.size === 0) return [];
  const mentions: Mention[] = [];
  let from = 0;
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', from)) {
    from = at + 1;
    if (at > 0 && !MENTION_START.test(text[at - 1])) continue;
    const region = text.slice(at + 1, at + 1 + MAX_MENTION_LENGTH + 1).split('\n')[0];
    for (let end = Math.min(region.length, MAX_MENTION_LENGTH); end > 0; end--) {
      if (end < region.length && WORD.test(region[end])) continue;
      if (/\s/.test(region[end - 1])) continue;
      const found = folder.names.get(sameText(region.slice(0, end)));
      if (found?.length) {
        mentions.push({ start: at, end: at + 1 + end, identity: found[0] });
        from = at + 1 + end;
        break;
      }
    }
  }
  return mentions;
}

/** Whether `haystack` (already through `sameText`) contains `needle` as whole words. */
function containsWords(haystack: string, needle: string): boolean {
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = at > 0 ? haystack[at - 1] : '';
    const after = haystack[at + needle.length] ?? '';
    if (!(before && WORD.test(before)) && !(after && WORD.test(after))) return true;
  }
  return false;
}

export interface IdentityActivity {
  events: TimelineEvent[];
  notes: Note[];
  iocs: StandaloneIOC[];
}

/**
 * Where an identity appears in its investigation: events whose Actor or Assets name it,
 * notes that mention its name, other names or public details as whole words, and IOCs
 * whose value is one of those or whose attribution is its name. Newest first.
 */
export function activityOf(identity: Identity, records: {
  events: readonly TimelineEvent[]; notes: readonly Note[]; iocs: readonly StandaloneIOC[];
}): IdentityActivity {
  const inFolder = <T extends { folderId?: string; trashed: boolean; archived: boolean }>(item: T) =>
    item.folderId === identity.folderId && !item.trashed && !item.archived;
  const keys = new Set(knownTexts(identity));
  const names = new Set([identity.name, ...identity.aliases].map(sameText).filter(Boolean));
  const words = [...keys].filter(text => text.length >= MIN_MENTION_LENGTH);
  const named = (text: string | undefined) => !!text && keys.has(sameText(text));
  return {
    events: records.events.filter(event => inFolder(event) && (named(event.actor) || (event.assets ?? []).some(named)))
      .sort((a, b) => b.timestamp - a.timestamp),
    notes: records.notes.filter(note => {
      if (!inFolder(note) || note.isFolder) return false;
      const text = sameText(`${note.title}\n${note.content}`);
      return words.some(word => containsWords(text, word));
    }).sort((a, b) => b.updatedAt - a.updatedAt),
    iocs: records.iocs.filter(ioc => inFolder(ioc) && (named(ioc.value) || (!!ioc.attribution && names.has(sameText(ioc.attribution)))))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  };
}
