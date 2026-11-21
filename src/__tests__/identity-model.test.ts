import { describe, expect, it } from 'vitest';
import type { Identity, StandaloneIOC, TimelineEvent } from '../types';
import {
  alsoElsewhere, canonicalPhrase, canonicalType, chartableOrganizations, connectionsOf, foundKey, foundNames, guessIdentity,
  identityMatches, initials, maskDetail, membersOf, orgChart, organizationOf, withOrganization,
} from '../lib/identity-model';

let n = 0;
const make = (name: string, extra: Partial<Identity> = {}): Identity => ({ id: extra.id ?? `id-${++n}`, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const mapOf = (rows: Identity[]) => new Map(rows.map(row => [row.id, row]));
const event = (extra: Partial<TimelineEvent>): TimelineEvent => ({ id: `ev-${++n}`, title: 'Event', timestamp: 1, eventType: 'other', source: '', confidence: 'medium',
  linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'case', timelineId: 't',
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra } as TimelineEvent);
const ioc = (extra: Partial<StandaloneIOC>): StandaloneIOC => ({ id: `ioc-${++n}`, type: 'domain', value: 'x.example', confidence: 'medium', folderId: 'case', tags: [],
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra } as StandaloneIOC);
const typeLabels = { person: 'Person', organization: 'Organization', system: 'System', account: 'Account' };
const phraseLabels = { 'works at': 'arbeitet bei', 'reports to': 'berichtet an', uses: 'nutzt', administers: 'verwaltet', 'belongs to': 'gehört zu',
  'logs on to': 'meldet sich an bei', 'communicated with': 'kommunizierte mit', impersonated: 'gab sich aus als', paid: 'bezahlte' };

describe('types and phrases', () => {
  it('stores built-in types as keys, reuses a type in use, and keeps any other word', () => {
    expect(canonicalType(' person ', typeLabels, [])).toBe('person');
    expect(canonicalType('Organization', typeLabels, [])).toBe('organization');
    expect(canonicalType('Person', { ...typeLabels, person: 'Personne' }, [])).toBe('person');
    expect(canonicalType('personne', { ...typeLabels, person: 'Personne' }, [])).toBe('person');
    expect(canonicalType('vendor', typeLabels, ['Vendor'])).toBe('Vendor');
    expect(canonicalType('Supplier', typeLabels, ['Vendor'])).toBe('Supplier');
    expect(canonicalType('Organisation', typeLabels, [])).toBe('organization');
  });

  it('stores built-in phrases in English whatever the interface language, and others as typed', () => {
    expect(canonicalPhrase('Arbeitet bei', phraseLabels)).toEqual({ label: 'works at', reversed: false });
    expect(canonicalPhrase('reports to', phraseLabels)).toEqual({ label: 'reports to', reversed: false });
    expect(canonicalPhrase(' approved payments to ', phraseLabels)).toEqual({ label: 'approved payments to', reversed: false });
    // The other side's wording, as the profile shows it, is the same relation stored the other way round.
    expect(canonicalPhrase('Manages', phraseLabels)).toEqual({ label: 'reports to', reversed: true });
    expect(canonicalPhrase('leitet', phraseLabels, { ...phraseLabels, 'reports to': 'leitet' })).toEqual({ label: 'reports to', reversed: true });
    expect(canonicalPhrase('employs', phraseLabels)).toEqual({ label: 'works at', reversed: true });
    expect(canonicalPhrase('communicated with', phraseLabels)).toEqual({ label: 'communicated with', reversed: false });
  });

  it('makes initials from letters and digits, whatever the script', () => {
    expect(initials('Dana Okafor')).toBe('DO');
    expect(initials('fin-db01')).toBe('FD');
    expect(initials('Ölund')).toBe('ÖL');
    expect(initials('李小龙')).toBe('李小');
    expect(initials('!!!')).toBe('?');
  });

  it('masks private details, keeping only enough to recognise them', () => {
    expect(maskDetail({ label: 'Phone', value: '+44 7700 900123' })).toBe('•••• 0123');
    expect(maskDetail({ label: 'Personal email', value: 'dana@example.test' })).toBe('d•••••@example.test');
    expect(maskDetail({ label: 'Address', value: '1 High Street' })).toBe('•••••••');
    // Only a real email keeps its domain: an "@" elsewhere reveals nothing.
    expect(maskDetail({ label: 'Home address', value: 'Flat 3 @ 12 Acacia Avenue, Leeds' })).toBe('•••••••');
    expect(maskDetail({ label: 'Handle', value: 'x.com/@dana_private' })).toBe('•••••••');
    expect(maskDetail({ label: 'Phone', value: '12' })).toBe('•••••••');
    // While screensharing nothing of the value shows.
    expect(maskDetail({ label: 'Phone', value: '+44 7700 900123' }, true)).toBe('•••••••');
    expect(maskDetail({ label: 'Personal email', value: 'dana@example.test' }, true)).toBe('•••••••');
  });
});

describe('organisations, connections and charts', () => {
  it('finds the organisation and replaces it without touching other connections', () => {
    const org = make('Halvorsen', { type: 'organization' });
    const other = make('Other Ltd', { type: 'organization' });
    const lee = make('Lee Park');
    const dana = make('Dana Okafor', { connections: [{ targetId: org.id, label: 'works at' }, { targetId: lee.id, label: 'reports to' }] });
    const byId = mapOf([org, other, lee, dana]);
        expect(organizationOf(dana, byId)?.id).toBe(org.id);
    expect(withOrganization(dana, org.id, other.id)).toEqual([{ targetId: lee.id, label: 'reports to' }, { targetId: other.id, label: 'works at' }]);
    expect(withOrganization(dana, org.id, undefined)).toEqual([{ targetId: lee.id, label: 'reports to' }]);
    // Nothing changes when the organisation stays the same, and other memberships are never touched.
    expect(withOrganization(dana, org.id, org.id)).toBe(dana.connections);
    const both = { ...dana, connections: [...dana.connections, { targetId: other.id, label: 'works at' }] };
    expect(withOrganization(both, undefined, undefined)).toBe(both.connections);
    expect(withOrganization(both, org.id, undefined)).toEqual([{ targetId: lee.id, label: 'reports to' }, { targetId: other.id, label: 'works at' }]);
    expect(withOrganization(both, undefined, other.id)).toEqual(both.connections);
    const laptop = make('WS-0231', { type: 'system' });
    expect(withOrganization(laptop, undefined, org.id)).toEqual([{ targetId: org.id, label: 'belongs to' }]);
    // A trashed organisation, or one in another investigation, is not where someone works.
    expect(organizationOf(dana, mapOf([{ ...org, trashed: true }]))).toBeUndefined();
    expect(organizationOf(dana, mapOf([{ ...org, folderId: 'elsewhere' }]))).toBeUndefined();
  });

  it('lists members with contacts first, and shows connections from both sides', () => {
    const org = make('Halvorsen', { type: 'organization' });
    const lee = make('Lee Park', { connections: [{ targetId: org.id, label: 'works at' }] });
    const ana = make('Ana Silva', { contact: true, connections: [{ targetId: org.id, label: 'works at' }, { targetId: lee.id, label: 'reports to' }] });
    const laptop = make('WS-0231', { type: 'system', connections: [{ targetId: org.id, label: 'belongs to' }, { targetId: ana.id, label: 'communicated with' }] });
    const gone = make('Gone', { trashed: true, connections: [{ targetId: lee.id, label: 'paid' }] });
    const all = [org, lee, ana, laptop, gone];
    expect(membersOf(org, all)).toEqual({ people: [ana, lee], things: [laptop] });
    const leeSees = connectionsOf(lee, mapOf(all), all);
    expect(leeSees.map(c => [c.other.name, c.label, c.outgoing])).toEqual([['Halvorsen', 'works at', true], ['Ana Silva', 'reports to', false]]);
    // An organisation lists its members under People, not as connections.
    expect(connectionsOf(org, mapOf(all), all)).toEqual([]);
    expect(connectionsOf(ana, mapOf(all), all).map(c => c.label)).toEqual(['works at', 'reports to', 'communicated with']);
  });

  it('draws a chart from "reports to", survives a reporting loop, and opens flagged teams', () => {
    const org = make('Halvorsen', { type: 'organization' });
    const works = { targetId: org.id, label: 'works at' };
    const ceo = make('Ceo', { id: 'ceo', connections: [works] });
    const cfo = make('Cfo', { id: 'cfo', connections: [works, { targetId: 'ceo', label: 'reports to' }] });
    const clerk = make('Clerk', { id: 'clerk', status: 'compromised', connections: [works, { targetId: 'cfo', label: 'reports to' }] });
    const loner = make('Loner', { id: 'loner', connections: [works] });
    const loopA = make('Loop A', { id: 'a', connections: [works, { targetId: 'b', label: 'reports to' }] });
    const loopB = make('Loop B', { id: 'b', connections: [works, { targetId: 'a', label: 'reports to' }] });
    const outsider = make('Outsider', { connections: [{ targetId: 'ceo', label: 'reports to' }] });
    const chart = orgChart(org, [org, ceo, cfo, clerk, loner, loopA, loopB, outsider]);
    // The loop is broken at the first person met (Loop A), who then heads Loop B.
    expect(chart.roots.map(p => p.name)).toEqual(['Ceo', 'Loop A']);
    expect(chart.reportsOf(ceo).map(p => p.name)).toEqual(['Cfo']);
    expect(chart.teamSize(ceo)).toBe(2);
    expect(chart.flagged(ceo)).toBe(true);
    expect(chart.flagged(loner)).toBe(false);
    expect(chart.unplaced.map(p => p.name)).toEqual(['Loner']);
    // Everyone in the loop still appears exactly once.
    const placed = (person: Identity): string[] => [person.name, ...chart.reportsOf(person).flatMap(placed)];
    const everyone = [...chart.roots.flatMap(placed), ...chart.unplaced.map(p => p.name)];
    expect(everyone.sort()).toEqual(['Ceo', 'Cfo', 'Clerk', 'Loner', 'Loop A', 'Loop B'].sort());
    expect(chartableOrganizations([org, ceo]).map(o => o.name)).toEqual(['Halvorsen']);
    expect(chartableOrganizations([org])).toEqual([]);
    // Someone listed under People by "belongs to" is on the chart too, so its link never opens another chart.
    const member = make('Member', { connections: [{ targetId: org.id, label: 'belongs to' }] });
    expect(chartableOrganizations([org, member]).map(o => o.name)).toEqual(['Halvorsen']);
    expect(orgChart(org, [org, member]).unplaced.map(p => p.name)).toEqual(['Member']);
  });
});

describe('search and other investigations', () => {
  it('searches names, other names, description, type and details that are not private', () => {
    const dana = make('Dana Okafor', { description: 'Finance director', aliases: ['D. Okafor'],
      details: [{ id: 'e', label: 'Email', value: 'dana@corp.example' }, { id: 'p', label: 'Phone', value: '+44 7700 900123', private: true }] });
    for (const query of ['okafor', 'FINANCE', 'd. oka', 'corp.example', 'person', 'Persona', '']) expect(identityMatches(dana, query, 'Persona'), query).toBe(true);
    expect(identityMatches(dana, '7700', 'Person')).toBe(false);
    expect(identityMatches(make('Tomás Ruiz'), 'tomas', 'Person')).toBe(true);
  });

  it('finds the same name or a shared public detail in other investigations only', () => {
    const dana = make('Dana Okafor', { details: [{ id: 'p', label: 'Phone', value: '+1', private: true }] });
    const sameName = make('dana okafor', { folderId: 'other' });
    const sharedEmail = make('D.O.', { folderId: 'other', details: [{ id: 'e', label: 'Email', value: 'Dana Okafor' }] });
    const privateOnly = make('Someone', { folderId: 'other', details: [{ id: 'p2', label: 'Phone', value: '+1', private: true }] });
    const sameCase = make('Dana Okafor');
    expect(alsoElsewhere(dana, [dana, sameName, sharedEmail, privateOnly, sameCase, { ...sameName, id: 'trashed', trashed: true }]).map(i => i.id).sort())
      .toEqual([sameName.id, sharedEmail.id].sort());
  });
});

describe('names found in an investigation', () => {
  it('collects Actor, Assets, IOC attribution and email IOCs that match no identity, most mentioned first', () => {
    const dana = make('Dana Okafor', { aliases: ['D. Okafor'], details: [{ id: 'h', label: 'Hostname', value: 'WS-0231' }] });
    const found = foundNames({
      identities: [dana],
      events: [
        event({ actor: 'Lee Park', assets: ['fin-db01', 'ws-0231'] }),
        event({ actor: 'lee park', assets: ['10.0.0.5'] }),
        event({ actor: 'APT29' }),
        event({ actor: 'd. okafor' }),
        event({ actor: 'Trashed Person', trashed: true }),
        event({ actor: 'Other Case', folderId: 'other' }),
      ],
      iocs: [ioc({ attribution: 'Lee Park' }), ioc({ type: 'email', value: 'billing@evil.example' }), ioc({ type: 'email', value: 'x@y.example', archived: true })],
      threatActors: ['apt29'],
    });
    expect(found.map(f => [f.folderId, f.text, f.sources.length])).toEqual([
      ['case', 'Lee Park', 3], ['case', '10.0.0.5', 1], ['case', 'billing@evil.example', 1], ['case', 'fin-db01', 1], ['other', 'Other Case', 1],
    ]);
    expect(found[0].sources.map(s => s.kind)).toEqual(['actor', 'actor', 'attribution']);
    expect(found.find(f => f.text === 'fin-db01')?.guess).toEqual({ type: 'system', detailLabel: 'hostname' });
    expect(found.find(f => f.text === 'Lee Park')?.guess).toEqual({ type: 'person' });
  });

  it('leaves out ignored names and suggests an identity whose name differs only by accents', () => {
    const tomas = make('Tomás Ruiz');
    const found = foundNames({ identities: [tomas], events: [event({ actor: 'Tomas Ruiz' }), event({ actor: 'Noise' })], iocs: [],
      isIgnored: (folderId, text) => foundKey(folderId, text) === foundKey('case', 'noise') });
    expect(found.map(f => f.text)).toEqual(['Tomas Ruiz']);
    expect(found[0].looksLike?.id).toBe(tomas.id);
  });

  it('guesses a type from the text', () => {
    expect(guessIdentity('dana@corp.example')).toEqual({ type: 'account', detailLabel: 'email' });
    expect(guessIdentity('GB82 WEST 1234 5698 7654 32')).toEqual({ type: 'account', detailLabel: 'iban' });
    expect(guessIdentity('svc_backup')).toEqual({ type: 'account' });
    expect(guessIdentity('HALV\\FIN01$')).toEqual({ type: 'account' });
    expect(guessIdentity('10.0.0.5')).toEqual({ type: 'system', detailLabel: 'ipAddress' });
    expect(guessIdentity('fe80::1')).toEqual({ type: 'system', detailLabel: 'ipAddress' });
    // A port or a time is not an IPv6 address.
    expect(guessIdentity('DC01:443')).toEqual({ type: 'person' });
    expect(guessIdentity('12:30')).toEqual({ type: 'person' });
    expect(guessIdentity('fin-db01.corp.local')).toEqual({ type: 'system', detailLabel: 'hostname' });
    expect(guessIdentity('WS-0231')).toEqual({ type: 'system', detailLabel: 'hostname' });
    expect(guessIdentity('recipe-server-01')).toEqual({ type: 'system', detailLabel: 'hostname' });
    // Group names and hyphenated names are not hostnames.
    for (const name of ['APT29', 'UNC2452', 'Jean-Luc', 'Mary-Kate Olsen']) expect(guessIdentity(name), name).toEqual({ type: 'person' });
    // A name listed as an asset is a thing; an email there is still an account.
    expect(guessIdentity('model-registry', true)).toEqual({ type: 'system' });
    expect(guessIdentity('ops@corp.example', true)).toEqual({ type: 'account', detailLabel: 'email' });
    expect(guessIdentity('Dana Okafor')).toEqual({ type: 'person' });
    expect(guessIdentity('Halvorsen')).toEqual({ type: 'person' });
  });
});
