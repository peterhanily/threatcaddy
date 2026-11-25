/**
 * The profile shown in the Identities view while a search or filter narrows the list (found by the F8
 * re-audit): opening an identity from a profile or a chart shows it, clearing a status filter that hides
 * it; a profile edited out of the list stays, with its focus, until the search or filters change; an
 * identity added while filtered is shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IdentitiesView, type IdentitiesViewProps } from '../components/Identities/IdentitiesView';
import { ToastProvider } from '../contexts/ToastContext';
import type { Folder, Identity } from '../types';
import type { IdentityChange } from '../components/Identities/identity-labels';

const folders: Folder[] = [{ id: 'case', name: 'Halvorsen BEC', order: 0, createdAt: 1 }];
const make = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const org = make('org', 'Halvorsen Shipping', { type: 'organization' });

function view(overrides: Partial<IdentitiesViewProps>, initial: Identity[]) {
  let rows = initial;
  const props = (): IdentitiesViewProps => ({
    identities: rows, allIdentities: rows, folders, folderId: 'case', events: [], iocs: [],
    onCreate: vi.fn(async partial => { const created = make('new', partial.name ?? '', partial); rows = [...rows, created]; rerender(); return created; }),
    onUpdate, onTrash: vi.fn(async () => {}), onMerge: vi.fn(async () => {}),
    ...overrides,
  });
  const onUpdate = vi.fn(async (id: string, change: IdentityChange) => {
    rows = rows.map(row => (row.id === id ? { ...row, ...(typeof change === 'function' ? change(row) : change), updatedAt: row.updatedAt + 1 } : row));
    rerender();
  });
  const rendered = render(<ToastProvider><IdentitiesView {...props()} /></ToastProvider>);
  function rerender() { rendered.rerender(<ToastProvider><IdentitiesView {...props()} /></ToastProvider>); }
  return { ...rendered, user: userEvent.setup() };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the profile shown while the list is narrowed', () => {
  it('opens the organisation from a person\'s profile with "Compromised" on', async () => {
    const dana = make('dana', 'Dana Okafor', { status: 'compromised', connections: [{ targetId: 'org', label: 'works at' }] });
    const { user } = view({ selectRequest: { request: 1, status: 'compromised' } }, [dana, org, make('lee', 'Lee Park')]);
    const profile = screen.getByRole('article', { name: 'Dana Okafor' });
    // The connection chip "works at Halvorsen Shipping".
    await user.click(within(profile).getByRole('button', { name: 'Halvorsen Shipping' }));
    expect(screen.getByRole('article', { name: 'Halvorsen Shipping' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: /Compromised/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('control: without a status filter the same click opens the organisation', async () => {
    const dana = make('dana', 'Dana Okafor', { status: 'compromised', connections: [{ targetId: 'org', label: 'works at' }] });
    const { user } = view({ selectRequest: { id: 'dana', request: 1, query: 'Dana' } }, [dana, org, make('lee', 'Lee Park')]);
    await user.click(within(screen.getByRole('article', { name: 'Dana Okafor' })).getByRole('button', { name: 'Halvorsen Shipping' }));
    expect(screen.getByRole('article', { name: 'Halvorsen Shipping' })).toBeInTheDocument();
  });

  it('opens a person from the Org charts tab though the status filter leaves them out', async () => {
    const boss = make('boss', 'Boss Person', { connections: [{ targetId: 'org', label: 'works at' }] });
    const dana = make('dana', 'Dana Okafor', { status: 'compromised', connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'boss', label: 'reports to' }] });
    const { user } = view({ selectRequest: { request: 1, status: 'compromised' } }, [boss, dana, org]);
    await user.click(screen.getByRole('button', { name: 'Org charts' }));
    // Boss's card in the chart opens Boss.
    await user.click(screen.getAllByRole('button', { name: /Boss Person/ })[0]);
    expect(screen.getByRole('article', { name: 'Boss Person' })).toBeInTheDocument();
  });

  it('keeps the profile, and its focus, when its status changes under a status filter', async () => {
    const ana = make('ana', 'Ana Silva', { status: 'compromised' });
    const ben = make('ben', 'Ben Cole', { status: 'compromised' });
    const { user } = view({ selectRequest: { id: 'ana', request: 1, status: 'compromised' } }, [ana, ben]);
    const select = within(screen.getByRole('article', { name: 'Ana Silva' })).getByRole('combobox', { name: 'Status' });
    select.focus();
    await user.selectOptions(select, 'contained');
    expect(screen.getByRole('article', { name: 'Ana Silva' })).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Ana Silva' })).getByRole('combobox', { name: 'Status' })).toHaveFocus();
  });

  it('keeps the profile when Contact is turned off under the Contacts filter', async () => {
    const ana = make('ana', 'Ana Silva', { contact: true });
    const ben = make('ben', 'Ben Cole', { contact: true });
    const { user } = view({ selectRequest: { id: 'ana', request: 1 } }, [ana, ben]);
    await user.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: /Contacts/ }));
    const toggle = within(screen.getByRole('article', { name: 'Ana Silva' })).getByRole('button', { name: 'Contact' });
    await user.click(toggle);
    expect(screen.getByRole('article', { name: 'Ana Silva' })).toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('shows an identity added while the list is filtered by status', async () => {
    const ana = make('ana', 'Ana Silva', { status: 'compromised' });
    const { user } = view({ selectRequest: { request: 1, status: 'compromised' } }, [ana]);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'svc-backup');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('article', { name: 'svc-backup' })).toBeInTheDocument();
  });
});
