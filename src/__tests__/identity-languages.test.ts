/**
 * F7: identities in every language the app is written in.
 * - A11Y-2 names in Chinese, Japanese, Thai and Korean text are found (word boundaries from
 *   Intl.Segmenter, Korean particles, two-character names); @ mentions after CJK punctuation.
 * - A11Y-8 only accents are ignored for "looks like", never Indic or Thai vowel signs.
 * - Case folding: Turkish İ/ı and German ß.
 * - A11Y-9 Data Import reads the interface language's words and reports what it cannot read.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Identity, IdentityStatus, Note } from '../types';
import { activityOf, buildIdentityIndex, findMentions, linkFor } from '../lib/identity-match';
import { CONNECTION_PHRASES, identityMatches, sameText, type ConnectionPhrase } from '../lib/identity-model';
import { buildIdentities, unrecognisedIdentityValues, type ImportWords } from '../lib/identity-import';
import type { ColumnMapping } from '../lib/data-import';

let n = 0;
const make = (name: string, extra: Partial<Identity> = {}): Identity => ({ id: `id-${++n}`, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const note = (content: string): Note => ({ id: `note-${++n}`, title: 'Note', content, folderId: 'case', tags: [], pinned: false,
  archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
const named = (identity: Identity, content: string) => activityOf(identity, { events: [], notes: [note(content)], iocs: [] }).notes.length === 1;

describe('Activity finds names in text written without spaces (A11Y-2)', () => {
  it('in Chinese, Japanese and Thai, by the word boundaries the segmenter finds', () => {
    expect(named(make('王伟'), '今天王伟批准了付款。')).toBe(true);
    expect(named(make('张小明'), '今天张小明批准了付款。')).toBe(true);
    expect(named(make('田中'), '田中さんが支払いを承認した。')).toBe(true);
    expect(named(make('สมชาย'), 'วันนี้สมชายอนุมัติการชำระเงิน')).toBe(true);
    expect(named(make('Dana'), 'Dana的报告')).toBe(true);
  });

  it('in Korean, before a particle, but not inside a longer word', () => {
    expect(named(make('김철수'), '오늘 김철수가 결제를 승인했다.')).toBe(true);
    expect(named(make('김철수'), '김철수 씨에게 물었다.')).toBe(true);
    expect(named(make('김철'), '오늘 김철수가 결제를 승인했다.')).toBe(false);
  });

  it('two-character names in Chinese, Japanese or Korean, but still not two Latin letters', () => {
    expect(named(make('王伟'), '今天 王伟 批准了付款。')).toBe(true);
    expect(named(make('田中'), '担当: 田中 。')).toBe(true);
    expect(named(make('Li'), 'Today Li approved it.')).toBe(false);
    // Hindi राम is three characters (a vowel sign counts), as before.
    expect(named(make('राम'), 'राम आया')).toBe(true);
  });

  it('keeps whole words in English and Hindi', () => {
    expect(named(make('Dana'), 'Danaher approved it.')).toBe(false);
    expect(named(make('राम'), 'रामा आया')).toBe(false);
  });

  it('lists a note whose preview links "@王伟" in 王伟\'s Activity', () => {
    const wang = make('王伟');
    expect(findMentions('@王伟 批准了付款。', buildIdentityIndex([wang]).folders.get('case'))).toHaveLength(1);
    expect(named(wang, '@王伟 批准了付款。')).toBe(true);
  });
});

describe('@ mentions in Chinese, Japanese and Korean (A11Y-2)', () => {
  const wang = make('王伟'), li = make('李娜'), kim = make('김철수');
  const index = buildIdentityIndex([wang, li, kim]).folders.get('case');
  it('start after full-width punctuation and end where the word does', () => {
    expect(findMentions('@王伟批准了', index).map(mention => mention.identity)).toEqual([wang]);
    expect(findMentions('王伟，@李娜 批准了', index).map(mention => mention.identity)).toEqual([li]);
    expect(findMentions('（@李娜）', index).map(mention => mention.identity)).toEqual([li]);
    expect(findMentions('「@王伟」と話した', index).map(mention => mention.identity)).toEqual([wang]);
    expect(findMentions('@김철수가 승인했다', index).map(mention => mention.identity)).toEqual([kim]);
  });

  it('still need a space or punctuation before the @, so an email address is no mention', () => {
    expect(findMentions('mail王伟@李娜.example', index)).toEqual([]);
  });
});

describe('"looks like" ignores accents only (A11Y-8)', () => {
  it('never offers another Hindi name as the same one', () => {
    const ram = make('राम');
    const index = buildIdentityIndex([ram]);
    for (const other of ['रीमा', 'रमा', 'रोमा']) expect(linkFor(index, 'case', other)).toEqual({ state: 'notYet', looksLike: undefined });
    expect(identityMatches(make('रीमा'), 'राम', 'Person')).toBe(false);
    expect(identityMatches(make('रमेश'), 'रीमा', 'Person')).toBe(false);
  });

  it('still offers a name that differs by accents or vowel points', () => {
    const jose = make('José Ruiz'), shalom = make('שָׁלוֹם'), ivan = make('Ёлкин');
    const index = buildIdentityIndex([jose, shalom, ivan]);
    expect(linkFor(index, 'case', 'Jose Ruiz')).toEqual({ state: 'notYet', looksLike: jose });
    expect(linkFor(index, 'case', 'שלום')).toEqual({ state: 'notYet', looksLike: shalom });
    expect(linkFor(index, 'case', 'Елкин')).toEqual({ state: 'notYet', looksLike: ivan });
  });
});

describe('case folding', () => {
  it('matches Turkish İ and ı and German ß in any case', () => {
    expect(sameText('IŞIK YILMAZ')).toBe(sameText('Işık Yılmaz'));
    expect(sameText('İSTANBUL')).toBe(sameText('istanbul'));
    expect(sameText('JANA STRAUSS')).toBe(sameText('Jana Strauß'));
    expect(sameText('STRAẞE')).toBe(sameText('Straße'));
    const index = buildIdentityIndex([make('Işık Yılmaz'), make('Jana Strauß')]);
    expect(linkFor(index, 'case', 'IŞIK YILMAZ').state).toBe('linked');
    expect(linkFor(index, 'case', 'JANA STRAUSS').state).toBe('linked');
  });
});

describe('Data Import in the interface language (A11Y-9)', () => {
  const read = (namespace: string) => JSON.parse(readFileSync(join(__dirname, '..', '..', 'public', 'locales', 'fr', `${namespace}.json`), 'utf8')) as Record<string, string>;
  const fr = read('identities'), common = read('common');
  const phrases = (prefix: string) => Object.fromEntries(Object.entries(CONNECTION_PHRASES).map(([phrase, key]) => [phrase, fr[`${prefix}.${key}`]])) as Record<ConnectionPhrase, string>;
  const words: ImportWords = {
    types: { person: fr['type.person'], organization: fr['type.organization'], system: fr['type.system'], account: fr['type.account'] },
    statuses: Object.fromEntries((['compromised', 'contained', 'suspicious', 'cleared'] as IdentityStatus[]).map(status => [status, fr[`status.${status}`]])),
    phrases: phrases('connection'), reversePhrases: phrases('connectionReverse'), yes: common.yes, no: common.no,
  };
  const mappings = new Map<string, ColumnMapping>([['Nom', 'identity-name'], ['Genre', 'identity-type'], ['Statut', 'identity-status'],
    ['Contact', 'identity-contact'], ['Liens', 'identity-connections']]);
  const rows = [
    { Nom: 'Halvorsen', Genre: 'Organisation', Statut: '', Contact: 'non', Liens: '' },
    { Nom: 'Dana Okafor', Genre: 'Personne', Statut: 'Compromis', Contact: 'oui', Liens: 'travaille chez: Halvorsen' },
    { Nom: 'Lee Park', Genre: 'person', Statut: 'suspicious', Contact: 'yes', Liens: 'emploie: Dana Okafor' },
  ];

  it('reads French types, statuses, yes and connections, and English as before', () => {
    const { created, errors } = buildIdentities(rows, mappings, { folderId: 'case', existing: [], words, now: 1 });
    const byName = new Map(created.map(identity => [identity.name, identity]));
    expect(byName.get('Dana Okafor')).toMatchObject({ type: 'person', status: 'compromised', contact: true });
    expect(byName.get('Dana Okafor')?.connections).toEqual([{ targetId: byName.get('Halvorsen')?.id, label: 'works at' }]);
    expect(byName.get('Halvorsen')).toMatchObject({ type: 'organization' });
    expect(byName.get('Halvorsen')?.contact).toBeUndefined();
    expect(byName.get('Lee Park')).toMatchObject({ type: 'person', status: 'suspicious', contact: true });
    // "Lee employs Dana" would be "Dana works at Lee", and Lee is not an organisation: skipped, as in the profile.
    expect(errors).toEqual(['Row 4: “Lee Park” is not an organization, so “emploie” was skipped.']);
    expect(unrecognisedIdentityValues(rows, mappings, { words })).toEqual({ types: [], statuses: [], contacts: [], phrases: [] });
  });

  it('says before importing which values it will not read, in a language it does not know', () => {
    expect(unrecognisedIdentityValues(rows, mappings)).toEqual({
      types: ['Personne'], statuses: ['Compromis'], contacts: ['non', 'oui'], phrases: ['travaille chez', 'emploie'],
    });
    // "Organisation" is English too; a type the investigation already uses is not new.
    expect(unrecognisedIdentityValues(rows, mappings, { typesInUse: ['personne'] }).types).toEqual([]);
  });
});
