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
import type { Folder, Identity, TimelineEvent } from '../types';
import i18n from '../i18n';
import { TimelineEventCard } from '../components/Timeline/TimelineEventCard';
import { IdentityProfile } from '../components/Identities/IdentityProfile';
import { useIdentityLabels } from '../components/Identities/identity-labels';

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
    const english = i18n.t('merge.errorSame', { ns: 'identities' });
    i18n.addResource('en', 'identities', 'merge.errorSame', 'In the interface language.');
    try {
      await expect(mergeIdentities('same', 'same')).rejects.toThrow('In the interface language.');
    } finally {
      i18n.addResource('en', 'identities', 'merge.errorSame', english);
    }
  });
});

describe('the timeline "+N"', () => {
  it('moves focus to the first asset it shows, as the button goes away', async () => {
    render(<TimelineEventCard event={{ id: 'ev', folderId: 'case', title: 'Payment approved', timestamp: 1, eventType: 'other', confidence: 'medium', source: '',
      assets: ['A1', 'A2', 'A3', 'A4', 'A5'], tags: [], starred: false, linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], timelineId: 'tl',
      trashed: false, archived: false, createdAt: 1, updatedAt: 1 } as TimelineEvent} onSelect={vi.fn()} onToggleStar={vi.fn()} />);
    screen.getByRole('button', { name: '+2: show all assets' }).focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(screen.getByText('A5')).toBeInTheDocument();
    // Without identities the chips are text: focus goes to the event's title, at once.
    expect(screen.getByRole('button', { name: 'Payment approved' })).toHaveFocus();
  });
});

describe('a private detail', () => {
  function Profile({ identity, screensharing }: { identity: Identity; screensharing: boolean }) {
    const labels = useIdentityLabels();
    return <IdentityProfile identity={identity} byId={new Map([[identity.id, identity]])} sameInvestigation={[identity]} everywhere={[identity]} folders={folders}
      showInvestigation={false} readOnly={false} screensharing={screensharing} labels={labels} onUpdate={vi.fn(async () => {})} onEdit={vi.fn()} onOpen={vi.fn()} onOpenChart={vi.fn()} />;
  }
  it('isolates names inside sentences (a right-to-left interface keeps "Acme, Inc." in order)', () => {
    const acme = make('acme', 'Acme, Inc.', { type: 'organization' });
    view([acme], { selectRequest: { id: 'acme', request: 1 } });
    // The name, in its own <bdi>, inside each sentence that names it.
    expect([...document.querySelectorAll('bdi')].filter(element => element.textContent === 'Acme, Inc.').map(element => element.parentElement?.textContent)).toEqual([
      'Nobody yet. When you add a person, choose Acme, Inc. under Works at.',
      'Nothing on the timeline, in notes or in IOCs names Acme, Inc. yet.',
    ]);
  });

  it('is read out when shown, and not while screensharing masks every value', async () => {
    const dana = make('dana', 'Dana Okafor', { details: [{ id: 'p', label: 'Phone', value: '+44 7700 900123', private: true }] });
    const { rerender } = render(<ToastProvider><Profile identity={dana} screensharing={false} /></ToastProvider>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show private phone' }));
    expect(screen.getByText('+44 7700 900123')).toHaveAttribute('aria-live', 'polite');
    rerender(<ToastProvider><Profile identity={dana} screensharing /></ToastProvider>);
    expect(screen.queryByText('+44 7700 900123')).toBeNull();
    expect(document.querySelector('[aria-live="polite"]')).toBeNull();
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
      'Type “Personne”: kept as written, as a custom type.',
      'Status “Compromis”: not imported.',
      'Contact “oui”: not imported (use yes or no).',
    ]);
  });

  it('counts a type as in use only on identities the import counts (not trashed ones)', async () => {
    const user = userEvent.setup();
    const vendor = (trashed: boolean) => make(trashed ? 'v1' : 'v2', 'Supplier', { type: 'Vendor', trashed });
    const preview = async (identities: Identity[]) => {
      cleanup();
      render(<ToastProvider><DataImportModal open onClose={vi.fn()} folders={[{ ...folders[0], updatedAt: 1 } as Folder]} timelines={[]} defaultFolderId="case"
        onCreateTimeline={vi.fn()} onImportComplete={vi.fn()} identities={identities} /></ToastProvider>);
      await user.click(screen.getAllByRole('textbox')[0]);
      await user.paste('Name,Type\nAna Silva,Vendor');
      await user.click(screen.getByRole('button', { name: 'Parse & Preview' }));
      return screen.queryAllByRole('listitem').some(item => item.textContent === 'Type “Vendor”: kept as written, as a custom type.');
    };
    expect(await preview([vendor(true)])).toBe(true);
    expect(await preview([vendor(false)])).toBe(false);
  });
});
