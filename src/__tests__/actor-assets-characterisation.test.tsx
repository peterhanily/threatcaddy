import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttributionComboInput } from '../components/Analysis/AttributionComboInput';
import { TimelineEventForm } from '../components/Timeline/TimelineEventForm';
import { TimelineEventCard } from '../components/Timeline/TimelineEventCard';
import { MitreReport } from '../components/Timeline/MitreReport';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import { ToastProvider } from '../contexts/ToastContext';
import type { TimelineEvent } from '../types';

/**
 * Characterisation of how Actor and Assets behave before Identities. Later phases
 * change some of this on purpose; update these expectations in the same change.
 */
const event = (over: Partial<TimelineEvent>): TimelineEvent => ({
  id: 'ev-1', title: 'Synthetic event', timestamp: Date.UTC(2026, 10, 14, 10, 5), eventType: 'impact', confidence: 'medium',
  source: '', assets: [], tags: [], starred: false, linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [],
  timelineId: 'tl-1', trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...over,
}) as TimelineEvent;

const originalScroll = Element.prototype.scrollIntoView;
afterEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = originalScroll; });

function eventForm(): HTMLFormElement {
  const form = screen.getByPlaceholderText('Event title...').closest('form');
  if (!form) throw new Error('The event form is not rendered');
  return form;
}
function actorRow(name: string): HTMLElement {
  const row = screen.getByText(name).parentElement?.parentElement;
  if (!row) throw new Error(`No report row for ${name}`);
  return row;
}

describe('AttributionComboInput today', () => {
  it('suggests attribution actors by case-insensitive substring and accepts free text', () => {
    Element.prototype.scrollIntoView = () => {}; // jsdom has no layout; restored in afterEach
    function Harness() {
      const [value, setValue] = useState('');
      return <AttributionComboInput value={value} onChange={setValue} actors={['APT29', 'Lazarus Group', 'ghost_ledger']} placeholder="Actor" />;
    }
    render(<Harness />);
    const input = screen.getByPlaceholderText('Actor');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ARUS' } }); // mid-name and upper case
    // Phase 4 made it a combobox: the suggestions are listbox options (it was plain <li> items before).
    expect(input).toHaveAttribute('role', 'combobox');
    expect(screen.getByRole('option', { name: 'Lazarus Group' })).toBeInTheDocument();
    expect(screen.queryByText('APT29')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Lazarus Group');
    fireEvent.change(input, { target: { value: 'An actor nobody listed' } });
    expect(input).toHaveValue('An actor nobody listed');
  });
});

describe('TimelineEventForm today', () => {
  it('saves Actor as trimmed text and Assets as a comma-split, trimmed list', () => {
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ attributionActors: ['ghost_ledger'] }));
    const onSave = vi.fn();
    render(<ToastProvider><TimelineEventForm folders={[]} allTags={[]} onCreateTag={vi.fn()} onSave={onSave} onCancel={vi.fn()} /></ToastProvider>);
    fireEvent.change(screen.getByPlaceholderText('Event title...'), { target: { value: 'Payments approved' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. APT29, Lazarus Group...'), { target: { value: '  Tomas Lindqvist  ' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. DC01, WEB-SRV-02, 10.0.0.5...'), { target: { value: ' DC01, , 10.20.14.88 ,FIN-WS-014 ' } });
    fireEvent.submit(eventForm());
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: 'Payments approved', actor: 'Tomas Lindqvist', assets: ['DC01', '10.20.14.88', 'FIN-WS-014'] });
  });

  it('saves an empty Actor as undefined and keeps an edited event\'s assets as text', () => {
    const onSave = vi.fn();
    render(<ToastProvider><TimelineEventForm event={event({ actor: 'svc_backup', assets: ['DC01', '10.20.14.88'] })} folders={[]} allTags={[]} onCreateTag={vi.fn()} onSave={onSave} onCancel={vi.fn()} /></ToastProvider>);
    expect(screen.getByPlaceholderText('e.g. DC01, WEB-SRV-02, 10.0.0.5...')).toHaveValue('DC01, 10.20.14.88');
    fireEvent.change(screen.getByPlaceholderText('e.g. APT29, Lazarus Group...'), { target: { value: '   ' } });
    fireEvent.submit(eventForm());
    expect(onSave.mock.calls[0][0].actor).toBeUndefined();
    expect(onSave.mock.calls[0][0].assets).toEqual(['DC01', '10.20.14.88']);
  });
});

describe('TimelineEventCard without identity links', () => {
  // Phase 4: the card shows Actor and the first three Assets as chips (it showed only a count of
  // assets before). Without the identity link layer they are plain text; identity-links.test.tsx
  // covers linked and dashed chips.
  it('shows the actor and the first three assets as plain chips, and counts the rest', () => {
    render(<TimelineEventCard event={event({ actor: 'ghost_ledger', assets: ['Dana Okafor', 'FIN-WS-014', 'DC01', '10.20.14.88', 'WS-0231'] })} onSelect={vi.fn()} onToggleStar={vi.fn()} />);
    expect(screen.getByText('ghost_ledger').closest('button')).toBeNull();
    for (const asset of ['Dana Okafor', 'FIN-WS-014', 'DC01']) expect(screen.getByText(asset).closest('button')).toBeNull();
    expect(screen.queryByText('10.20.14.88')).toBeNull();
    expect(screen.getByText('+2')).toHaveAttribute('title', '10.20.14.88, WS-0231');
  });
});

describe('MitreReport today', () => {
  it('groups techniques by the exact actor text, so spellings count separately', () => {
    render(<MitreReport events={[
      event({ id: 'a', actor: 'Tomas Lindqvist', mitreAttackIds: ['T1566'] }),
      event({ id: 'b', actor: 'Tomás Lindqvist', mitreAttackIds: ['T1078'] }),
      event({ id: 'c', actor: 'Tomas Lindqvist', mitreAttackIds: ['T1078'] }),
    ]} />);
    const plain = actorRow('Tomas Lindqvist');
    const accented = actorRow('Tomás Lindqvist');
    expect(within(plain).getByText(/2 techniques/i)).toBeInTheDocument();
    expect(within(accented).getByText(/1 technique\b/i)).toBeInTheDocument();
  });
});
