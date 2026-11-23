import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { IdentitiesView, type IdentitiesViewProps } from '../components/Identities/IdentitiesView';
import { ignoredHash } from '../lib/identity-model';
import { ToastProvider } from '../contexts/ToastContext';
import { ToastContainer } from '../components/Common/Toast';
import { ScreenshareContext } from '../hooks/ScreenshareContext';
import type { Folder, Identity, TimelineEvent } from '../types';

const folders: Folder[] = [{ id: 'case', name: 'Halvorsen BEC', order: 0, createdAt: 1 }, { id: 'other', name: 'Other case', order: 1, createdAt: 1 }];
const make = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const org = make('org', 'Halvorsen Shipping', { type: 'organization' });
const lee = make('lee', 'Lee Park', { description: 'Finance director', connections: [{ targetId: 'org', label: 'works at' }] });
const dana = make('dana', 'Dana Okafor', { description: 'Accounts payable', contact: true, status: 'compromised',
  details: [{ id: 'email', label: 'Email', value: 'dana@halvorsen.example' }, { id: 'phone', label: 'Phone', value: '+44 7700 900123', private: true }],
  connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'lee', label: 'reports to' }, { targetId: 'laptop', label: 'approved payments to' }] });
const laptop = make('laptop', 'WS-0231', { type: 'system', connections: [{ targetId: 'org', label: 'belongs to' }] });
const binned = make('binned', 'Trashed Person', { trashed: true });
const all = [org, lee, dana, laptop, binned];
const event = (extra: Partial<TimelineEvent>) => ({ id: `ev-${Math.random()}`, title: 'Payment approved', timestamp: 1, eventType: 'other', source: '', confidence: 'medium',
  linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'case', timelineId: 't',
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra }) as TimelineEvent;

function setup(overrides: Partial<IdentitiesViewProps> = {}, wrap: (node: ReactElement) => ReactElement = node => node, toasts = false) {
  const props: IdentitiesViewProps = {
    identities: all, allIdentities: all, folders, folderId: 'case', events: [], iocs: [],
    onCreate: vi.fn(async partial => make('new', partial.name ?? '', partial)),
    onUpdate: vi.fn(async () => {}), onTrash: vi.fn(async () => {}), onMerge: vi.fn(async () => {}),
    ...overrides,
  };
  render(wrap(<ToastProvider><IdentitiesView {...props} />{toasts && <ToastContainer />}</ToastProvider>));
  return { props, user: userEvent.setup(), list: () => screen.getByRole('region', { name: 'Identities' }) };
}
const profile = (name: string) => screen.getByRole('article', { name });
/** The last update, applied to the stored row the way useIdentities applies a function. */
function lastUpdate(onUpdate: IdentitiesViewProps['onUpdate'], stored: Identity) {
  const [id, change] = vi.mocked(onUpdate).mock.lastCall ?? [];
  return { id, fields: typeof change === 'function' ? change(stored) : change };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the rolodex', () => {
  it('is one tab stop: the arrow keys, Home and End move between identities and show each', async () => {
    const { user, list } = setup();
    const rows = () => within(list()).getAllByRole('button').filter(button => button.hasAttribute('data-identity-row'));
    expect(rows().filter(row => row.tabIndex === 0)).toHaveLength(1);
    rows()[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(rows()[1]).toHaveFocus();
    expect(rows()[1]).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('article', { name: 'Halvorsen Shipping' })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(rows().at(-1)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(rows()[0]).toHaveFocus();
    expect(rows().filter(row => row.tabIndex === 0)).toEqual([rows()[0]]);
  });

  it('lists live identities A–Z, filters by type and contact, and searches public details only', async () => {
    const { user, list } = setup();
    const names = () => within(list()).getAllByRole('button').filter(button => !button.hasAttribute('aria-pressed')).map(button => button.textContent);
    expect(names()).toEqual(['Dana Okafor', 'Halvorsen Shipping', 'Lee Park', 'WS-0231'].map(name => expect.stringContaining(name)));
    await user.click(within(list()).getByRole('button', { name: /^Contacts/ }));
    expect(names()).toEqual([expect.stringContaining('Dana Okafor')]);
    await user.click(within(list()).getByRole('button', { name: /^All/ }));
    await user.type(within(list()).getByRole('searchbox', { name: 'Search identities' }), 'halvorsen.example');
    expect(names()).toEqual([expect.stringContaining('Dana Okafor')]);
    await user.clear(within(list()).getByRole('searchbox', { name: 'Search identities' }));
    await user.type(within(list()).getByRole('searchbox', { name: 'Search identities' }), '7700');
    expect(within(list()).getByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByText('Trashed Person')).not.toBeInTheDocument();
  });

  it('shows each identity\'s investigation only when every investigation is listed', () => {
    setup({ folderId: undefined, identities: [...all, make('far', 'Far Away', { folderId: 'gone' })] });
    expect(within(screen.getByRole('region', { name: 'Identities' })).getAllByText('Halvorsen BEC').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('region', { name: 'Identities' })).getByText('Investigation not on this device')).toBeInTheDocument();
  });
});

describe('an identity\'s profile', () => {
  it('hides a private detail until Show', async () => {
    const { user, list } = setup();
    await user.click(within(list()).getByRole('button', { name: /Dana Okafor/ }));
    expect(within(profile('Dana Okafor')).getByText('dana@halvorsen.example')).toBeInTheDocument();
    expect(within(profile('Dana Okafor')).queryByText('+44 7700 900123')).not.toBeInTheDocument();
    expect(within(profile('Dana Okafor')).getByText('•••• 0123')).toBeInTheDocument();
    await user.click(within(profile('Dana Okafor')).getByRole('button', { name: 'Show private phone' }));
    expect(within(profile('Dana Okafor')).getByText('+44 7700 900123')).toBeInTheDocument();
  });

  it('makes a detail private or public later, but never public while screensharing', async () => {
    const { user, props } = setup({ selectRequest: { id: 'dana', request: 1 } });
    await user.click(within(profile('Dana Okafor')).getByRole('button', { name: 'Make Email private' }));
    expect(lastUpdate(props.onUpdate, dana).fields?.details).toEqual([expect.objectContaining({ label: 'Email', private: true }), dana.details[1]]);
    // It sets what the button says: on a row already made private elsewhere it stays private.
    const alreadyPrivate = { ...dana, details: [{ ...dana.details[0], private: true }, dana.details[1]] };
    expect(lastUpdate(props.onUpdate, alreadyPrivate).fields?.details?.[0]).toMatchObject({ label: 'Email', private: true });
    await user.click(within(profile('Dana Okafor')).getByRole('button', { name: 'Make Phone public' }));
    const shared = lastUpdate(props.onUpdate, dana).fields?.details;
    expect(shared?.[1]).toEqual({ id: 'phone', label: 'Phone', value: '+44 7700 900123' });
    cleanup();
    setup({ selectRequest: { id: 'dana', request: 1 } },
      node => <ScreenshareContext.Provider value={{ maxLevel: 'TLP:GREEN', effectiveLevels: [] }}>{node}</ScreenshareContext.Provider>);
    expect(within(profile('Dana Okafor')).getByRole('button', { name: 'Make Phone public' })).toBeDisabled();
    expect(within(profile('Dana Okafor')).getByRole('button', { name: 'Make Email private' })).toBeEnabled();
  });

  it('never shows a private detail while screensharing', () => {
    setup({ selectRequest: { id: 'dana', request: 1 } },
      node => <ScreenshareContext.Provider value={{ maxLevel: 'TLP:GREEN', effectiveLevels: [] }}>{node}</ScreenshareContext.Provider>);
    expect(within(profile('Dana Okafor')).getByRole('button', { name: 'Show private phone' })).toBeDisabled();
    // Why it is disabled is said on screen and tied to the button, not only in a tooltip.
    expect(within(profile('Dana Okafor')).getByRole('button', { name: 'Show private phone' })).toHaveAccessibleDescription('Private details stay hidden while screensharing.');
    expect(within(profile('Dana Okafor')).queryByText('+44 7700 900123')).not.toBeInTheDocument();
    // Not even the last digits while sharing.
    expect(within(profile('Dana Okafor')).queryByText(/0123/)).not.toBeInTheDocument();
    expect(within(profile('Dana Okafor')).getByText('•••••••')).toBeInTheDocument();
  });

  it('reads connections from both sides and lists an organisation\'s people, contacts first', async () => {
    const { user, list } = setup({ selectRequest: { id: 'lee', request: 1 } });
    const leeCard = profile('Lee Park');
    expect(within(leeCard).getByText('works at')).toBeInTheDocument();
    expect(within(leeCard).getByText('manages')).toBeInTheDocument();
    await user.click(within(list()).getByRole('button', { name: /WS-0231/ }));
    expect(within(profile('WS-0231')).getByText('approved payments to WS-0231')).toBeInTheDocument();
    await user.click(within(list()).getByRole('button', { name: /^Halvorsen Shipping/ }));
    const orgCard = profile('Halvorsen Shipping');
    expect(within(orgCard).getByText('People (2)')).toBeInTheDocument();
    expect(within(orgCard).getAllByRole('button', { name: /Dana Okafor|Lee Park/ }).map(button => button.textContent)).toEqual(['DODana Okafor', 'LPLee Park']);
    // An organisation's members are its people, not connections.
    expect(within(orgCard).getAllByText('None yet.')).toHaveLength(2);
  });

  it('adds a private detail and a connection stored with the built-in phrase', async () => {
    const { user, props } = setup({ selectRequest: { id: 'lee', request: 1 } });
    const card = profile('Lee Park');
    await user.click(within(card).getByRole('button', { name: 'Add a detail' }));
    await user.type(within(card).getByRole('combobox', { name: 'Label' }), 'Phone');
    expect(within(card).getByRole('checkbox')).toBeChecked();
    await user.type(within(card).getByRole('textbox', { name: 'Value' }), '+1 555 0100');
    await user.click(within(card).getByRole('button', { name: 'Add' }));
    expect(lastUpdate(props.onUpdate, lee)).toEqual({ id: 'lee', fields: { details: [expect.objectContaining({ label: 'Phone', value: '+1 555 0100', private: true })] } });
    // Built on the stored row: a detail added meanwhile (on another device or tab) is kept.
    const meanwhile = { ...lee, details: [{ id: 'x', label: 'Email', value: 'lee@example.test' }] };
    expect(lastUpdate(props.onUpdate, meanwhile).fields?.details).toHaveLength(2);
    await user.click(within(card).getByRole('button', { name: 'Add a connection' }));
    await user.type(within(card).getByRole('combobox', { name: 'Lee Park…' }), 'administers');
    await user.selectOptions(within(card).getByRole('combobox', { name: '…whom or what' }), 'laptop');
    await user.click(within(card).getByRole('button', { name: 'Add' }));
    expect(lastUpdate(props.onUpdate, lee)).toEqual({ id: 'lee', fields: { connections: [...lee.connections, { targetId: 'laptop', label: 'administers' }] } });
    // Added again (or already stored meanwhile), it is kept once.
    const already = { ...lee, connections: [...lee.connections, { targetId: 'laptop', label: 'administers' }] };
    expect(lastUpdate(props.onUpdate, already).fields?.connections).toEqual(already.connections);
  });

  it('removes an incoming connection from the identity that holds it', async () => {
    const { user, props } = setup({ selectRequest: { id: 'lee', request: 1 } });
    await user.click(within(profile('Lee Park')).getByRole('button', { name: 'Remove connection: manages Dana Okafor' }));
    // The removed row's button goes away; focus continues from Add a connection, not the page.
    expect(within(profile('Lee Park')).getByRole('button', { name: 'Add a connection' })).toHaveFocus();
    expect(lastUpdate(props.onUpdate, dana)).toEqual({ id: 'dana', fields: { connections: dana.connections.filter(edge => edge.targetId !== 'lee') } });
    // The edge is found in the stored row, not by position: an edge added first does not shift it.
    const shifted = { ...dana, connections: [{ targetId: 'laptop', label: 'uses' }, ...dana.connections] };
    expect(lastUpdate(props.onUpdate, shifted).fields?.connections).toEqual(shifted.connections.filter(edge => edge.targetId !== 'lee'));
  });
});

describe('adding, editing, merging and trashing', () => {
  it('adds a person to the selected investigation, working at an organisation', async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog', { name: 'Add an identity' });
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give it a name');
    // A name (or other name) another identity in the investigation has is refused: it would make links ambiguous.
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'lee park');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This name is already used by another identity in this investigation.');
    expect(props.onCreate).not.toHaveBeenCalled();
    await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Ana Silva');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Works at' }), 'org');
    await user.click(within(dialog).getByRole('checkbox', { name: /A contact/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'case', type: 'person', name: 'Ana Silva', contact: true,
      connections: [{ targetId: 'org', label: 'works at' }] }));
  });

  it('opens Add once for a request from the New menu, and tells the caller', () => {
    const onAddHandled = vi.fn();
    setup({ addRequest: 1, onAddHandled });
    expect(screen.getByRole('dialog', { name: 'Add an identity' })).toBeInTheDocument();
    expect(onAddHandled).toHaveBeenCalledOnce();
  });

  it('merges only after confirmation', async () => {
    const { user, props } = setup({ selectRequest: { id: 'dana', request: 1 } });
    await user.click(within(profile('Dana Okafor')).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Dana Okafor' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Merge it into this one/ }), 'lee');
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    const confirm = screen.getByRole('dialog', { name: 'Merge identities?' });
    expect(confirm).toHaveTextContent('Lee Park will be merged into Dana Okafor');
    expect(props.onMerge).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Merge' }));
    expect(props.onMerge).toHaveBeenCalledWith('dana', 'lee');
  });

  it('saves only what was edited, on top of changes made meanwhile elsewhere', async () => {
    const { user, props } = setup({ selectRequest: { id: 'dana', request: 1 } });
    await user.click(within(profile('Dana Okafor')).getByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('dialog', { name: 'Edit Dana Okafor' }));
    const otherNames = form.getByLabelText('Other names (one per line)');
    await user.clear(otherNames);
    await user.type(otherNames, 'Dana O.');
    await user.click(form.getByRole('button', { name: 'Save' }));
    // While the form was open, a teammate's sync added an other name and changed the description.
    const meanwhile = { ...dana, aliases: [...dana.aliases, 'D. Okafor-Ruiz'], description: 'Changed by a teammate' };
    const { fields } = lastUpdate(props.onUpdate, meanwhile);
    expect(fields).toMatchObject({ name: 'Dana Okafor', description: 'Changed by a teammate' });
    expect(fields?.aliases).toEqual(['D. Okafor-Ruiz', 'Dana O.']);
  });

  it('moves to the trash only after confirmation', async () => {
    const { user, props } = setup({ selectRequest: { id: 'dana', request: 1 } });
    await user.click(within(profile('Dana Okafor')).getByRole('button', { name: 'Edit' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Edit Dana Okafor' })).getByRole('button', { name: 'Move to trash' }));
    expect(props.onTrash).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog', { name: 'Move Dana Okafor to the trash?' })).getByRole('button', { name: 'Move to trash' }));
    expect(props.onTrash).toHaveBeenCalledWith('dana');
    // The profile that opened the form is gone: focus continues from the search box.
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search identities' })).toHaveFocus());
  });
});

describe('names found in the investigation', () => {
  const events = [event({ actor: 'Tomas Ruiz' }), event({ assets: ['fin-db01'] })];
  it('adds a found name as another name of an identity, or as a new one prefilled from it', async () => {
    const tomas = make('tomas', 'Tomás Ruiz');
    const { user, props } = setup({ identities: [...all, tomas], allIdentities: [...all, tomas], events });
    const panel = screen.getByRole('region', { name: /^Not yet in Identities/ });
    await user.click(within(panel).getByRole('button', { name: /Tomas Ruiz/ }));
    await user.click(screen.getByRole('button', { name: 'Add as another name of Tomás Ruiz' }));
    expect(lastUpdate(props.onUpdate, tomas)).toEqual({ id: 'tomas', fields: { aliases: ['Tomas Ruiz'] } });
    expect(lastUpdate(props.onUpdate, { ...tomas, aliases: ['tomas ruiz'] }).fields).toEqual({ aliases: ['tomas ruiz'] });
    await user.click(within(panel).getByRole('button', { name: /fin-db01/ }));
    await user.click(screen.getByRole('button', { name: /Add as a new identity/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add “fin-db01”' });
    expect(within(dialog).getByRole('combobox', { name: 'Type' })).toHaveValue('System');
    expect(within(dialog).getByRole('combobox', { name: 'Detail' })).toHaveValue('Hostname');
  });

  it('does not offer names an archived identity holds, or values held as private details', () => {
    const archived = make('archived', 'Archived Person', { archived: true });
    const holder = make('holder', 'Holder', { details: [{ id: 'p', label: 'Personal email', value: 'secret@example.test', private: true }] });
    setup({ identities: [...all, archived, holder], allIdentities: [...all, archived, holder],
      events: [event({ actor: 'Archived Person', assets: ['secret@example.test', 'fin-db01'] })] });
    const panel = screen.getByRole('region', { name: /^Not yet in Identities/ });
    expect(within(panel).getAllByRole('button').map(button => button.textContent)).toEqual([expect.stringContaining('fin-db01')]);
  });

  it('remembers an ignored name on this device', async () => {
    const { user } = setup({ events });
    await user.click(within(screen.getByRole('region', { name: /^Not yet in Identities/ })).getByRole('button', { name: /fin-db01/ }));
    await user.click(screen.getByRole('button', { name: 'Ignore on this device' }));
    expect(within(screen.getByRole('region', { name: /^Not yet in Identities/ })).queryByRole('button', { name: /fin-db01/ })).not.toBeInTheDocument();
    // Its chip is gone: focus moves on to the next found name, not the page.
    expect(within(screen.getByRole('region', { name: /^Not yet in Identities/ })).getAllByRole('button')[0]).toHaveFocus();
    // Only a hash is kept, never the readable name.
    await waitFor(() => expect(localStorage.getItem('threatcaddy-identities-ignored-v3')).not.toBeNull());
    const stored = localStorage.getItem('threatcaddy-identities-ignored-v3') ?? '';
    expect(JSON.parse(stored)).toEqual({ v: 3, folders: { case: [ignoredHash(JSON.stringify(['case', 'fin-db01']))] } });
    expect(stored).not.toContain('fin-db01');
  });
});

describe('read only and org charts', () => {
  it('offers no changes for a remote investigation', () => {
    setup({ readOnly: true, selectRequest: { id: 'dana', request: 1 }, events: [event({ actor: 'Somebody' })] });
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(within(profile('Dana Okafor')).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(profile('Dana Okafor')).queryByRole('button', { name: 'Add a detail' })).not.toBeInTheDocument();
    expect(within(profile('Dana Okafor')).getByRole('combobox', { name: 'Status' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: /^Not yet in Identities/ })).not.toBeInTheDocument();
    expect(screen.getByText(/can't be edited here/)).toBeInTheDocument();
  });

  it('opens an organisation\'s chart from its profile, with a team open only when someone in it is flagged', async () => {
    const ana = make('ana', 'Ana Silva', { connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'dana', label: 'reports to' }] });
    const calm = { ...dana, status: undefined, contact: undefined };
    for (const [people, open] of [[[org, lee, calm, ana], false], [[org, lee, calm, { ...ana, status: 'compromised' as const }], true]] as const) {
      const { user, list } = setup({ identities: [...people], allIdentities: [...people] });
      await user.click(within(list()).getByRole('button', { name: /^Halvorsen Shipping/ }));
      await user.click(within(profile('Halvorsen Shipping')).getByRole('button', { name: 'Open the org chart' }));
      expect(screen.getByRole('combobox', { name: 'Organization' })).toHaveValue('org');
      // Lee heads the chart; Dana's card sits under Lee, and Ana under Dana.
      const team = screen.getByRole('region', { name: "Dana Okafor's team" });
      expect(within(team).getByRole('button', { name: open ? 'Hide team (1)' : 'Show team (1)' })).toHaveAttribute('aria-expanded', String(open));
      expect(within(team).queryByRole('button', { name: /^Ana Silva/ }) !== null).toBe(open);
      cleanup();
    }
  });

  it('keeps every organisation and every other name when an edit only changes the job title', async () => {
    const beta = make('beta', 'Beta Holdings', { type: 'organization' });
    const twoJobs = make('dana', 'Dana Okafor', { aliases: ['Okafor, Dana', 'Acme, Inc.'],
      connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'beta', label: 'works at' }, { targetId: 'lee', label: 'reports to' }] });
    const people = [org, beta, lee, twoJobs];
    const { user, props } = setup({ identities: people, allIdentities: people, selectRequest: { id: 'dana', request: 1 } });
    await user.click(within(profile('Dana Okafor')).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Dana Okafor' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Job title' }), 'Accounts payable');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const { fields } = lastUpdate(props.onUpdate, twoJobs);
    expect(fields).toEqual({ name: 'Dana Okafor', type: 'person', description: 'Accounts payable', aliases: ['Okafor, Dana', 'Acme, Inc.'] });
    expect(fields).not.toHaveProperty('connections');
  });

  it('stores a typed reverse phrase on the other identity, so "manages" becomes "reports to"', async () => {
    const { user, props } = setup({ selectRequest: { id: 'lee', request: 1 } });
    const card = profile('Lee Park');
    await user.click(within(card).getByRole('button', { name: 'Add a connection' }));
    await user.type(within(card).getByRole('combobox', { name: 'Lee Park…' }), 'manages');
    await user.selectOptions(within(card).getByRole('combobox', { name: '…whom or what' }), 'laptop');
    await user.click(within(card).getByRole('button', { name: 'Add' }));
    expect(lastUpdate(props.onUpdate, laptop)).toEqual({ id: 'laptop', fields: { connections: [...laptop.connections, { targetId: 'lee', label: 'reports to' }] } });
  });

  it('returns focus to the button that opened a form, and keeps the form when saving fails', async () => {
    const failing = vi.fn(async () => { throw new Error('disk full'); });
    const { user } = setup({ selectRequest: { id: 'lee', request: 1 }, onUpdate: failing });
    const card = profile('Lee Park');
    await user.click(within(card).getByRole('button', { name: 'Add a detail' }));
    await user.type(within(card).getByRole('combobox', { name: 'Label' }), 'Email');
    await user.type(within(card).getByRole('textbox', { name: 'Value' }), 'lee@example.test');
    await user.click(within(card).getByRole('button', { name: 'Add' }));
    expect(failing).toHaveBeenCalledOnce();
    // The view reports the failure; the form and what was typed stay.
    expect(within(card).getByRole('textbox', { name: 'Value' })).toHaveValue('lee@example.test');
    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(within(card).getByRole('button', { name: 'Add a detail' })).toHaveFocus();
  });

  it('lists where an identity appears, opens each item, and starts a note about it', async () => {
    const note = { id: 'n1', title: 'Call notes', content: 'Spoke to Dana Okafor about the invoice.', folderId: 'case', tags: [], pinned: false,
      archived: false, trashed: false, createdAt: 1, updatedAt: 5 };
    const payment = event({ id: 'pay', title: 'Payment approved', actor: 'dana okafor', timestamp: 9 });
    const onOpenEvent = vi.fn();
    const onOpenNote = vi.fn();
    const onAddNote = vi.fn();
    const { user } = setup({ selectRequest: { id: 'dana', request: 1 }, notes: [note], events: [payment, event({ title: 'Unrelated', actor: 'Lee Park' })],
      iocs: [{ id: 'ioc', type: 'email', value: 'dana@halvorsen.example', confidence: 'medium', folderId: 'case', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 3 }],
      onOpenEvent, onOpenNote, onAddNote });
    const activity = within(profile('Dana Okafor')).getByRole('region', { name: 'Activity (3)' });
    const items = within(activity).getAllByRole('listitem').map(item => item.textContent ?? '');
    expect(items[0]).toContain('Payment approved');
    expect(items[1]).toContain('Call notes');
    expect(items[2]).toContain('dana@halvorsen.example');
    await user.click(within(activity).getByRole('button', { name: /Payment approved/ }));
    expect(onOpenEvent).toHaveBeenCalledWith(payment);
    await user.click(within(activity).getByRole('button', { name: /Call notes/ }));
    expect(onOpenNote).toHaveBeenCalledWith(note);
    await user.click(within(activity).getByRole('button', { name: 'Add a note about Dana Okafor' }));
    expect(onAddNote).toHaveBeenCalledWith(dana);
  });

  it('opens the list filtered to text that more than one identity holds', () => {
    setup({ selectRequest: { id: 'dana', request: 1, query: 'halvorsen' } });
    expect(screen.getByRole('searchbox', { name: 'Search identities' })).toHaveValue('halvorsen');
    expect(profile('Dana Okafor')).toBeInTheDocument();
  });

  it('says so when a note about an identity cannot be created', async () => {
    const onAddNote = vi.fn(async () => { throw new Error('vault locked'); });
    const { user } = setup({ selectRequest: { id: 'lee', request: 1 }, onAddNote }, node => <>{node}</>, true);
    await user.click(within(profile('Lee Park')).getByRole('button', { name: 'Add a note about Lee Park' }));
    expect(await screen.findByText(/vault locked/)).toBeInTheDocument();
  });

  it('offers no new note about an identity in a remote investigation', () => {
    setup({ selectRequest: { id: 'lee', request: 1 }, readOnly: true, onAddNote: vi.fn() });
    expect(within(profile('Lee Park')).getByText('Nothing on the timeline, in notes or in IOCs names Lee Park yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a note about/ })).not.toBeInTheDocument();
  });

  it('does not open Add from the New menu when there is no investigation to add to', () => {
    setup({ folders: [], addRequest: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAccessibleDescription('Create an investigation first.');
  });
});
