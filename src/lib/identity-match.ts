/**
 * Links text in an investigation to its identities by matching at display time. Owner
 * decision 1: no identity IDs are stored on events, notes or IOCs, so renaming or merging
 * an identity never rewrites them. Matching is per investigation, ignores case and spacing,
 * and treats a difference only in accents as a "looks like" that a person confirms.
 */
import type { Identity, Note, StandaloneIOC, TimelineEvent } from '../types';
import { byName, detailKey, knownTexts, looseText, sameText } from './identity-model';

/** Longer text (a pasted paragraph in Actor, say) is never matched. */
export const MAX_MATCH_LENGTH = 200;
/** The longest name an `@` mention can name, in characters. */
const MAX_MENTION_LENGTH = 100;
/** Shorter names and details are not looked for in note text: too many false mentions. */
const MIN_MENTION_LENGTH = 3;

export interface FolderIndex {
  /** Names and other names of identities that can be linked, A–Z; also used for `@` mentions. */
  names: Map<string, Identity[]>;
  /** Details that are not private, by `detailKey` (spaces removed: a grouped IBAN matches an
   * ungrouped one). A name outranks a detail: "WS-01" links to the system named WS-01 before an
   * account that lists WS-01 as its hostname. */
  details: Map<string, Identity[]>;
  /** The first letter of every name (and of every "@handle" after its "@"), and the longest
   * name, so `findMentions` skips most "@" signs at once. */
  firstLetters: Set<string>;
  longestName: number;
  /** Names and other names without accents, for "looks like" suggestions. */
  loose: Map<string, Identity>;
  /** Text that is known but never linked or offered: private detail values, and the
   * names and details of archived identities or ones hidden while screensharing. */
  known: Set<string>;
  /** Linkable identities, A–Z. */
  identities: Identity[];
  /** Changes when anything that affects this investigation's links changes, so an unchanged
   * investigation keeps the same index object across rebuilds (and memoised renders stay valid). */
  signature: string;
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
 * those `isVisible` rejects (screenshare) are known but never linked. With `previous`, an
 * investigation whose identities have not changed keeps its previous index object.
 */
export function buildIdentityIndex(identities: readonly Identity[], options: {
  isVisible?: (identity: Identity) => boolean;
  threatActors?: readonly string[];
  previous?: IdentityIndex;
} = {}): IdentityIndex {
  const groups = new Map<string, { identity: Identity; linkable: boolean }[]>();
  for (const identity of identities) {
    if (identity.trashed || !identity.folderId) continue;
    const linkable = !identity.archived && (!options.isVisible || options.isVisible(identity));
    const group = groups.get(identity.folderId);
    if (group) group.push({ identity, linkable }); else groups.set(identity.folderId, [{ identity, linkable }]);
  }
  const folders = new Map<string, FolderIndex>();
  for (const [folderId, group] of groups) {
    group.sort((a, b) => byName(a.identity, b.identity));
    const signature = group.map(({ identity, linkable }) => `${identity.id}:${identity.updatedAt}:${linkable ? 1 : 0}`).join('|');
    const previous = options.previous?.folders.get(folderId);
    if (previous?.signature === signature) { folders.set(folderId, previous); continue; }
    const folder: FolderIndex = { names: new Map(), details: new Map(), loose: new Map(), known: new Set(), identities: [], signature,
      firstLetters: new Set(), longestName: 0 };
    for (const { identity, linkable } of group) {
      identity.details.filter(detail => detail.private).forEach(detail => { folder.known.add(sameText(detail.value)); folder.known.add(detailKey(detail.value)); });
      if (!linkable) {
        knownTexts(identity).forEach(text => folder.known.add(text));
        identity.details.forEach(detail => folder.known.add(detailKey(detail.value)));
        continue;
      }
      folder.identities.push(identity);
      for (const name of [identity.name, ...identity.aliases]) {
        const key = sameText(name);
        if (!key) continue;
        push(folder.names, key, identity);
        folder.firstLetters.add(key.replace(/^@/, '').charAt(0));
        folder.longestName = Math.max(folder.longestName, name.length);
        const loose = looseText(name);
        if (loose && !folder.loose.has(loose)) folder.loose.set(loose, identity);
      }
      identity.details.filter(detail => !detail.private).forEach(detail => push(folder.details, detailKey(detail.value), identity));
    }
    folders.set(folderId, folder);
  }
  return { folders, actors: new Set((options.threatActors ?? []).map(sameText)) };
}

/** The identities a text names in an investigation: by name or other name first, else by a public detail. */
function named(folder: FolderIndex | undefined, text: string): Identity[] | undefined {
  const byName = folder?.names.get(sameText(text));
  return byName?.length ? byName : folder?.details.get(detailKey(text));
}

/** How text in an investigation shows: linked to an identity, not yet in Identities, or plain. */
export function linkFor(index: IdentityIndex, folderId: string | undefined, raw: string | undefined,
  isIgnored?: (folderId: string, text: string) => boolean): TextLink {
  const text = raw?.trim() ?? '';
  if (!folderId || !text || text.length > MAX_MATCH_LENGTH) return { state: 'plain' };
  const key = sameText(text);
  const folder = index.folders.get(folderId);
  const exact = named(folder, text);
  // An identity with a threat actor's name links: the analyst recorded it as an identity.
  if (exact?.length) return { state: 'linked', identity: exact[0], others: exact.length - 1 };
  if (folder?.known.has(key) || folder?.known.has(detailKey(text)) || index.actors.has(key) || isIgnored?.(folderId, text)) return { state: 'plain' };
  return { state: 'notYet', looksLike: folder?.loose.get(looseText(text)) };
}

/** The identity an IOC belongs to: one whose name, other name or public detail is the IOC's value.
 * `others` counts further identities with the same value, as for `linkFor`. */
export function belongsTo(index: IdentityIndex, ioc: Pick<StandaloneIOC, 'folderId' | 'value'>): { identity: Identity; others: number } | undefined {
  if (!ioc.folderId || !ioc.value || ioc.value.length > MAX_MATCH_LENGTH) return undefined;
  const owners = named(index.folders.get(ioc.folderId), ioc.value);
  return owners?.length ? { identity: owners[0], others: owners.length - 1 } : undefined;
}

/** A letter, digit or combining mark: accents written as separate marks (NFD text) and the vowel
 * signs of Hindi or Thai belong to the word, so "@José" is not "@Jose" plus a mark. */
const WORD = /[\p{L}\p{M}\p{N}_]/u;
/** Where an `@` can start a mention: at the start, or after a space, an opening bracket or a quote. */
export const MENTION_START = /[\s([{"'“‘«]/;

export interface Mention { start: number; end: number; identity: Identity }

/**
 * `@Name` mentions in text: the longest name or other name of an identity in the
 * investigation that follows an `@` and ends at a word boundary. Linear in the text: each
 * `@` tries at most `MAX_MENTION_LENGTH` end positions, with no regex built from names.
 */
export function findMentions(text: string, folder: FolderIndex | undefined): Mention[] {
  if (!folder || folder.names.size === 0) return [];
  const longest = Math.min(folder.longestName, MAX_MENTION_LENGTH);
  const mentions: Mention[] = [];
  let from = 0;
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', from)) {
    from = at + 1;
    if (at > 0 && !MENTION_START.test(text[at - 1])) continue;
    const region = text.slice(at + 1, at + 1 + longest + 1).split('\n')[0];
    // Most "@" signs start no name: skip them without trying every length.
    if (!folder.firstLetters.has(sameText(region.slice(0, 2)).charAt(0))) continue;
    for (let end = Math.min(region.length, longest); end > 0; end--) {
      if (end < region.length && WORD.test(region[end])) continue;
      if (/\s/.test(region[end - 1])) continue;
      const key = sameText(region.slice(0, end));
      // A handle stored with its "@" ("@ghost_ledger") matches as typed.
      const found = folder.names.get(key) ?? folder.names.get(`@${key}`);
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

/** A note's title and text as matching sees them, computed once per note for `activityOf`. */
export const noteMatchText = (note: Pick<Note, 'title' | 'content'>) => sameText(`${note.title}\n${note.content}`);

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
  /** Precomputed `noteMatchText` by note ID, so large notes are normalised once, not per identity. */
  noteTexts?: ReadonlyMap<string, string>;
}): IdentityActivity {
  const inFolder = <T extends { folderId?: string; trashed: boolean; archived: boolean }>(item: T) =>
    item.folderId === identity.folderId && !item.trashed && !item.archived;
  const keys = new Set(knownTexts(identity));
  const details = new Set(identity.details.filter(detail => !detail.private).map(detail => detailKey(detail.value)));
  const names = new Set([identity.name, ...identity.aliases].map(sameText).filter(Boolean));
  const words = [...keys].filter(text => text.length >= MIN_MENTION_LENGTH);
  const named = (text: string | undefined) => !!text && (keys.has(sameText(text)) || details.has(detailKey(text)));
  return {
    events: records.events.filter(event => inFolder(event) && (named(event.actor) || (event.assets ?? []).some(named)))
      .sort((a, b) => b.timestamp - a.timestamp),
    notes: records.notes.filter(note => {
      if (!inFolder(note) || note.isFolder) return false;
      const text = records.noteTexts?.get(note.id) ?? noteMatchText(note);
      return words.some(word => containsWords(text, word));
    }).sort((a, b) => b.updatedAt - a.updatedAt),
    iocs: records.iocs.filter(ioc => inFolder(ioc) && (named(ioc.value) || (!!ioc.attribution && names.has(sameText(ioc.attribution)))))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  };
}
