import { describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';
import type { Identity, Note, TimelineEvent } from '../types';
import { buildGraphData, type IdentityGraphInput } from '../lib/graph-data';
import { belongsTo, buildIdentityIndex, linkFor } from '../lib/identity-match';
import { focusRings } from '../lib/graph-focus';

const make = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const org = make('org', 'Halvorsen Shipping', { type: 'organization' });
const lee = make('lee', 'Lee Park', { connections: [{ targetId: 'org', label: 'works at' }] });
const dana = make('dana', 'Dana Okafor', { details: [{ id: 'e', label: 'Email', value: 'dana@halvorsen.example' }],
  connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'lee', label: 'reports to' }, { targetId: 'gone', label: 'paid' }] });
const laptop = make('laptop', 'WS-0231', { type: 'system' });
const twinA = make('twin-a', 'Sam Lee');
const twinB = make('twin-b', 'Sam Lee');
const archived = make('old', 'Old Contractor', { archived: true });
const identities = [org, lee, dana, laptop, twinA, twinB, archived];

const event = (id: string, extra: Partial<TimelineEvent>): TimelineEvent => ({ id, title: id, timestamp: 1, eventType: 'other', source: '', confidence: 'medium',
  linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'case', timelineId: 't',
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra } as TimelineEvent);
const note: Note = { id: 'n', title: 'Mail', content: '', folderId: 'case', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1,
  iocAnalysis: { extractedAt: 1, iocs: [{ id: 'i', type: 'email', value: 'dana@halvorsen.example', confidence: 'medium', firstSeen: 1, dismissed: false }] } };

function graph() {
  const index = buildIdentityIndex(identities);
  const input: IdentityGraphInput = {
    identities, linkFor: (folderId, text) => linkFor(index, folderId, text), belongsTo: (folderId, value) => belongsTo(index, { folderId, value }),
    phrase: label => (label === 'reports to' ? 'berichtet an' : label), typeLabel: type => type.toUpperCase(),
    roles: { actor: 'actor', asset: 'asset', belongsTo: 'belongs to' },
  };
  return buildGraphData([note], [], [event('wire', { actor: 'Dana Okafor', assets: ['ws-0231', 'Sam Lee', 'Nobody'] })], undefined, input);
}

describe('identities on the graph', () => {
  it('draws live identities as nodes with their type', () => {
    const { nodes } = graph();
    const shown = nodes.filter(node => node.type === 'identity');
    expect(shown.map(node => node.label).sort()).toEqual(['Dana Okafor', 'Halvorsen Shipping', 'Lee Park', 'Sam Lee', 'Sam Lee', 'WS-0231']);
    expect(shown.find(node => node.id === 'identity:org')).toMatchObject({ identityType: 'organization', subtitle: 'ORGANIZATION' });
    expect(shown.every(node => node.icon.startsWith('data:image/svg+xml'))).toBe(true);
  });

  it('draws connections (translated), events that name an identity, and IOCs that belong to one; never ambiguous ones', () => {
    const edges = graph().edges.filter(edge => edge.type.startsWith('identity'));
    expect(edges.map(edge => `${edge.source} -${edge.label}-> ${edge.target}`).sort()).toEqual([
      'event:wire -actor-> identity:dana',
      'event:wire -asset-> identity:laptop',
      'identity:dana -berichtet an-> identity:lee',
      'identity:dana -works at-> identity:org',
      'identity:lee -works at-> identity:org',
      'ioc:email:dana@halvorsen.example -belongs to-> identity:dana',
    ]);
  });
});

describe('the focus layout', () => {
  it('rings the chosen node, its neighbours and theirs, without expanding an organisation', () => {
    const cy = cytoscape({ headless: true, elements: [
      ...['dana', 'lee', 'org', 'ana', 'ben', 'wire', 'mail'].map(id => ({ data: { id, type: id === 'org' ? 'identity' : 'x', identityType: id === 'org' ? 'organization' : '' } })),
      { data: { id: 'e1', source: 'dana', target: 'org' } }, { data: { id: 'e2', source: 'dana', target: 'lee' } },
      { data: { id: 'e3', source: 'ana', target: 'org' } }, { data: { id: 'e4', source: 'ben', target: 'org' } },
      { data: { id: 'e5', source: 'wire', target: 'lee' } },
    ] });
    const rings = focusRings(cy.getElementById('dana'));
    expect(Object.fromEntries(rings)).toEqual({ dana: 3, org: 2, lee: 2, wire: 1 });
    cy.destroy();
  });
});
