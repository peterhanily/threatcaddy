import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { OverviewView, type OverviewViewProps } from '../components/Overview/OverviewView';
import { identityGroups, iocTypeCounts, openTasks } from '../lib/case-overview';
import type { EvidenceItem, Folder, Identity, Note, StandaloneIOC, Task, TimelineEvent } from '../types';

const folder: Folder = { id: 'f1', name: 'Op Falcon', order: 0, createdAt: Date.UTC(2026, 0, 5), status: 'active', clsLevel: 'TLP:AMBER', papLevel: 'PAP:GREEN' };

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, title: `Task ${id}`, completed: false, priority: 'none', folderId: 'f1', tags: [], status: 'todo', order: 0,
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...overrides,
});
const event = (id: string, timestamp: number, overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id, timestamp, title: `Event ${id}`, eventType: 'other', source: '', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [],
  linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'f1', timelineId: 't1',
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...overrides,
} as TimelineEvent);
const identity = (id: string, type: string, name: string, overrides: Partial<Identity> = {}): Identity => ({
  id, folderId: 'f1', type, name, aliases: [], details: [], connections: [], tags: [], trashed: false, archived: false,
  createdAt: 1, updatedAt: 1, ...overrides,
});
const ioc = (id: string, type: StandaloneIOC['type'], value: string, overrides: Partial<StandaloneIOC> = {}): StandaloneIOC => ({
  id, type, value, confidence: 'medium', folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...overrides,
});
const note = (id: string, overrides: Partial<Note> = {}): Note => ({
  id, title: `Note ${id}`, content: '', folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1, ...overrides,
} as Note);
const evidenceItem = (id: string): EvidenceItem => ({ id, title: id, folderId: 'f1', fileName: `${id}.pdf`, fileType: 'pdf', size: 1, trashed: false, archived: false, createdAt: 1, updatedAt: 1 } as EvidenceItem);

function renderOverview(overrides: Partial<OverviewViewProps> = {}) {
  const props: OverviewViewProps = {
    folder, notes: [], tasks: [], events: [], identities: [], iocs: [], evidence: [], products: [],
    onNavigate: vi.fn(), onOpenTask: vi.fn(), onOpenEvent: vi.fn(), onOpenIdentity: vi.fn(),
    onImportFiles: vi.fn(), onAddNote: vi.fn(), onAddEvent: vi.fn(), ...overrides,
  };
  render(<OverviewView {...props} />);
  return props;
}
const block = (name: string) => screen.getByRole('region', { name });

describe('case overview: ordering and counting', () => {
  it('puts overdue tasks first, longest overdue at the top, and leaves out finished, archived and trashed ones', () => {
    const { open, overdue } = openTasks([
      task('no-date', { priority: 'high' }),
      task('future', { dueDate: '2099-03-01' }),
      task('late', { dueDate: '2020-06-01' }),
      task('later', { dueDate: '2099-09-01' }),
      task('very-late', { dueDate: '2019-01-01' }),
      task('done', { dueDate: '2019-01-01', status: 'done', completed: true }),
      task('archived', { dueDate: '2019-01-01', archived: true }),
      task('trashed', { dueDate: '2019-01-01', trashed: true }),
    ]);
    expect(open.map(row => row.id)).toEqual(['very-late', 'late', 'future', 'later', 'no-date']);
    expect(overdue).toBe(2);
  });

  it('groups identities by type with custom types together, flagged ones first', () => {
    const groups = identityGroups([
      identity('1', 'person', 'Quiet', { updatedAt: 9 }),
      identity('2', 'person', 'Hit', { status: 'compromised' }),
      identity('3', 'vehicle', 'Van'),
      identity('4', 'system', 'Gone', { trashed: true }),
    ]);
    expect(groups.map(group => [group.type, group.identities.map(row => row.name)])).toEqual([['person', ['Hit', 'Quiet']], ['other', ['Van']]]);
  });

  it('counts each indicator once across notes and hand-added IOCs, skipping dismissed ones', () => {
    const analysis = { iocs: [
      { type: 'domain' as const, value: 'Evil.example', dismissed: false },
      { type: 'ipv4' as const, value: '203.0.113.9', dismissed: true },
    ] };
    const counts = iocTypeCounts([{ trashed: false, iocAnalysis: analysis }], [], [], [ioc('a', 'domain', 'evil.example'), ioc('b', 'ipv4', '198.51.100.7'), ioc('c', 'ipv4', '198.51.100.8', { trashed: true })]);
    expect(counts).toEqual({ total: 2, byType: [['domain', 1], ['ipv4', 1]] });
  });
});

describe('OverviewView', () => {
  it('shows the header with status, classification and dates, and headings in order', () => {
    renderOverview({ tasks: [task('a')] });
    expect(screen.getByRole('heading', { level: 1, name: 'Op Falcon' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('TLP:AMBER')).toBeInTheDocument();
    expect(screen.getByText('PAP:GREEN')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Last change')).toBeInTheDocument();
    expect(screen.getAllByRole('heading').map(heading => heading.tagName)).toEqual(['H1', 'H2', 'H2', 'H2', 'H2', 'H2', 'H2']);
  });

  it('lists open tasks with overdue first and opens the one that is chosen', () => {
    const late = task('late', { title: 'Reset credentials', dueDate: '2020-06-01', assigneeId: 'u1' });
    const props = renderOverview({
      tasks: [task('soon', { title: 'Collect logs', dueDate: '2099-01-01' }), late, task('done', { title: 'Finished', completed: true, status: 'done' })],
      members: [{ id: 'm1', userId: 'u1', role: 'editor', joinedAt: '', displayName: 'Dana Ruiz', email: '' }],
    });
    const attention = block('Needs attention');
    expect(attention).toHaveTextContent('Open tasks: 2');
    expect(attention).toHaveTextContent('Overdue: 1');
    const rows = within(attention).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([expect.stringMatching(/^Reset credentialsOverdue since .*Dana Ruiz$/), expect.stringMatching(/^Collect logsDue /)]);
    expect(attention).not.toHaveTextContent('Finished');
    fireEvent.click(within(attention).getByRole('button', { name: /Reset credentials/ }));
    expect(props.onOpenTask).toHaveBeenCalledWith(late);
  });

  it('shows the newest events with their actor and assets, and opens one', () => {
    const newest = event('new', Date.UTC(2026, 4, 2), { title: 'Mailbox rule created', actor: 'j.doe', assets: ['MAIL-01'] });
    const props = renderOverview({ events: [event('old', Date.UTC(2026, 4, 1), { title: 'First sign-in' }), newest, event('gone', Date.UTC(2026, 4, 3), { title: 'Removed', trashed: true })] });
    const timeline = block('Latest on the timeline');
    expect(within(timeline).getAllByRole('listitem').map(row => row.textContent)).toEqual([expect.stringMatching(/^Mailbox rule created.*j\.doeMAIL-01$/), expect.stringMatching(/^First sign-in/)]);
    expect(timeline).toHaveTextContent('Events: 2');
    fireEvent.click(within(timeline).getByRole('button', { name: /Mailbox rule created/ }));
    expect(props.onOpenEvent).toHaveBeenCalledWith(newest);
  });

  it('names identities by type and never shows their details, private or not', () => {
    const dana = identity('1', 'person', 'Dana Ruiz', {
      description: 'Finance lead',
      details: [{ id: 'd1', label: 'Home address', value: '12 Secret Lane', private: true }, { id: 'd2', label: 'Phone', value: '+1 555 0100' }, { id: 'd3', label: 'Email', value: 'dana@example.org' }] as Identity['details'],
    });
    const props = renderOverview({ identities: [dana, identity('2', 'organization', 'Acme'), identity('3', 'system', 'MAIL-01'), identity('4', 'account', 'svc-backup'), identity('5', 'vehicle', 'Van 7')] });
    const involved = block('Who and what is involved');
    for (const text of ['People', 'Organizations', 'Systems', 'Accounts', 'Other', 'Dana Ruiz', 'Acme', 'MAIL-01', 'svc-backup', 'Van 7', 'Identities: 5']) expect(involved).toHaveTextContent(text);
    for (const hidden of ['12 Secret Lane', '555 0100', 'dana@example.org', 'Home address']) expect(document.body).not.toHaveTextContent(hidden);
    fireEvent.click(within(involved).getByRole('button', { name: 'Dana Ruiz' }));
    expect(props.onOpenIdentity).toHaveBeenCalledWith(dana);
  });

  it('counts indicators by type, evidence, and products with the latest one', () => {
    renderOverview({
      iocs: [ioc('a', 'domain', 'evil.example'), ioc('b', 'domain', 'bad.example'), ioc('c', 'ipv4', '203.0.113.9')],
      evidence: [evidenceItem('e1'), evidenceItem('e2')],
      products: [note('p1', { title: 'Older draft', tags: ['product'], updatedAt: 5 }), note('p2', { title: 'Incident report draft', tags: ['product'], updatedAt: 9 })],
    });
    const indicators = block('Indicators');
    expect(indicators).toHaveTextContent('Unique IOCs: 3');
    expect(within(indicators).getAllByRole('listitem').map(row => row.textContent)).toEqual([expect.stringMatching(/2$/), expect.stringMatching(/1$/)]);
    expect(block('Evidence')).toHaveTextContent('Files: 2');
    const products = block('Products and report drafts');
    expect(products).toHaveTextContent('Saved: 2');
    expect(products).toHaveTextContent('Latest: Incident report draft');
    expect(products).not.toHaveTextContent('Older draft');
  });

  it('links every block to its view', () => {
    const props = renderOverview({ tasks: [task('a')] });
    const links: Array<[string, string, string]> = [
      ['Needs attention', 'All tasks', 'tasks'], ['Latest on the timeline', 'Open timeline', 'timeline'],
      ['Who and what is involved', 'Open identities', 'identities'], ['Indicators', 'Open IOCs', 'ioc-stats'],
      ['Evidence', 'Open evidence', 'evidence'], ['Products and report drafts', 'Open products', 'products'],
    ];
    for (const [name, label, view] of links) {
      fireEvent.click(within(block(name)).getByRole('button', { name: label }));
      expect(props.onNavigate).toHaveBeenLastCalledWith(view);
    }
  });

  it('shows only what it is given: items filtered out for screenshare leave no trace', () => {
    // App passes the lists already filtered for the screenshare level; the hidden rows are simply absent.
    const all = {
      tasks: [task('pub', { title: 'Public task' }), task('sec', { title: 'Restricted task', clsLevel: 'TLP:RED', dueDate: '2020-01-01' })],
      events: [event('pub', 2, { title: 'Public event' }), event('sec', 3, { title: 'Restricted event', clsLevel: 'TLP:RED', actor: 'Restricted actor' })],
      identities: [identity('pub', 'person', 'Public person'), identity('sec', 'person', 'Restricted person', { clsLevel: 'TLP:RED' })],
      iocs: [ioc('pub', 'domain', 'public.example'), ioc('sec', 'ipv4', '203.0.113.9', { clsLevel: 'TLP:RED' })],
    };
    const visible = <T extends { clsLevel?: string }>(rows: T[]) => rows.filter(row => row.clsLevel !== 'TLP:RED');
    renderOverview({ tasks: visible(all.tasks), events: visible(all.events), identities: visible(all.identities), iocs: visible(all.iocs) });
    for (const shown of ['Public task', 'Public event', 'Public person', 'Open tasks: 1', 'Events: 1', 'Identities: 1', 'Unique IOCs: 1']) expect(document.body).toHaveTextContent(shown);
    expect(document.body).not.toHaveTextContent(/Restricted|Overdue/);
  });

  it('offers the three first actions when the investigation is empty', () => {
    const props = renderOverview();
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing in this investigation yet' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import source files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add an event' }));
    expect(props.onImportFiles).toHaveBeenCalledTimes(1);
    expect(props.onAddNote).toHaveBeenCalledTimes(1);
    expect(props.onAddEvent).toHaveBeenCalledTimes(1);
  });

  it('offers no actions in an empty read-only investigation', () => {
    renderOverview({ onImportFiles: undefined, onAddNote: undefined, onAddEvent: undefined });
    expect(screen.getByText('Items added to this investigation will be summarized here.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not call a loading investigation empty', () => {
    renderOverview({ loading: true });
    expect(screen.getByRole('heading', { level: 1, name: 'Op Falcon' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing in this investigation yet')).not.toBeInTheDocument();
  });

  it('points to the investigations list when none is open', () => {
    const props = renderOverview({ folder: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Browse investigations' }));
    expect(props.onNavigate).toHaveBeenCalledWith('investigations');
  });
});
