/**
 * F5: crafted data cannot stall or crash the Identities views, and work stays proportional at scale.
 * Deterministic checks (what is found once a budget is spent, operation counts), never wall-clock limits.
 * - SEC-1: the profile's Activity scan has a cap on names and a work budget, and says when it is partial.
 * - SEC-2: export headers cap labels and stay matched to their values.
 * - SEC-4: org charts of reporting chains thousands deep build without recursion and show a depth note.
 * - SEC-5: one @-mention budget per note, shared by its paragraphs.
 * - PERF-3/4/7: the link index does not sort when nothing changed; found names count each source once;
 *   custom identity types share one graph icon.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Identity, Note, TimelineEvent } from '../types';
import { activityOf, buildIdentityIndex, findMentions } from '../lib/identity-match';
import { foundNames, orgChart } from '../lib/identity-model';
import { identitiesToCsv } from '../lib/identity-export';
import { linkIdentityMentions } from '../lib/markdown';
import { buildInvestigationVisibility } from '../lib/investigation-visibility';
import { _clearIconCache, getNodeIcon } from '../lib/graph-icons';
import { OrgCharts } from '../components/Identities/OrgCharts';
import { useIdentityLabels } from '../components/Identities/identity-labels';

const make = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const note = (id: string, content: string, updatedAt = 1): Note => ({ id, folderId: 'case', title: id, content, tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt });
const event = (id: string, actor: string): TimelineEvent => ({ id, folderId: 'case', timelineId: 't', title: id, timestamp: 1, actor, eventType: 'other',
  source: '', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false, trashed: false, archived: false, createdAt: 1, updatedAt: 1 } as TimelineEvent);

describe('SEC-1: the Activity scan', () => {
  it('searches at most 50 names and details, and says when it did not search them all', () => {
    const aliases = Array.from({ length: 60 }, (_, i) => `Codename ${i}`);
    const notes = aliases.map((alias, i) => note(`n${i}`, `Seen as ${alias} today.`, i));
    const activity = activityOf(make('x', 'Dana Okafor', { aliases }), { events: [], notes, iocs: [] });
    // The name, then the first 49 other names: the notes naming the last 11 are not searched.
    expect(activity.notes).toHaveLength(49);
    expect(activity.partial).toBe(true);
    const plain = activityOf(make('y', 'Lee Park', { aliases: ['Codename 3'] }), { events: [], notes, iocs: [] });
    expect([plain.notes.map(found => found.id), plain.partial]).toEqual([['n3'], undefined]);
  });

  it('stops once its budget is spent on crafted text, instead of stalling the render', () => {
    const crafted = make('crafted', '!', { aliases: Array.from({ length: 49 }, (_, i) => 'a'.repeat(i + 3)) });
    // Every position of every note matches every other name (but never as a whole word).
    const notes = [...Array.from({ length: 4 }, (_, i) => note(`a${i}`, 'a'.repeat(450_000), 10 + i)), note('named', 'aaa is here.', 0)];
    const activity = activityOf(crafted, { events: [], notes, iocs: [] });
    expect(activity.partial).toBe(true);
    // The budget is spent on the crafted notes, before the note that does name it.
    expect(activity.notes).toEqual([]);
  });
});

describe('SEC-2: export headers', () => {
  it('caps a long detail label in the header, and still puts each value under its column', () => {
    const long = `Badge ${'x'.repeat(100_000)}`;
    const csv = identitiesToCsv([make('a', 'Ana', { details: [{ id: 'd1', label: long, value: 'B-17' }, { id: 'd2', label: 'Email', value: 'ana@example.invalid' }] })],
      { folders: [], byId: new Map() } as never);
    const [header, row] = csv.split('\n');
    expect(header.length).toBeLessThan(2_000);
    const cells = header.split(',');
    const values = row.split(',');
    expect(values[cells.findIndex(cell => cell.startsWith('Badge'))]).toBe('B-17');
    expect(values[cells.indexOf('Email')]).toBe('ana@example.invalid');
  });
});

describe('SEC-4: deep reporting chains', () => {
  const chain = (length: number, flaggedAt?: number) => {
    const org = make('org', 'Halvorsen Shipping', { type: 'organization' });
    const people = Array.from({ length }, (_, i) => make(`p${i}`, `Person ${String(i).padStart(5, '0')}`, {
      ...(i === flaggedAt ? { status: 'compromised' as const } : {}),
      connections: [{ targetId: 'org', label: 'works at' }, ...(i > 0 ? [{ targetId: `p${i - 1}`, label: 'reports to' }] : [])] }));
    return [org, ...people];
  };

  it('builds a 20,000-person chain without recursion: team sizes and flags from the bottom up', () => {
    const identities = chain(20_000, 19_999);
    const chart = orgChart(identities[0], identities);
    expect(chart.roots.map(root => root.id)).toEqual(['p0']);
    expect(chart.teamSize(identities[1])).toBe(19_999);
    expect(chart.flagged(identities[1])).toBe(true);
    expect(chart.flagged(identities[19_999])).toBe(true);
  });

  it('breaks a reporting loop at the first person met, as before', () => {
    const people = chain(4);
    // p0 reports to p3: a loop p0 → p3 → p2 → p1 → p0.
    people[1] = { ...people[1], connections: [...people[1].connections, { targetId: 'p3', label: 'reports to' }] };
    const chart = orgChart(people[0], people);
    expect(chart.roots.map(root => root.id)).toEqual(['p0']);
    expect(chart.teamSize(people[1])).toBe(3);
  });

  it('renders a 5,000-person chain to a depth limit, with a note for the levels below', () => {
    const identities = chain(5_000, 4_999);
    function Chart() {
      const labels = useIdentityLabels();
      return <OrgCharts identities={identities} folders={[{ id: 'case', name: 'Case', order: 0, createdAt: 1 }]} showInvestigation={false}
        labels={labels} onSelectOrganization={vi.fn()} onOpen={vi.fn()} />;
    }
    render(<Chart />);
    expect(screen.getByRole('combobox', { name: 'Organization' })).toHaveValue('org');
    // Flagged at the bottom, so every level opens by default: only the first levels are drawn.
    const deeper = screen.getByText(/Further levels are not shown here/);
    expect(deeper.textContent).toMatch(/\(\d+\)/);
    expect(screen.getAllByRole('button', { name: /^Person / }).length).toBeLessThanOrEqual(32);
  });
});

describe('SEC-5: one mention budget per note', () => {
  it('spends one budget across a note\'s paragraphs: a mention after it is spent is not linked', () => {
    const index = buildIdentityIndex([make('dana', 'Dana Okafor'), ...Array.from({ length: 30 }, (_, i) => make(`a${i}`, `a${'b'.repeat(i + 60)}`))]);
    const folder = index.folders.get('case');
    expect(folder).toBeDefined();
    // Each paragraph alone stays under the budget; together they spend it.
    const crafted = Array.from({ length: 40 }, () => `<p>${'@a '.repeat(3000)}</p>`).join('');
    const html = linkIdentityMentions(`${crafted}<p>Ask @Dana Okafor.</p>`, folder as never);
    expect(html).not.toContain('data-identity-id="dana"');
    expect(linkIdentityMentions('<p>Ask @Dana Okafor.</p>', folder as never)).toContain('data-identity-id="dana"');
    const budget = { work: 0 };
    for (let i = 0; i < 40; i++) findMentions('@a '.repeat(3000), folder, budget);
    expect(budget.work).toBeLessThan(8_100_000);
  });
});

describe('PERF: work proportional to what changed', () => {
  it('does not read names again (no sort) when an unrelated save rebuilds the link index', () => {
    let reads = 0;
    const counted = Array.from({ length: 2_000 }, (_, i) => {
      const identity = make(`i${i}`, `Person ${i}`);
      let name = identity.name;
      return Object.defineProperty(identity, 'name', { get() { reads++; return name; }, set(value: string) { name = value; }, enumerable: true });
    });
    const first = buildIdentityIndex(counted);
    reads = 0;
    const second = buildIdentityIndex(counted, { previous: first });
    expect(reads).toBe(0);
    expect(second.folders.get('case')).toBe(first.folders.get('case'));
    // Not screensharing: one visibility function for every data change, so the index is not even rebuilt.
    const visibility = () => buildInvestigationVisibility({ folders: [], remoteInvestigations: [], notes: [], tasks: [], timelineEvents: [], whiteboards: [],
      standaloneIOCs: [], chatThreads: [], evidenceItems: [], identities: [], maxLevel: undefined, effectiveLevels: [], dataReady: true } as never).isEntityVisible;
    expect(visibility()).toBe(visibility());
  });

  it('counts each source of a found name once, by a set', () => {
    const events = [...Array.from({ length: 20_000 }, (_, i) => event(`e${i}`, 'fin-db01')), event('e0', 'fin-db01')];
    const found = foundNames({ identities: [], events, iocs: [] });
    expect(found).toHaveLength(1);
    expect(found[0].sources).toHaveLength(20_000);
  });

  it('keeps one icon for every custom identity type', () => {
    _clearIconCache();
    const encode = vi.spyOn(globalThis, 'encodeURIComponent');
    for (let i = 0; i < 50; i++) getNodeIcon('identity', '#888888', undefined, `custom type ${i}`);
    expect(encode).toHaveBeenCalledTimes(1);
    getNodeIcon('identity', '#888888', undefined, 'organization');
    expect(encode).toHaveBeenCalledTimes(2);
    encode.mockRestore();
  });
});
