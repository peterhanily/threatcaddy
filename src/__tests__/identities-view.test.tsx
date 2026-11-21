import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { IdentitiesView, type IdentitiesViewProps } from '../components/Identities/IdentitiesView';
import { ToastProvider } from '../contexts/ToastContext';
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

function setup(overrides: Partial<IdentitiesViewProps> = {}, wrap: (node: ReactElement) => ReactElement = node => node) {
  const props: IdentitiesViewProps = {
    identities: all, allIdentities: all, folders, folderId: 'case', events: [], iocs: [],
    onCreate: vi.fn(async partial => make('new', partial.name ?? '', partial)),
    onUpdate: vi.fn(async () => {}), onTrash: vi.fn(async () => {}), onMerge: vi.fn(async () => {}),
    ...overrides,
  };
  render(wrap(<ToastProvider><IdentitiesView {...props} /></ToastProvider>));
  return { props, user: userEvent.setup(), list: () => screen.getByRole('region', { name: 'Identities' }) };
}
const profile = (name: string) => screen.getByRole('article', { name });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the rolodex', () => {
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
  it('hides a private detail until Show, and keeps it hidden while screensharing', async () => {
    const { user, list } = setup();
    await user.click(within(list()).getByRole('button', { name: /Dana Okafor/ }));
    expect(within(profile('Dana Okafor')).getByText('dana@halvorsen.example')).toBeInTheDocument();
    expect(within(profile('Dana Okafor')).queryByText('+44 7700 900123')).not.toBeInTheDocument();
    expect(within(profile('Dana Okafor')).getByText('•••• 0123')).toBeInTheDocument();
    await user.click(within(profile('Dana Okafor')).getByRole('button', { name: 'Show private phone' }));
    expect(within(profile('Dana Okafor')).getByText('+44 7700 900123')).toBeInTheDocument();
  });

  it('never shows a private detail while screensharing', () => {
    setup({ selectRequest: { id: 'dana', request: 1 } },
      node => <ScreenshareContext.Provider value={{ maxLevel: 'TLP:GREEN', effectiveLevels: [] }}>{node}</ScreenshareContext.Provider>);
    expect(within(profile('Dana Okafor')).getByRole('button', { name: 'Show private phone' })).toBeDisabled();
    expect(within(profile('Dana Okafor')).queryByText('+44 7700 900123')).not.toBeInTheDocument();
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
    expect(props.onUpdate).toHaveBeenLastCalledWith('lee', { details: [expect.objectContaining({ label: 'Phone', value: '+1 555 0100', private: true })] });
    await user.click(within(card).getByRole('button', { name: 'Add a connection' }));
    await user.type(within(card).getByRole('combobox', { name: 'Lee Park…' }), 'administers');
    await user.selectOptions(within(card).getByRole('combobox', { name: '…whom or what' }), 'laptop');
    await user.click(within(card).getByRole('button', { name: 'Add' }));
    expect(props.onUpdate).toHaveBeenLastCalledWith('lee', { connections: [...lee.connections, { targetId: 'laptop', label: 'administers' }] });
  });

  it('removes an incoming connection from the identity that holds it', async () => {
    const { user, props } = setup({ selectRequest: { id: 'lee', request: 1 } });
    await user.click(within(profile('Lee Park')).getAllByRole('button', { name: 'Remove this connection' })[1]);
    expect(props.onUpdate).toHaveBeenLastCalledWith('dana', { connections: dana.connections.filter(edge => edge.targetId !== 'lee') });
  });
});

describe('adding, editing, merging and trashing', () => {
  it('adds a person to the selected investigation, working at an organisation', async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog', { name: 'Add an identity' });
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give it a name');
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

  it('merges only after confirmation, and moves to the trash only after confirmation', async () => {
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

  it('moves to the trash only after confirmation', async () => {
    const { user, props } = setup({ selectRequest: { id: 'dana', request: 1 } });
    await user.click(within(profile('Dana Okafor')).getByRole('button', { name: 'Edit' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Edit Dana Okafor' })).getByRole('button', { name: 'Move to trash' }));
    expect(props.onTrash).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog', { name: 'Move Dana Okafor to the trash?' })).getByRole('button', { name: 'Move to trash' }));
    expect(props.onTrash).toHaveBeenCalledWith('dana');
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
    expect(props.onUpdate).toHaveBeenCalledWith('tomas', { aliases: ['Tomas Ruiz'] });
    await user.click(within(panel).getByRole('button', { name: /fin-db01/ }));
    await user.click(screen.getByRole('button', { name: /Add as a new identity/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add “fin-db01”' });
    expect(within(dialog).getByRole('combobox', { name: 'Type' })).toHaveValue('System');
    expect(within(dialog).getByRole('combobox', { name: 'Detail' })).toHaveValue('Hostname');
  });

  it('remembers an ignored name on this device', async () => {
    const { user } = setup({ events });
    await user.click(within(screen.getByRole('region', { name: /^Not yet in Identities/ })).getByRole('button', { name: /fin-db01/ }));
    await user.click(screen.getByRole('button', { name: 'Ignore on this device' }));
    expect(within(screen.getByRole('region', { name: /^Not yet in Identities/ })).queryByRole('button', { name: /fin-db01/ })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('threatcaddy-identities-ignored-v1') ?? '[]')).toEqual([JSON.stringify(['case', 'fin-db01'])]);
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

  it('opens an organisation\'s chart from its profile and shows the team that holds a flagged person', async () => {
    const { user, list } = setup();
    await user.click(within(list()).getByRole('button', { name: /^Halvorsen Shipping/ }));
    await user.click(within(profile('Halvorsen Shipping')).getByRole('button', { name: 'Open the org chart' }));
    expect(screen.getByRole('combobox', { name: 'Organization' })).toHaveValue('org');
    // Lee heads the chart; Dana (compromised) reports to Lee, so the team is shown.
    expect(screen.getByRole('region', { name: "Dana Okafor's team" })).toBeInTheDocument();
  });
});
