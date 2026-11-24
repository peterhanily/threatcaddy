/**
 * F7: accessibility that jsdom can check. Browser-only checks (focus after a chip goes away,
 * target sizes, right-to-left drawing) are in e2e/identities.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataImportModal } from '../components/Import/DataImportModal';
import { IdentitiesView, type IdentitiesViewProps } from '../components/Identities/IdentitiesView';
import { ToastProvider } from '../contexts/ToastContext';
import { mergeIdentities } from '../lib/merge-identities';
import type { Folder, Identity } from '../types';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const folders: Folder[] = [{ id: 'case', name: 'Fictional case', order: 0, createdAt: 1 }];
const make = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const view = (rows: Identity[], extra: Partial<IdentitiesViewProps> = {}) => render(<ToastProvider><IdentitiesView identities={rows} allIdentities={rows}
  folders={folders} folderId="case" events={[]} iocs={[]} onCreate={vi.fn()} onUpdate={vi.fn(async () => {})} onTrash={vi.fn()} onMerge={vi.fn()} {...extra} /></ToastProvider>);

describe('the Identities view', () => {
  it('names whose team a Show team button opens, and draws teams as groups, not landmarks', async () => {
    const org = make('org', 'Halvorsen Shipping', { type: 'organization' });
    const lee = make('lee', 'Lee Park', { connections: [{ targetId: 'org', label: 'works at' }] });
    const dana = make('dana', 'Dana Okafor', { connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'lee', label: 'reports to' }] });
    const ana = make('ana', 'Ana Silva', { connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'dana', label: 'reports to' }] });
    view([org, lee, dana, ana], { selectRequest: { id: 'org', request: 1 } });
    await userEvent.setup().click(screen.getByRole('button', { name: /Org charts/ }));
    const team = screen.getByRole('group', { name: "Dana Okafor's team" });
    expect(screen.queryByRole('region', { name: "Dana Okafor's team" })).toBeNull();
    expect(within(team).getByRole('button', { name: /Show team/ })).toHaveAccessibleDescription('Dana Okafor');
  });

  it('scrolls to the profile without animation when the system asks for reduced motion', async () => {
    // jsdom has neither: a phone-width screen (the profile sits under the list) that asks for reduced motion.
    const scroll = vi.fn();
    const saved = { scrollIntoView: Element.prototype.scrollIntoView, matchMedia: window.matchMedia };
    Element.prototype.scrollIntoView = scroll;
    window.matchMedia = (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 0; });
    try {
      view([make('a', 'Ana Silva'), make('b', 'Ben Cole')]);
      await userEvent.setup().click(screen.getByRole('button', { name: /^Ben Cole/ }));
      expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
    } finally {
      Element.prototype.scrollIntoView = saved.scrollIntoView;
      window.matchMedia = saved.matchMedia;
    }
  });
});

describe('merging', () => {
  it('explains a refused merge in the interface language', async () => {
    await expect(mergeIdentities('same', 'same')).rejects.toThrow('Choose two different identities to merge.');
  });
});

describe('the Data Import preview', () => {
  it('lists values it will not read before importing', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><DataImportModal open onClose={vi.fn()} folders={[{ ...folders[0], updatedAt: 1 } as Folder]} timelines={[]} defaultFolderId="case"
      onCreateTimeline={vi.fn()} onImportComplete={vi.fn()} /></ToastProvider>);
    const input = screen.getAllByRole('textbox')[0];
    await user.click(input);
    await user.paste('Name,Type,Status,Contact\nDana Okafor,Personne,Compromis,oui\nLee Park,person,suspicious,no');
    await user.click(screen.getByRole('button', { name: 'Parse & Preview' }));
    const notice = screen.getByText('Not recognised in English or in the interface language:').parentElement as HTMLElement;
    expect(within(notice).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Type “Personne”: new identities get it as a type of their own.',
      'Status “Compromis”: not imported.',
      'Contact “oui”: not imported (use yes or no).',
    ]);
  });
});
