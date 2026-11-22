import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import type { Folder, Identity, TimelineEvent } from '../types';
import { ToastProvider } from '../contexts/ToastContext';
import { IdentityLinksProvider } from '../components/Identities/IdentityLinksProvider';
import { TimelineEventCard } from '../components/Timeline/TimelineEventCard';
import { TimelineEventForm } from '../components/Timeline/TimelineEventForm';
import { MarkdownPreview } from '../components/Notes/MarkdownPreview';
import { MitreReport } from '../components/Timeline/MitreReport';
import { useMentionAutocomplete } from '../components/Notes/useMentionAutocomplete';
import { renderMarkdown } from '../lib/markdown';
import { buildIdentityIndex, type FolderIndex } from '../lib/identity-match';
import { ignoredHash, foundKey } from '../lib/identity-model';
import type { IdentityChange } from '../components/Identities/identity-labels';

const folders: Folder[] = [{ id: 'case', name: 'Halvorsen BEC', order: 0, createdAt: 1 }];
const make = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });
const tomas = make('tomas', 'Tomas Lindqvist', { aliases: ['T. Lindqvist'], details: [{ id: 'e', label: 'Email', value: 'tomas@halvorsen.example' }] });
const server = make('server', 'FIN-DB01', { type: 'system' });
const secret = make('secret', 'Hidden Person', { clsLevel: 'TLP:RED' });
const identities = [tomas, server, secret];
const event = (extra: Partial<TimelineEvent>): TimelineEvent => ({ id: 'ev', title: 'Payment approved', timestamp: 1, eventType: 'other', source: '', confidence: 'medium',
  linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false, folderId: 'case', timelineId: 't',
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra } as TimelineEvent);

function withLinks(ui: ReactNode, props: Partial<Parameters<typeof IdentityLinksProvider>[0]> = {}) {
  const onOpen = vi.fn();
  const onUpdate = vi.fn<(id: string, change: IdentityChange) => Promise<void>>(async () => {});
  const onCreate = vi.fn(async (partial: Partial<Identity>) => make('new', partial.name ?? '', partial));
  render(
    <ToastProvider>
      <IdentityLinksProvider identities={identities} folders={folders} threatActors={['APT29']} isVisible={identity => identity.id !== secret.id}
        onOpen={onOpen} onUpdate={onUpdate} onCreate={onCreate} {...props}>
        {ui}
      </IdentityLinksProvider>
    </ToastProvider>,
  );
  return { onOpen, onUpdate, onCreate, user: userEvent.setup() };
}
const card = (extra: Partial<TimelineEvent>) => <TimelineEventCard event={event(extra)} onSelect={vi.fn()} onToggleStar={vi.fn()} />;

beforeEach(() => localStorage.clear());
const originalScroll = Element.prototype.scrollIntoView;
afterEach(() => { vi.restoreAllMocks(); Element.prototype.scrollIntoView = originalScroll; });

describe('timeline chips', () => {
  it('links Actor and Assets that name an identity, and opens it', async () => {
    const { onOpen, user } = withLinks(card({ actor: 'tomas lindqvist', assets: ['fin-db01', 'APT29'] }));
    await user.click(screen.getByRole('button', { name: 'tomas lindqvist (Actor), open Tomas Lindqvist in Identities' }));
    expect(onOpen).toHaveBeenCalledWith(tomas, undefined);
    expect(screen.getByRole('button', { name: 'fin-db01 (Asset), open FIN-DB01 in Identities' })).toBeInTheDocument();
    // A threat actor from Settings stays plain text.
    expect(screen.getByText('APT29').closest('button')).toBeNull();
  });

  it('opens the list filtered to text that more than one identity holds, so a person chooses', async () => {
    const other = make('other', 'Tomas Lindqvist', { description: 'A different person' });
    const { onOpen, user } = withLinks(card({ actor: 'Tomas Lindqvist' }), { identities: [tomas, other] });
    await user.click(screen.getByRole('button', { name: 'Tomas Lindqvist (Actor), more than one identity matches' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tomas Lindqvist' }), 'Tomas Lindqvist');
  });

  it('keeps names of identities hidden while screensharing plain, so they are neither linked nor offered', () => {
    withLinks(card({ actor: 'Hidden Person' }));
    expect(screen.getByText('Hidden Person').closest('button')).toBeNull();
  });

  it('adds a name that is not yet an identity as another name of one, from the timeline', async () => {
    const { onUpdate, user } = withLinks(card({ assets: ['Lindqvist, Tomas'] }));
    await user.click(screen.getByRole('button', { name: 'Lindqvist, Tomas (Asset), not yet in Identities' }));
    const dialog = await screen.findByRole('dialog', { name: '“Lindqvist, Tomas”' });
    expect(within(dialog).getByText('Asset on the timeline in Halvorsen BEC')).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole('combobox'), 'tomas');
    await user.click(within(dialog).getByRole('button', { name: 'Add as another name' }));
    const [id, change] = vi.mocked(onUpdate).mock.lastCall ?? [];
    expect(id).toBe('tomas');
    expect(typeof change === 'function' ? change(tomas) : change).toEqual({ aliases: ['T. Lindqvist', 'Lindqvist, Tomas'] });
  });

  it('offers a name that differs by accents as another name first, and adds a new one as a system from Assets', async () => {
    const { onCreate, user } = withLinks(<>{card({ actor: 'Tomás Lindqvist' })}{card({ id: 'ev2', assets: ['FIN-WS-014'] })}</>);
    await user.click(screen.getByRole('button', { name: 'Tomás Lindqvist (Actor), not yet in Identities' }));
    const near = await screen.findByRole('dialog', { name: '“Tomás Lindqvist”' });
    expect(within(near).getByRole('button', { name: 'Add as another name of Tomas Lindqvist' })).toHaveFocus();
    await user.click(within(near).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'FIN-WS-014 (Asset), not yet in Identities' }));
    await user.click(within(await screen.findByRole('dialog', { name: '“FIN-WS-014”' })).getByRole('button', { name: /Add as a new identity/ }));
    const form = await screen.findByRole('dialog', { name: 'Add “FIN-WS-014”' });
    expect(within(form).getByRole('combobox', { name: 'Type' })).toHaveValue('System');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'FIN-WS-014', type: 'system', folderId: 'case' }));
  });

  it('ignores a name on this device: the chip turns plain and only a hash is stored', async () => {
    const { user } = withLinks(card({ actor: 'Unknown Caller' }));
    await user.click(screen.getByRole('button', { name: 'Unknown Caller (Actor), not yet in Identities' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ignore on this device' }));
    expect(screen.getByText('Unknown Caller').closest('button')).toBeNull();
    const stored = localStorage.getItem('threatcaddy-identities-ignored-v2') ?? '';
    expect(JSON.parse(stored)).toEqual([ignoredHash(foundKey('case', 'Unknown Caller'))]);
    expect(stored).not.toContain('Unknown');
  });

  it('offers nothing to add in a remote investigation, but still opens linked identities', () => {
    withLinks(card({ actor: 'Tomas Lindqvist', assets: ['FIN-WS-014'] }), { readOnly: true });
    expect(screen.getByRole('button', { name: /open Tomas Lindqvist/ })).toBeInTheDocument();
    expect(screen.getByText('FIN-WS-014').closest('button')).toBeNull();
  });
});

describe('the event Actor field', () => {
  it('suggests threat actors and the investigation\'s identities in two labelled groups', async () => {
    // jsdom has no layout; restored after the test.
    Element.prototype.scrollIntoView = () => {};
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ attributionActors: ['APT29', 'Lindqvist Gang'] }));
    const onSave = vi.fn();
    const { user } = withLinks(<TimelineEventForm folders={folders} defaultFolderId="case" allTags={[]} onCreateTag={vi.fn()} onSave={onSave} onCancel={vi.fn()} />);
    const actor = screen.getByRole('combobox', { name: 'Actor' });
    await user.type(actor, 'lindq');
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option').map(option => option.textContent)).toEqual(['Lindqvist Gang', 'Tomas Lindqvist']);
    expect(within(within(list).getByRole('group', { name: 'Threat actors' })).getByRole('option')).toHaveTextContent('Lindqvist Gang');
    expect(within(within(list).getByRole('group', { name: 'Identities' })).getByRole('option')).toHaveTextContent('Tomas Lindqvist');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(actor).toHaveAttribute('aria-activedescendant', within(list).getByRole('option', { name: 'Tomas Lindqvist' }).id);
    await user.keyboard('{Enter}');
    expect(actor).toHaveValue('Tomas Lindqvist');
  });
});

describe('@ mentions', () => {
  it('links @Name in a note to the identity, never in code, an existing link or an attribute, and opens it', async () => {
    const content = [
      'Call @Tomas Lindqvist today. `@Tomas Lindqvist` <span title="@Tomas Lindqvist">x</span> mail tomas@T. Lindqvist',
      '', '    indented code @Tomas Lindqvist', '', '~~~', 'tilde fence @Tomas Lindqvist', '~~~', '',
      '```', 'unclosed fence @Tomas Lindqvist',
    ].join('\n');
    const { onOpen, user } = withLinks(<MarkdownPreview content={content} folderId="case" />);
    const links = screen.getAllByRole('link', { name: '@Tomas Lindqvist' });
    expect(links).toHaveLength(1);
    expect(document.body.textContent).not.toContain('data-identity');
    await user.click(links[0]);
    expect(onOpen).toHaveBeenCalledWith(tomas, undefined);
  });

  it('keeps an existing link whole when its text mentions an identity', () => {
    withLinks(<MarkdownPreview content="[ask @Tomas Lindqvist](https://example.test/ask)" folderId="case" />);
    const link = screen.getByRole('link', { name: 'ask @Tomas Lindqvist' });
    expect(link).toHaveAttribute('href', 'https://example.test/ask');
    expect(link.querySelector('a')).toBeNull();
  });

  it('links nothing in a note outside an investigation', () => {
    withLinks(<MarkdownPreview content="Call @Tomas Lindqvist" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('escapes the mention text, drops an ID that is not safe, and still sanitises the note', () => {
    const sons = make('ok_id', 'Smith & "Sons"');
    const badId = make('bad"id onclick=alert(1)', 'Bad Id');
    const folder = buildIdentityIndex([sons, badId]).folders.get('case');
    const html = renderMarkdown('@Smith & "Sons" and @Bad Id <img src=x onerror=alert(1)>', undefined, { identities: folder });
    const links = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a')];
    expect(links.map(link => [link.textContent, link.getAttribute('data-identity-id'), link.getAttribute('href'), link.className]))
      .toEqual([['@Smith & "Sons"', 'ok_id', '#', 'tclink'], ['@Bad Id', null, '#', 'tclink']]);
    expect(html).not.toMatch(/onerror=|onclick/);
  });
});

function MentionHarness({ folder }: { folder: FolderIndex | undefined }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState('');
  const mention = useMentionAutocomplete({ textareaRef: ref, content, folder, onContentChange: setContent });
  return (
    <>
      <textarea ref={ref} aria-label="Note" value={content} onKeyDown={event => mention.handleKeyDown(event)}
        onChange={event => { setContent(event.target.value); mention.detect(event.target.value, event.target.selectionStart); }} />
      {mention.open && <ul aria-label="Mentions">{mention.items.map(item => <li key={item.id}>{item.title}</li>)}</ul>}
    </>
  );
}

describe('the note editor\'s @ suggestions', () => {
  const folder = buildIdentityIndex([tomas, server, make('ana', 'Ana Tomasz')]).folders.get('case');
  it('suggests identities by name or other name, prefix matches first, and inserts @Name', async () => {
    const user = userEvent.setup();
    render(<MentionHarness folder={folder} />);
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Spoke to @toma');
    expect(within(screen.getByRole('list', { name: 'Mentions' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Tomas Lindqvist', 'Ana Tomasz']);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Spoke to @Tomas Lindqvist ');
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'and @t. lind');
    expect(screen.getByRole('list', { name: 'Mentions' })).toHaveTextContent('Tomas Lindqvist');
    // Moving the cursor closes the menu rather than insert at a stale place.
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('list', { name: 'Mentions' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Spoke to @Tomas Lindqvist and @t. lin\nd');
  });

  it('inserts a handle stored with its @ once', async () => {
    const user = userEvent.setup();
    render(<MentionHarness folder={buildIdentityIndex([make('ghost', '@ghost_ledger', { type: 'account' })]).folders.get('case')} />);
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'paid @ghost');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('paid @ghost_ledger ');
  });

  it('offers a name two identities share once', async () => {
    const user = userEvent.setup();
    render(<MentionHarness folder={buildIdentityIndex([tomas, make('twin', 'Tomas Lindqvist')]).folders.get('case')} />);
    await user.type(screen.getByRole('textbox', { name: 'Note' }), '@tomas');
    expect(within(screen.getByRole('list', { name: 'Mentions' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('suggests nothing for an email address or inside code', async () => {
    const user = userEvent.setup();
    render(<MentionHarness folder={folder} />);
    const note = screen.getByRole('textbox', { name: 'Note' });
    await user.type(note, 'mail dana@tom');
    expect(screen.queryByRole('list', { name: 'Mentions' })).not.toBeInTheDocument();
    await user.clear(note);
    await user.type(note, 'run `@tom');
    expect(screen.queryByRole('list', { name: 'Mentions' })).not.toBeInTheDocument();
  });
});

describe('reports', () => {
  it('groups the MITRE report by the identity an actor names, other names included, and opens it', async () => {
    const twin = make('twin', 'Dana Okafor');
    const dana = make('dana', 'Dana Okafor', { description: 'Accounts payable' });
    const { onOpen, user } = withLinks(<MitreReport events={[
      event({ id: 'a', actor: 'Tomas Lindqvist', mitreAttackIds: ['T1566'] }),
      event({ id: 'b', actor: 'T. Lindqvist', mitreAttackIds: ['T1078'] }),
      event({ id: 'c', actor: 'Tomás Lindqvist', mitreAttackIds: ['T1110'] }),
      event({ id: 'd', actor: 'Dana Okafor', mitreAttackIds: ['T1566'] }),
    ]} />, { identities: [tomas, twin, dana] });
    // Tomas and T. Lindqvist are one identity; the accented spelling is not confirmed, and the
    // shared name "Dana Okafor" names two identities, so both stay as written.
    const tomasRow = screen.getByRole('button', { name: 'Tomas Lindqvist' }).parentElement as HTMLElement;
    expect(within(tomasRow).getByText(/2 techniques/)).toBeInTheDocument();
    expect(screen.getByText('Tomás Lindqvist').closest('button')).toBeNull();
    expect(screen.getByText('Dana Okafor').closest('button')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tomas Lindqvist' }));
    expect(onOpen).toHaveBeenCalledWith(tomas);
  });
});

