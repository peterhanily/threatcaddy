/**
 * F6: editing correctness, product and CTI practice.
 * - FE-1 a change of letter case saves; FE-3 one duplicate check (other names too); FE-4 a select
 *   request is applied once; FE-6 one save at a time; FE-7 one rule for adding a connection.
 * - PROD-2 status filters, "contained", the Dashboard tile; PROD-3 classification shown, changed and
 *   exported; PROD-4 threat actors; PROD-6 tags round-trip; PROD-7 the sample demonstrates linking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IdentitiesView, type IdentitiesViewProps } from '../components/Identities/IdentitiesView';
import { KPIWidgets } from '../components/Dashboard/KPIWidgets';
import { ToastProvider } from '../contexts/ToastContext';
import type { Folder, Identity, Note, StandaloneIOC, TimelineEvent } from '../types';
import type { IdentityChange } from '../components/Identities/identity-labels';
import { foundNames, nameTakenBy, orgChart, withConnection } from '../lib/identity-model';
import { activityOf } from '../lib/identity-match';
import { identitiesToCsv } from '../lib/identity-export';
import { buildIdentities } from '../lib/identity-import';
import { detectSchema, parseInput, type ColumnMapping } from '../lib/data-import';
import { buildInvestigationVisibility } from '../lib/investigation-visibility';
import { PARODY_THREAT_ACTOR } from '../lib/sample-investigation-store';
import { generateSampleInvestigation } from '../lib/sample-investigation';

const folders: Folder[] = [{ id: 'case', name: 'Halvorsen BEC', order: 0, createdAt: 1, clsLevel: 'TLP:AMBER' }, { id: 'other', name: 'Other case', order: 1, createdAt: 1 }];
const make = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const org = make('org', 'Halvorsen Shipping', { type: 'organization' });
/** Applies each update to a stored copy, as useIdentities does. */
function view(overrides: Partial<IdentitiesViewProps>, rows: Identity[]) {
  const stored = new Map(rows.map(row => [row.id, row]));
  const onUpdate = vi.fn(async (id: string, change: IdentityChange) => {
    const current = stored.get(id) as Identity;
    stored.set(id, { ...current, ...(typeof change === 'function' ? change(current) : change) });
  });
  const props: IdentitiesViewProps = {
    identities: rows, allIdentities: rows, folders, folderId: 'case', events: [], iocs: [],
    onCreate: vi.fn(async partial => make('new', partial.name ?? '', partial)), onUpdate, onTrash: vi.fn(async () => {}), onMerge: vi.fn(async () => {}),
    ...overrides,
  };
  const rendered = render(<ToastProvider><IdentitiesView {...props} /></ToastProvider>);
  return { ...rendered, stored, onUpdate, props, user: userEvent.setup() };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the Edit form', () => {
  it('saves a change of letter case or spacing in the name and other names (FE-1)', async () => {
    const dana = make('dana', 'DANA OKAFOR', { aliases: ['d. okafor'] });
    const { user, stored } = view({ selectRequest: { id: 'dana', request: 1 } }, [dana]);
    await user.click(within(screen.getByRole('article', { name: 'DANA OKAFOR' })).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Dana Okafor');
    const otherNames = within(dialog).getByRole('textbox', { name: 'Other names (one per line)' });
    await user.clear(otherNames);
    await user.type(otherNames, 'D. Okafor');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(stored.get('dana')).toMatchObject({ name: 'Dana Okafor', aliases: ['D. Okafor'] });
  });

  it('refuses another identity\'s name as an other name, as the AI tools and import do (FE-3)', async () => {
    const dana = make('dana', 'Dana Okafor'), lee = make('lee', 'Lee Park');
    const { user, stored } = view({ selectRequest: { id: 'dana', request: 1 } }, [dana, lee]);
    await user.click(within(screen.getByRole('article', { name: 'Dana Okafor' })).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Other names (one per line)' }), 'lee park');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('“lee park” is already a name or other name of Lee Park in this investigation.');
    expect(stored.get('dana')?.aliases).toEqual([]);
    expect(nameTakenBy([dana, lee], 'case', 'LEE  PARK', 'dana')?.id).toBe('lee');
    expect(nameTakenBy([dana, { ...lee, folderId: 'other' }], 'case', 'Lee Park', 'dana')).toBeUndefined();
  });

  it('counts an archived identity\'s name as taken, as the AI tools do (FE-3)', async () => {
    const dana = make('dana', 'Dana Okafor'), lee = make('lee', 'Lee Park', { archived: true });
    const { user, stored } = view({ selectRequest: { id: 'dana', request: 1 }, identities: [dana] }, [dana, lee]);
    await user.click(within(screen.getByRole('article', { name: 'Dana Okafor' })).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Other names (one per line)' }), 'Lee Park');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Lee Park');
    expect(stored.get('dana')?.aliases).toEqual([]);
  });

  it('shows and changes the classification (PROD-3)', async () => {
    const vip = make('vip', 'Chief Executive', { clsLevel: 'TLP:RED' });
    const { user, stored } = view({ selectRequest: { id: 'vip', request: 1 } }, [vip]);
    const profile = screen.getByRole('article', { name: 'Chief Executive' });
    expect(within(profile).getByText('TLP:RED')).toBeInTheDocument();
    await user.click(within(profile).getByRole('button', { name: 'Edit' }));
    await user.selectOptions(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Classification level' }), 'TLP:AMBER');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    expect(stored.get('vip')?.clsLevel).toBe('TLP:AMBER');
  });
});

describe('the list and the profile', () => {
  it('applies a select request once and says so, so a later visit starts afresh (FE-4)', () => {
    const onSelectHandled = vi.fn();
    const dana = make('dana', 'Dana Okafor');
    view({ selectRequest: { id: 'dana', request: 1, query: 'Dana' }, onSelectHandled }, [dana]);
    expect(screen.getByRole('searchbox', { name: 'Search identities' })).toHaveValue('Dana');
    expect(onSelectHandled).toHaveBeenCalledTimes(1);
  });

  it('stores a detail once however fast Add is clicked (FE-6)', async () => {
    const dana = make('dana', 'Dana Okafor');
    let release!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const { user } = view({ selectRequest: { id: 'dana', request: 1 }, onUpdate }, [dana]);
    const profile = screen.getByRole('article', { name: 'Dana Okafor' });
    await user.click(within(profile).getByRole('button', { name: 'Add a detail' }));
    await user.type(within(profile).getByRole('combobox', { name: 'Label' }), 'Email');
    await user.type(within(profile).getByRole('textbox', { name: 'Value' }), 'dana@example.invalid');
    const add = within(profile).getByRole('button', { name: 'Add' });
    await user.click(add);
    await user.click(add);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    release();
  });

  it('adds "works at" only toward an organisation, by one rule for the profile, the graph and the AI (FE-7)', async () => {
    const dana = make('dana', 'Dana Okafor'), lee = make('lee', 'Lee Park');
    expect(withConnection(dana, lee, 'works at')).toBeNull();
    expect(withConnection(dana, org, 'works at')).toEqual([{ targetId: 'org', label: 'works at' }]);
    expect(withConnection({ ...dana, connections: [{ targetId: 'lee', label: 'reports to' }] }, lee, 'reports to')).toEqual([{ targetId: 'lee', label: 'reports to' }]);
    expect(withConnection(dana, dana, 'reports to')).toBeNull();
    const { user } = view({ selectRequest: { id: 'dana', request: 1 } }, [dana, lee, org]);
    const profile = screen.getByRole('article', { name: 'Dana Okafor' });
    await user.click(within(profile).getByRole('button', { name: 'Add a connection' }));
    await user.type(within(profile).getByRole('combobox', { name: 'Dana Okafor…' }), 'works at');
    const targets = within(profile).getByRole('combobox', { name: '…whom or what' });
    expect(within(targets).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose…', 'Halvorsen Shipping · Organization']);
  });

  it('clears a chosen person when the phrase then asks for an organisation (FE-7)', async () => {
    const dana = make('dana', 'Dana Okafor'), lee = make('lee', 'Lee Park');
    const { user, onUpdate } = view({ selectRequest: { id: 'dana', request: 1 } }, [dana, lee, org]);
    const profile = screen.getByRole('article', { name: 'Dana Okafor' });
    await user.click(within(profile).getByRole('button', { name: 'Add a connection' }));
    await user.selectOptions(within(profile).getByRole('combobox', { name: '…whom or what' }), 'lee');
    await user.type(within(profile).getByRole('combobox', { name: 'Dana Okafor…' }), 'works at');
    expect(within(profile).getByRole('combobox', { name: '…whom or what' })).toHaveValue('');
    await user.click(within(profile).getByRole('button', { name: 'Add' }));
    expect(within(profile).getByRole('alert')).toHaveTextContent('Choose whom or what it connects to.');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('opens the team of a contained person, as of a compromised one (PROD-2)', () => {
    const boss = make('boss', 'Boss', { connections: [{ targetId: 'org', label: 'works at' }] });
    const worker = make('worker', 'Worker', { status: 'contained', connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'boss', label: 'reports to' }] });
    expect(orgChart(org, [org, boss, worker]).flagged(boss)).toBe(true);
  });

  it('filters by status, including contained, and shows no profile when nothing matches (PROD-2)', async () => {
    const rows = [make('a', 'Ana Silva', { status: 'compromised' }), make('b', 'Ben Cole', { status: 'contained' }), make('c', 'Cleo Diaz')];
    const { user } = view({}, rows);
    const statuses = screen.getByRole('group', { name: 'Status' });
    expect(within(statuses).getAllByRole('button').map(button => button.textContent)).toEqual(['Compromised 1', 'Contained 1']);
    await user.click(within(statuses).getByRole('button', { name: /Contained/ }));
    const list = screen.getByRole('region', { name: 'Identities' });
    expect(within(list).getAllByRole('button', { name: /Ben Cole/ })).toHaveLength(1);
    expect(within(list).queryByRole('button', { name: /Ana Silva/ })).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search identities' }), 'Ana');
    expect(screen.getByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('opens filtered to the compromised identities from the Dashboard tile (PROD-2)', async () => {
    const onOpenMetric = vi.fn();
    render(<KPIWidgets folders={[]} allNotes={[]} allTasks={[]} allEvents={[]} allIOCs={[]} allIdentities={[make('a', 'Ana', { status: 'compromised' })]}
      selectedKPIs={['compromised-identities']} onUpdateKPIs={vi.fn()} onOpenMetric={onOpenMetric} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Compromised identities/i }));
    expect(onOpenMetric).toHaveBeenCalledWith('compromised-identities');
    view({ selectRequest: { request: 1, status: 'compromised' } }, [make('a', 'Ana Silva', { status: 'compromised' }), make('c', 'Cleo Diaz')]);
    expect(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: /Compromised/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('threat actors (PROD-4)', () => {
  const ioc = (attribution: string): StandaloneIOC => ({ id: `i-${attribution}`, folderId: 'case', type: 'domain', value: `${attribution}.example`, attribution,
    confidence: 'high', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 }) as unknown as StandaloneIOC;
  it('guesses a name found as an attribution or an Actor as an organization, not a person', () => {
    const found = foundNames({ identities: [], events: [], iocs: [ioc('APT29'), ioc('FIN7')] });
    expect(found.map(name => [name.text, name.guess.type])).toEqual([['APT29', 'organization'], ['FIN7', 'organization']]);
  });

  it('tracks a found name as a threat actor from its dialog', async () => {
    const onTrackThreatActor = vi.fn();
    const { user } = view({ iocs: [ioc('APT29')], onTrackThreatActor }, [make('dana', 'Dana Okafor')]);
    await user.click(within(screen.getByRole('region', { name: /^Not yet in Identities/ })).getByRole('button', { name: /APT29/ }));
    await user.click(screen.getByRole('button', { name: 'Track as a threat actor' }));
    expect(onTrackThreatActor).toHaveBeenCalledWith('APT29');
    expect(foundNames({ identities: [], events: [], iocs: [ioc('APT29')], threatActors: ['APT29'] })).toEqual([]);
  });

  it('names the parody sample\'s adversary, which loading the sample tracks', () => {
    const sample = generateSampleInvestigation();
    expect(sample.timelineEvents.some(event => event.actor === PARODY_THREAT_ACTOR)).toBe(true);
  });
});

describe('classification in export and screensharing (PROD-3)', () => {
  it('writes the investigation\'s level, then the default, for an identity without its own', () => {
    const rows = [make('a', 'Ana'), make('b', 'Ben', { folderId: 'other' }), make('c', 'Cleo', { clsLevel: 'TLP:RED' })];
    const csv = identitiesToCsv(rows, { byId: new Map(rows.map(row => [row.id, row])), folders, defaultClsLevel: 'TLP:GREEN' });
    expect(csv).toMatch(/Ana,.*TLP:AMBER/);
    expect(csv).toMatch(/Ben,.*TLP:GREEN/);
    expect(csv).toMatch(/Cleo,.*TLP:RED/);
  });

  it('says when identities are why an investigation is hidden while screensharing, and only then', () => {
    const build = (extra: object) => buildInvestigationVisibility({ folders, remoteInvestigations: [], notes: [], tasks: [], timelineEvents: [], whiteboards: [], standaloneIOCs: [],
      chatThreads: [], evidenceItems: [], identities: [make('vip', 'Chief Executive', { clsLevel: 'TLP:RED' })], maxLevel: 'TLP:AMBER',
      effectiveLevels: ['TLP:CLEAR', 'TLP:GREEN', 'TLP:AMBER', 'TLP:RED'], dataReady: true, ...extra } as never);
    const visibility = build({});
    expect(visibility.hiddenFolderIds.has('case')).toBe(true);
    expect(visibility.hiddenByIdentities?.has('case')).toBe(true);
    // A RED note hides it too: changing the identity's level would not show it, so identities are not named.
    const alsoNote = build({ notes: [{ id: 'n', folderId: 'case', title: 'x', content: '', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1, clsLevel: 'TLP:RED' }] });
    expect(alsoNote.hiddenFolderIds.has('case')).toBe(true);
    expect(alsoNote.hiddenByIdentities?.has('case') ?? false).toBe(false);
    // So does the investigation's own level.
    const ownLevel = build({ folders: [{ ...folders[0], clsLevel: 'TLP:RED' }, folders[1]] });
    expect(ownLevel.hiddenFolderIds.has('case')).toBe(true);
    expect(ownLevel.hiddenByIdentities?.has('case') ?? false).toBe(false);
  });
});

describe('the CSV round trip and the sample (PROD-6, PROD-7)', () => {
  it('keeps tags (added to those an identity has) and a public phone public', () => {
    const lee = make('lee', 'Lee Park', { tags: ['vip', 'finance'], details: [{ id: 'w', label: 'Phone', value: '+44 20 7946 0002' }] });
    const csv = identitiesToCsv([lee], { byId: new Map([[lee.id, lee]]), folders });
    const parsed = parseInput(csv.replace(/^\uFEFF/, ''));
    const mappings = new Map<string, ColumnMapping>(detectSchema(parsed.headers).map(detected => [detected.column, detected.mapping]));
    const back = buildIdentities(parsed.rows, mappings, { folderId: 'case', existing: [], now: 5 }).created[0];
    expect(back.tags).toEqual(['data-import', 'vip', 'finance']);
    expect(back.details[0]).toMatchObject({ label: 'Phone' });
    expect(back.details[0].private).toBeUndefined();
    const again = buildIdentities(parsed.rows, mappings, { folderId: 'case', existing: [{ ...lee, tags: ['vip'] }], now: 5 });
    expect(again.updated).toEqual([expect.objectContaining({ id: 'lee', changes: expect.objectContaining({ tags: ['vip', 'finance'] }) })]);
  });

  it('reads back the level an identity inherits as inherited, so an unchanged file changes nothing', () => {
    const rows = [make('ana', 'Ana Silva'), make('cleo', 'Cleo Diaz', { clsLevel: 'TLP:RED' })];
    const csv = identitiesToCsv(rows, { byId: new Map(rows.map(row => [row.id, row])), folders });
    const parsed = parseInput(csv.replace(/^\uFEFF/, ''));
    const mappings = new Map<string, ColumnMapping>(detectSchema(parsed.headers).map(detected => [detected.column, detected.mapping]));
    const again = buildIdentities(parsed.rows, mappings, { folderId: 'case', existing: rows, clsLevel: 'TLP:AMBER', inheritedClsLevel: 'TLP:AMBER', now: 5 });
    expect(again.updated).toEqual([]);
    // Created elsewhere (an investigation without a level), a copy keeps the level it was exported at: never lower.
    const fresh = buildIdentities(parsed.rows, mappings, { folderId: 'other', existing: [], now: 5 }).created;
    expect(fresh.map(identity => [identity.name, identity.clsLevel])).toEqual([['Ana Silva', 'TLP:AMBER'], ['Cleo Diaz', 'TLP:RED']]);
  });

  it('demonstrates linking: a note mentions people and an event names one as its Actor', () => {
    const sample = generateSampleInvestigation();
    const rai = sample.identities.find(identity => identity.name === 'Rai Sinn') as Identity;
    const activity = activityOf(rai, { events: sample.timelineEvents as TimelineEvent[], notes: sample.notes, iocs: sample.standaloneIOCs });
    expect(activity.events.some(event => event.actor === 'Rai Sinn')).toBe(true);
    expect(activity.notes.some(note => note.content.includes('@Rai Sinn'))).toBe(true);
    const defined = new Set(sample.tags.map(tag => tag.name));
    const interview = activity.notes.find(note => note.content.includes('@Rai Sinn')) as Note;
    expect(interview.tags.filter(tag => !defined.has(tag))).toEqual([]);
  });
});
