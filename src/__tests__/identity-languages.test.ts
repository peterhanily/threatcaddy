/**
 * F7: identities in every language the app is written in.
 * - A11Y-2 names in Chinese, Japanese, Thai and Korean text are found (word boundaries from
 *   Intl.Segmenter, Korean particles, two-character names); @ mentions after CJK punctuation.
 * - A11Y-8 only accents are ignored for "looks like", never Indic or Thai vowel signs.
 * - Case folding: Turkish İ/ı and German ß.
 * - A11Y-9 Data Import reads the interface language's words and reports what it cannot read.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Identity, IdentityStatus, Note } from '../types';
import { activityOf, buildIdentityIndex, findMentions, linkFor } from '../lib/identity-match';
import { CONNECTION_PHRASES, identityMatches, sameText, withConnection, type ConnectionPhrase } from '../lib/identity-model';
import { MENTION_START } from '../lib/identity-match';
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

  it('in Korean, before one or two particles, but not inside a longer word', () => {
    expect(named(make('김철수'), '오늘 김철수가 결제를 승인했다.')).toBe(true);
    expect(named(make('김철수'), '김철수 씨에게 물었다.')).toBe(true);
    expect(named(make('김철수'), '김철수님이 승인했다.')).toBe(true);
    expect(named(make('김철수'), '김철수에게는 알렸다.')).toBe(true);
    expect(named(make('김철'), '오늘 김철수가 결제를 승인했다.')).toBe(false);
    // 아 starts 김민아 (another name), 도 starts 도시가스: neither is a particle here.
    expect(named(make('김민'), '김민아에게 보고했다.')).toBe(false);
    expect(named(make('서울', { type: 'organization' }), '서울도시가스에 연락했다.')).toBe(false);
    // The copula and a job title written onto the name.
    expect(named(make('김철수'), '담당자는 김철수입니다.')).toBe(true);
    expect(named(make('김철수'), '김철수부장이 승인했다.')).toBe(true);
    // Three parts: honorific, particle and topic.
    expect(named(make('김철수'), '김철수님께서는 승인했다.')).toBe(true);
    expect(named(make('김철수'), '김철수부장님께서 승인했다.')).toBe(true);
    expect(named(make('김철수'), '김철수씨에게는 알렸다.')).toBe(true);
  });

  it('spends the budget on segmenting as on comparing, so crafted Chinese text cannot stall a profile', () => {
    // Three 1 MB notes where every second position is a candidate that segmenting must reject.
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    const notes = Array.from({ length: 3 }, () => note('人民'.repeat(500_000)));
    const result = activityOf(make('民人'), { events: [], notes, iocs: [] });
    expect(result).toMatchObject({ notes: [], partial: true });
    // 50,000,000 characters of budget, a window of at least 34 characters weighted 8: under 184,000 segmentings
    // (unweighted, the 1,500,000 candidates would each be segmented).
    expect(segment.mock.calls.length).toBeLessThan(184_000);
    segment.mockRestore();
  });

  it('two-character names in Chinese, Japanese or Korean, but still not two Latin letters', () => {
    expect(named(make('王伟'), '今天 王伟 批准了付款。')).toBe(true);
    expect(named(make('田中'), '担当: 田中 。')).toBe(true);
    expect(named(make('Li'), 'Today Li approved it.')).toBe(false);
    // Hindi राम is three characters (a vowel sign counts), as before.
    expect(named(make('राम'), 'राम आया')).toBe(true);
  });

  it('keeps whole words in English and Hindi, also for a name that starts or ends with punctuation', () => {
    expect(named(make('Dana'), 'Danaher approved it.')).toBe(false);
    expect(named(make('राम'), 'रामा आया')).toBe(false);
    const handle = make('Payments desk', { type: 'account', details: [{ id: 'h', label: 'Handle', value: '@acme' }] });
    expect(named(handle, 'mail support@acme.example today')).toBe(false);
    expect(named(handle, 'paid @acme twice')).toBe(true);
    expect(named(make('Acme, Inc.'), 'Acme, Inc.x was paid')).toBe(false);
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

  it('find a name written with ss for ß, and in upper case', () => {
    const strauss = make('Jana Strauß');
    expect(findMentions('@JANA STRAUSS approved', buildIdentityIndex([strauss]).folders.get('case')).map(mention => mention.identity)).toEqual([strauss]);
  });

  it('start after punctuation, not after a CJK letter such as 々 or ＿', () => {
    for (const mark of ['，', '、', '（', '「', '【', '：']) expect(MENTION_START.test(mark)).toBe(true);
    for (const letter of ['々', '＿', '〇', '＠']) expect(MENTION_START.test(letter)).toBe(false);
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
    // Greek final sigma is a sigma, wherever upper case puts it back.
    expect(named(make('Κώστας'), "Κώστας's report")).toBe(true);
    expect(named(make('Κώστας'), 'ΚΏΣΤΑΣ ενέκρινε')).toBe(true);
    const index = buildIdentityIndex([make('Işık Yılmaz'), make('Jana Strauß')]);
    expect(linkFor(index, 'case', 'IŞIK YILMAZ').state).toBe('linked');
    expect(linkFor(index, 'case', 'JANA STRAUSS').state).toBe('linked');
  });
});

describe('connections', () => {
  it('keeps a connection already held when the other identity is no longer an organisation', () => {
    const dana = make('Dana', { connections: [{ targetId: 'acme', label: 'works at' }] });
    const acme = make('Acme', { id: 'acme', type: 'person' });
    expect(withConnection(dana, acme, 'works at')).toBe(dana.connections);
    expect(withConnection(make('Lee'), acme, 'works at')).toBeNull();
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

  it('names, in every language, the yes and no the import reads', () => {
    for (const language of ['ar', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'uk', 'vi', 'zh-CN']) {
      const locale = (namespace: string) => JSON.parse(readFileSync(join(__dirname, '..', '..', 'public', 'locales', language, `${namespace}.json`), 'utf8')) as Record<string, string>;
      const hint = locale('import')['identities.unrecognisedContacts'].toLowerCase();
      const { yes, no } = locale('common');
      expect([language, hint.includes(yes.toLowerCase()), hint.includes(no.toLowerCase())]).toEqual([language, true, true]);
    }
  });

  it('says before importing which values it will not read, in a language it does not know', () => {
    expect(unrecognisedIdentityValues(rows, mappings)).toEqual({
      types: ['Personne'], statuses: ['Compromis'], contacts: ['non', 'oui'], phrases: ['travaille chez', 'emploie'],
    });
    // "Organisation" is English too; a type the investigation already uses is not new.
    expect(unrecognisedIdentityValues(rows, mappings, { typesInUse: ['personne'] }).types).toEqual([]);
    // A phrase holding ": " splits where the import splits it: before a name it knows.
    const withColon = [{ Nom: 'Dana Okafor', Genre: '', Statut: '', Contact: '', Liens: '' }, { Nom: 'Lee Park', Genre: '', Statut: '', Contact: '', Liens: 'Ops: Team lead: Dana Okafor' }];
    expect(unrecognisedIdentityValues(withColon, mappings).phrases).toEqual(['Ops: Team lead']);
    expect(buildIdentities(withColon, mappings, { folderId: 'case', existing: [], now: 1 }).created.find(identity => identity.name === 'Lee Park')?.connections)
      .toEqual([expect.objectContaining({ label: 'Ops: Team lead' })]);
  });
});
