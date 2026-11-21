import { describe, expect, it } from 'vitest';
import type { Identity, Note, StandaloneIOC, TimelineEvent } from '../types';
import { activityOf, belongsTo, buildIdentityIndex, findMentions, linkFor, MAX_MATCH_LENGTH } from '../lib/identity-match';

let n = 0;
const make = (name: string, extra: Partial<Identity> = {}): Identity => ({ id: extra.id ?? `id-${++n}`, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const event = (extra: Partial<TimelineEvent>): TimelineEvent => ({ id: `ev-${++n}`, title: 'Event', timestamp: 1, eventType: 'other', source: '', confidence: 'medium',
  linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'case', timelineId: 't',
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra } as TimelineEvent);
const ioc = (extra: Partial<StandaloneIOC>): StandaloneIOC => ({ id: `ioc-${++n}`, type: 'domain', value: 'x.example', confidence: 'medium', folderId: 'case', tags: [],
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra } as StandaloneIOC);
const note = (content: string, extra: Partial<Note> = {}): Note => ({ id: `note-${++n}`, title: 'Note', content, folderId: 'case', tags: [], pinned: false,
  archived: false, trashed: false, createdAt: 1, updatedAt: 1, ...extra });

const tomas = make('Tomas Lindqvist', { aliases: ['T. Lindqvist'], details: [{ id: 'd1', label: 'Email', value: 'tomas@halvorsen.example' },
  { id: 'd2', label: 'Phone', value: '+44 7700 900123', private: true }] });
const server = make('FIN-DB01', { type: 'system', details: [{ id: 'd3', label: 'IP address', value: '10.20.14.88' }] });
const iban = make('Supplier account', { type: 'account', details: [{ id: 'd4', label: 'IBAN', value: 'GB33BUKB20201555555555' }] });
const archived = make('Old Contractor', { archived: true });
const elsewhere = make('Tomas Lindqvist', { folderId: 'other' });

describe('linkFor', () => {
  const index = buildIdentityIndex([tomas, server, iban, archived, elsewhere], { threatActors: ['APT29'] });

  it('links names, other names and public details, ignoring case and spacing, within the investigation only', () => {
    expect(linkFor(index, 'case', '  tomas   LINDQVIST ')).toEqual({ state: 'linked', identity: tomas, others: 0 });
    expect(linkFor(index, 'case', 'T. Lindqvist')).toMatchObject({ state: 'linked', identity: tomas });
    expect(linkFor(index, 'case', 'TOMAS@halvorsen.example')).toMatchObject({ state: 'linked', identity: tomas });
    expect(linkFor(index, 'case', '10.20.14.88')).toMatchObject({ state: 'linked', identity: server });
    expect(linkFor(index, 'case', 'GB33BUKB20201555555555')).toMatchObject({ state: 'linked', identity: iban });
    expect(linkFor(index, 'other', 'Tomas Lindqvist')).toMatchObject({ state: 'linked', identity: elsewhere });
    expect(linkFor(index, 'third', 'Tomas Lindqvist')).toEqual({ state: 'notYet', looksLike: undefined });
  });

  it('offers a name that differs only by accents as "looks like", never as a link', () => {
    expect(linkFor(index, 'case', 'Tomás Lindqvist')).toEqual({ state: 'notYet', looksLike: tomas });
    expect(linkFor(index, 'case', 'Dana Okafor')).toEqual({ state: 'notYet', looksLike: undefined });
  });

  it('keeps private values, archived identities, threat actors, ignored names and long text plain', () => {
    expect(linkFor(index, 'case', '+44 7700 900123')).toEqual({ state: 'plain' });
    expect(linkFor(index, 'case', 'old contractor')).toEqual({ state: 'plain' });
    expect(linkFor(index, 'case', 'apt29')).toEqual({ state: 'plain' });
    expect(linkFor(index, 'case', 'Dana Okafor', (folderId, text) => folderId === 'case' && text === 'Dana Okafor')).toEqual({ state: 'plain' });
    expect(linkFor(index, 'case', 'x'.repeat(MAX_MATCH_LENGTH + 1))).toEqual({ state: 'plain' });
    expect(linkFor(index, undefined, 'Tomas Lindqvist')).toEqual({ state: 'plain' });
    expect(linkFor(index, 'case', '   ')).toEqual({ state: 'plain' });
  });

  it('keeps identities hidden while screensharing plain, so their names are neither linked nor offered again', () => {
    const shared = buildIdentityIndex([tomas, server], { isVisible: identity => identity.id !== tomas.id });
    expect(linkFor(shared, 'case', 'Tomas Lindqvist')).toEqual({ state: 'plain' });
    expect(linkFor(shared, 'case', 'tomas@halvorsen.example')).toEqual({ state: 'plain' });
    expect(linkFor(shared, 'case', 'FIN-DB01')).toMatchObject({ state: 'linked', identity: server });
  });

  it('links a name two identities share to the first A–Z and counts the others', () => {
    const second = make('Zed Tomas', { aliases: ['FIN-DB01'] });
    const shared = buildIdentityIndex([second, server]);
    expect(linkFor(shared, 'case', 'fin-db01')).toEqual({ state: 'linked', identity: server, others: 1 });
  });

  it('ignores trashed identities entirely', () => {
    const trashed = make('Binned Person', { trashed: true });
    expect(linkFor(buildIdentityIndex([trashed]), 'case', 'Binned Person')).toEqual({ state: 'notYet', looksLike: undefined });
  });
});

describe('belongsTo', () => {
  const index = buildIdentityIndex([tomas, server]);
  it('finds the identity whose name or public detail is the IOC value, in the same investigation', () => {
    expect(belongsTo(index, ioc({ type: 'email', value: 'tomas@halvorsen.example' }))).toBe(tomas);
    expect(belongsTo(index, ioc({ type: 'ipv4', value: '10.20.14.88' }))).toBe(server);
    expect(belongsTo(index, ioc({ type: 'ipv4', value: '10.20.14.88', folderId: 'other' }))).toBeUndefined();
    expect(belongsTo(index, ioc({ type: 'domain', value: '+44 7700 900123' }))).toBeUndefined();
  });
});

describe('findMentions', () => {
  const dana = make('Dana Okafor', { aliases: ['Okafor, Dana'] });
  const acme = make('Acme, Inc.', { type: 'organization' });
  const dan = make('Dan');
  const folder = buildIdentityIndex([tomas, dana, acme, dan, archived]).folders.get('case');

  it('finds the longest name after an @ that ends at a word boundary', () => {
    const text = '@Dana Okafor approved it; cc @dan. Paid by (@Acme, Inc.), see @Tomas Lindqvist\'s note.';
    expect(findMentions(text, folder).map(m => [text.slice(m.start, m.end), m.identity.name])).toEqual([
      ['@Dana Okafor', 'Dana Okafor'], ['@dan', 'Dan'], ['@Acme, Inc.', 'Acme, Inc.'], ['@Tomas Lindqvist', 'Tomas Lindqvist'],
    ]);
  });

  it('ignores an @ inside a word, a partial name, details, archived identities and a name across lines', () => {
    expect(findMentions('mail dana@Dana Okafor', folder)).toEqual([]);
    expect(findMentions('@Danaa and @Okafor', folder)).toEqual([]);
    expect(findMentions('@tomas@halvorsen.example', folder)).toEqual([]);
    expect(findMentions('@Old Contractor', folder)).toEqual([]);
    expect(findMentions('@Dana\nOkafor', folder).map(m => m.identity.name)).toEqual([]);
    expect(findMentions('@Okafor, Dana', folder).map(m => m.identity.name)).toEqual(['Dana Okafor']);
  });

  it('stays fast on long text full of @ signs', () => {
    const text = '@'.repeat(50_000) + ' @Dana Okafor ' + 'word @a '.repeat(20_000);
    const started = performance.now();
    expect(findMentions(text, folder).map(m => m.identity.name)).toEqual(['Dana Okafor']);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('activityOf', () => {
  it('lists events, notes and IOCs in the identity\'s investigation that name it, newest first', () => {
    const events = [
      event({ id: 'e1', actor: 'tomas lindqvist', timestamp: 1 }),
      event({ id: 'e2', assets: ['FIN-WS-014', 'T. Lindqvist'], timestamp: 3 }),
      event({ id: 'e3', actor: 'Tomás Lindqvist' }),
      event({ id: 'e4', actor: 'Tomas Lindqvist', folderId: 'other' }),
      event({ id: 'e5', actor: 'Tomas Lindqvist', trashed: true }),
    ];
    const notes = [
      note('Call with @Tomas Lindqvist about the payment.', { id: 'n1', updatedAt: 2 }),
      note('Mail from tomas@halvorsen.example', { id: 'n2', updatedAt: 5 }),
      note('Tomas Lindqvistsson is someone else', { id: 'n3' }),
      note('+44 7700 900123 rang', { id: 'n4' }),
      note('Tomas Lindqvist', { id: 'n5', isFolder: true }),
    ];
    const iocs = [ioc({ id: 'i1', type: 'email', value: 'tomas@halvorsen.example' }), ioc({ id: 'i2', attribution: 'T. Lindqvist' }), ioc({ id: 'i3', value: 'other.example' })];
    const activity = activityOf(tomas, { events, notes, iocs });
    expect(activity.events.map(item => item.id)).toEqual(['e2', 'e1']);
    expect(activity.notes.map(item => item.id)).toEqual(['n2', 'n1']);
    expect(activity.iocs.map(item => item.id).sort()).toEqual(['i1', 'i2']);
  });
});

describe('scale', () => {
  it('indexes 2,000 identities and links 5,000 events quickly', () => {
    const identities = Array.from({ length: 2000 }, (_, i) => make(`Person ${i}`, { folderId: `case-${i % 20}`, aliases: [`P${i}`],
      details: [{ id: `d${i}`, label: 'Email', value: `person${i}@example.test` }] }));
    const events = Array.from({ length: 5000 }, (_, i) => event({ folderId: `case-${i % 20}`, actor: `Person ${i % 2500}`, assets: [`host-${i}`, `P${i % 2000}`] }));
    const started = performance.now();
    const index = buildIdentityIndex(identities);
    let linked = 0;
    for (const item of events) {
      if (linkFor(index, item.folderId, item.actor).state === 'linked') linked++;
      for (const asset of item.assets) if (linkFor(index, item.folderId, asset).state === 'linked') linked++;
    }
    expect(performance.now() - started).toBeLessThan(500);
    expect(linked).toBeGreaterThan(0);
  });
});
