/**
 * Links text in an investigation to its identities by matching at display time. Owner
 * decision 1: no identity IDs are stored on events, notes or IOCs, so renaming or merging
 * an identity never rewrites them. Matching is per investigation, ignores case and spacing,
 * and treats a difference only in accents as a "looks like" that a person confirms.
 */
import type { Identity, Note, StandaloneIOC, TimelineEvent } from '../types';
import { detailKey, knownTexts, looseText, sameText, sortedByName } from './identity-model';

/** Longer text (a pasted paragraph in Actor, say) is never matched. */
export const MAX_MATCH_LENGTH = 200;
/** The longest name an `@` mention can name, in characters. */
const MAX_MENTION_LENGTH = 100;
/** Shorter names and details (in characters, a vowel sign counted: राम is three) are not looked for in
 * note text: too many false mentions. Written in Chinese, Japanese or Korean, two characters are a name (王伟, 田中). */
const MIN_MENTION_LENGTH = 3;
const IDEOGRAPHIC = /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}]+$/u;
const lookedFor = (text: string) => {
  const characters = [...text].length;
  return characters >= MIN_MENTION_LENGTH || (characters === 2 && IDEOGRAPHIC.test(text));
};

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
  for (const [folderId, unsorted] of groups) {
    // Whether anything changed, in id order (cheap), before the name sort: most rebuilds follow a
    // change elsewhere (a note saved) and keep every investigation's index.
    const signature = [...unsorted].sort((a, b) => (a.identity.id < b.identity.id ? -1 : a.identity.id > b.identity.id ? 1 : 0))
      .map(({ identity, linkable }) => `${identity.id}:${identity.updatedAt}:${linkable ? 1 : 0}`).join('|');
    const previous = options.previous?.folders.get(folderId);
    if (previous?.signature === signature) { folders.set(folderId, previous); continue; }
    const group = sortedByName(unsorted, entry => entry.identity);
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
        // As typed or as folded ("Strauß" is also written "STRAUSS", one character longer).
        folder.longestName = Math.max(folder.longestName, name.length, key.length);
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

/**
 * How reports group text that may name an identity (an event's Actor, an IOC's attribution): by
 * the identity when the text names exactly one, otherwise by the text as written. Ambiguous text
 * is not merged, because a person has not decided which identity it is. Across investigations,
 * identities with the same name share one row, as their names did before.
 */
export function reportGroup(link: TextLink | undefined, text: string): { key: string; label: string; identity?: Identity } {
  return link?.state === 'linked' && link.others === 0
    ? { key: `identity:${sameText(link.identity.name)}`, label: link.identity.name, identity: link.identity }
    : { key: `text:${text}`, label: text };
}

/** A letter, digit or combining mark: accents written as separate marks (NFD text) and the vowel
 * signs of Hindi or Thai belong to the word, so "@José" is not "@Jose" plus a mark. */
const WORD = /[\p{L}\p{M}\p{N}_]/u;
/** Scripts written without spaces between words: their word boundaries come from `Intl.Segmenter`. */
const UNSPACED = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]/u;
const HANGUL = /\p{scx=Hangul}/u;
/** Korean writes particles straight after a name (김철수가, 김철수에게는, 김철수님이): the name ends there when
 * the rest of the word is one or two particles, so 김민 is not found in 김민아 or 서울 in 서울도시가스. */
// Particles, the copula (김철수입니다, 김철수였다) and job titles written onto a name (김철수부장).
const KOREAN_PARTICLES = '(?:이|가|은|는|을|를|의|에게서|에게|에서|에|께서|께|한테서|한테|와|과|이랑|랑|하고|도|만|으로|로|부터|까지|보다|처럼|이나|나|님|씨'
  + '|입니다|이다|였다|이었다|이고|이며|이라고|라고|부장|차장|과장|대리|사장|팀장|실장|대표)';
const KOREAN_PARTICLE = new RegExp(`^${KOREAN_PARTICLES}{1,2}$`, 'u');
const HANGUL_RUN = /^\p{scx=Hangul}+/u;
/** Longer than any one or two particles: the rest of the word is read from at most this many characters. */
const PARTICLE_WINDOW = 8;
/** Locale-independent: dictionary word breaks for Chinese, Japanese and Thai do not depend on the locale. */
const WORDS = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'word' }) : undefined;
/** Characters of context either side of a match given to the segmenter. */
const SEGMENT_CONTEXT = 16;
/** What segmenting a character costs, in characters compared: about 3 µs for a window of 36, so a
 * crafted note of Chinese or Thai text spends its budget no faster in time than one of Latin text. */
const SEGMENT_WEIGHT = 8;
/** Where an `@` can start a mention: at the start, or after a space, an opening bracket, a quote, or
 * the punctuation of Chinese and Japanese (，、。（「【：), not their letters (々, ＿). */
export const MENTION_START = /[\s([{"'“‘«\u3001-\u3004\u3008-\u3011\u3014-\u301f\uff01-\uff0f\uff1a-\uff1f\uff3b-\uff3e\uff40\uff5b-\uff65]/;

/** The character (a whole code point) just before and just at `at`. */
const charBefore = (text: string, at: number) => (at > 0 ? String.fromCodePoint(text.codePointAt(at >= 2 && /[\udc00-\udfff]/.test(text[at - 1]) ? at - 2 : at - 1) ?? 0) : '');
const charAt = (text: string, at: number) => (at < text.length ? String.fromCodePoint(text.codePointAt(at) ?? 0) : '');

/** Word boundaries the segmenter finds in `text` around `from`–`to`. `budget.work` counts the characters it reads. */
function segmentBoundaries(text: string, from: number, to: number, budget: { work: number }): Set<number> {
  const start = Math.max(0, from - SEGMENT_CONTEXT);
  const window = text.slice(start, Math.min(text.length, to + SEGMENT_CONTEXT));
  budget.work += window.length * SEGMENT_WEIGHT;
  const boundaries = new Set<number>();
  if (WORDS) for (const { index } of WORDS.segment(window)) boundaries.add(start + index);
  boundaries.add(start + window.length);
  return boundaries;
}

/**
 * Whether a name can start (or, with `end`, end) at `at` in `text`: next to a space, punctuation or the
 * text's edge; between a Korean name and its particle; at a change between Hangul and another script; or,
 * in Chinese, Japanese or Thai, where the segmenter puts a word boundary (`boundaries`, worked out once).
 */
function wordBoundary(text: string, at: number, end: boolean, boundaries: () => Set<number>): boolean {
  const before = charBefore(text, at), after = charAt(text, at);
  // The character outside the match decides first: no letter there, a boundary; a letter there next to
  // the match's own punctuation ("support" + "@acme"), part of a longer word.
  const outside = end ? after : before, inside = end ? before : after;
  if (!outside || !WORD.test(outside)) return true;
  if (!inside || !WORD.test(inside)) return false;
  const unspaced = UNSPACED.test(before) || UNSPACED.test(after);
  const hangulBefore = HANGUL.test(before), hangulAfter = HANGUL.test(after);
  if (hangulBefore && hangulAfter) {
    if (!end) return false;
    const rest = text.slice(at, at + PARTICLE_WINDOW).match(HANGUL_RUN)?.[0] ?? '';
    return rest.length < PARTICLE_WINDOW && KOREAN_PARTICLE.test(rest);
  }
  if (hangulBefore !== hangulAfter && !unspaced) return true;
  return unspaced && boundaries().has(at);
}

export interface Mention { start: number; end: number; identity: Identity }

/** Characters compared per text. 90,000 "@" signs that could each start a name cost about 3.4
 * million; a crafted note (long names, many word breaks after each "@") would cost over 170
 * million, and stops here instead of stalling a render. */
const MAX_MENTION_WORK = 8_000_000;

/**
 * `@Name` mentions in text: the longest name or other name of an identity in the
 * investigation that follows an `@` and ends at a word boundary. Each `@` that could start a
 * name tries at most `MAX_MENTION_LENGTH` end positions, with no regex built from names, and the
 * text is scanned until `MAX_MENTION_WORK` characters have been compared, so a crafted note cannot stall a render.
 */
export function findMentions(text: string, folder: FolderIndex | undefined,
  /** Shared by every text of one note (its paragraphs), so splitting a note cannot multiply the work. */
  budget: { work: number } = { work: 0 }): Mention[] {
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
    let segmented: Set<number> | undefined;
    const boundaries = () => (segmented ??= segmentBoundaries(text, at + 1, at + 1 + region.length, budget));
    for (let end = Math.min(region.length, longest); end > 0; end--) {
      if (/\s/.test(region[end - 1])) continue;
      // The mention ends where a word does: in Chinese or Japanese text, often straight before more text.
      if (!wordBoundary(text, at + 1 + end, true, boundaries)) continue;
      budget.work += end;
      if (budget.work > MAX_MENTION_WORK) return mentions;
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

/** Whether `haystack` (already through `sameText`) contains `needle` as whole words. Each match
 * examined spends what finding it compared from `budget` (the needle, and any text segmented around it);
 * false once spent. */
function containsWords(haystack: string, needle: string, budget: { left: number }): boolean {
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    budget.left -= needle.length;
    if (budget.left < 0) return false;
    let segmented: Set<number> | undefined;
    const boundaries = () => {
      if (segmented) return segmented;
      const work = { work: 0 };
      segmented = segmentBoundaries(haystack, at, at + needle.length, work);
      budget.left -= work.work;
      return segmented;
    };
    if (wordBoundary(haystack, at, false, boundaries) && wordBoundary(haystack, at + needle.length, true, boundaries)) return true;
  }
  return false;
}

/** A note's title and text as matching sees them, computed once per note for `activityOf`. */
export const noteMatchText = (note: Pick<Note, 'title' | 'content'>) => sameText(`${note.title}\n${note.content}`);

export interface IdentityActivity {
  events: TimelineEvent[];
  notes: Note[];
  iocs: StandaloneIOC[];
  /** Notes were not all searched for every name and detail: too many of them, or too much text. */
  partial?: boolean;
}

/** At most this many names, other names and public details are looked for in notes (more than the
 * app lets a person or a tool add), each at most MAX_MATCH_LENGTH long as linking does, and at most
 * this many characters compared at matches: a crafted identity ("aaa", "aaaa"… against notes of "a")
 * cannot stall the render that shows its profile. */
const MAX_ACTIVITY_WORDS = 500;
const MAX_ACTIVITY_WORK = 50_000_000;

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
  const searchable = [...keys].filter(text => lookedFor(text) && text.length <= MAX_MATCH_LENGTH);
  // The name first (knownTexts lists it first), then other names and details, up to the cap.
  const words = searchable.slice(0, MAX_ACTIVITY_WORDS);
  const budget = { left: MAX_ACTIVITY_WORK };
  const named = (text: string | undefined) => !!text && (keys.has(sameText(text)) || details.has(detailKey(text)));
  // Newest first, so a budget spent on old notes never hides recent ones.
  const notes = records.notes.filter(note => inFolder(note) && !note.isFolder).sort((a, b) => b.updatedAt - a.updatedAt).filter(note => {
    if (budget.left < 0) return false;
    const text = records.noteTexts?.get(note.id) ?? noteMatchText(note);
    return words.some(word => containsWords(text, word, budget));
  });
  return {
    events: records.events.filter(event => inFolder(event) && (named(event.actor) || (event.assets ?? []).some(named)))
      .sort((a, b) => b.timestamp - a.timestamp),
    notes,
    iocs: records.iocs.filter(ioc => inFolder(ioc) && (named(ioc.value) || (!!ioc.attribution && names.has(sameText(ioc.attribution)))))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    ...(searchable.length > words.length || budget.left < 0 ? { partial: true } : {}),
  };
}
