/**
 * C2-2: chat works in the conversation's investigation, which in the All Investigations
 * view is not the one selected in the sidebar (there is none). A write card and the /fetch
 * confirmation name where the change lands and whether it syncs.
 */
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { db } from '../db';
import type { ChatThread, Folder, Settings, ToolUseBlock } from '../types';
import type { ToolExecutionResult } from '../lib/llm-tool-execution';
import { ChatView } from '../components/Chat/ChatView';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';
import { SYNC_WORKSPACE_KEY } from '../lib/sync-capture-policy';
import { seedAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy, type EgressSpy } from './helpers/egress-spy';

// Each card waits on Dexie reads (binding, reach); allow for a loaded full-suite run.
configure({ asyncUtilTimeout: 5000 });

type ToolHandler = (toolUse: ToolUseBlock, signal: AbortSignal) => Promise<ToolExecutionResult>;
const state = vi.hoisted(() => ({
  folder: undefined as Folder | undefined,
  input: { onSend: async () => {} } as { onSend: (text: string) => Promise<void> },
  send: vi.fn(),
}));
vi.mock('../hooks/useLLM', () => ({ useLLM: () => ({ extensionAvailable: true, streamingContent: '', isStreaming: false, error: null,
  toolActivity: [], sendAgentRequest: state.send, abort: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: '', user: null }) }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ selectedChatThreadId: 'thread', setSelectedChatThreadId: vi.fn() }) }));
vi.mock('../contexts/InvestigationContext', () => ({ useInvestigation: () => ({ selectedFolderId: state.folder?.id, selectedFolder: state.folder }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/useChatLoops', () => ({ useChatLoops: () => ({ loops: [], startLoop: vi.fn(), stopAllForThread: vi.fn() }) }));
vi.mock('../hooks/useCustomSlashCommands', () => ({ useCustomSlashCommands: () => ({ commands: [] }),
  interpolateTemplate: (template: string) => template }));
vi.mock('../components/Chat/ChatInput', () => ({ ChatInput: (props: typeof state.input) => { state.input = props; return null; } }));
vi.mock('../components/Chat/ChatMessage', () => ({ ChatMessageBubble: () => null }));
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ components }: { components?: { Footer?: ComponentType } }) => {
  const Footer = components?.Footer;
  return Footer ? <Footer /> : null;
} }));

const makeThread = (folderId?: string): ChatThread => ({ id: 'thread', title: 'Chat thread', folderId, model: 'synthetic-model', provider: 'anthropic',
  messages: [{ id: 'm1', role: 'user', content: 'Earlier question', createdAt: 1 }], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const settings = { llmAnthropicApiKey: 'synthetic-unit-test-only', llmRoutingMode: 'auto' } as Settings;
const call = (name: string, input: Record<string, unknown>): ToolUseBlock => ({ type: 'tool_use', id: `call-${name}`, name, input });

function renderChat(folderId?: string) {
  const props = { settings, onCreateThread: vi.fn(), onUpdateThread: vi.fn(), onAddMessage: vi.fn().mockResolvedValue(undefined), onTrashThread: vi.fn() };
  render(<ChatView threads={[makeThread(folderId)]} {...props} />);
  return props;
}
async function sendAndGetHandler(): Promise<ToolHandler> {
  await act(async () => { await state.input.onSend('Look into it'); });
  return state.send.mock.calls[state.send.mock.calls.length - 1][1] as ToolHandler;
}
function start(handler: ToolHandler, toolUse: ToolUseBlock) {
  let pending!: Promise<ToolExecutionResult>;
  act(() => { pending = handler(toolUse, new AbortController().signal); });
  return pending;
}
const card = () => screen.findByRole('group', { name: /\?$/ });
async function approve() {
  const button = screen.getByRole('button', { name: /approve/i });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
/** Waits until the shown card has loaded its investigation names, so that an absence check
 * proves something. The card starts its folder read with its Approve delay; only microtasks
 * follow that read, and a macrotask runs after them. */
async function cardLoaded() {
  await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeEnabled());
  await act(async () => {
    await Promise.allSettled(folderGets.mock.results.map(result => result.value));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
const notesTitled = (title: string) => db.notes.where('title').equals(title).toArray();
const replies = (props: ReturnType<typeof renderChat>) =>
  props.onAddMessage.mock.calls.map(([, message]) => message).filter(message => message.role === 'assistant').map(message => message.content);

let egress: EgressSpy;
let folderGets: MockInstance<(id: string) => Promise<Folder | undefined>>;
beforeEach(async () => {
  discardAllComposerDrafts();
  vi.clearAllMocks();
  await seedAIWorkspace();
  localStorage.clear();
  localStorage.setItem('caddyai-onboarded', '1');
  egress = installEgressSpy();
  folderGets = vi.spyOn(db.folders, 'get') as unknown as typeof folderGets;
  state.folder = undefined;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); egress.restore(); folderGets.mockRestore(); discardAllComposerDrafts(); });

describe('C2-2 a write card names the investigation that changes', () => {
  it('in the global view, a thread filed in a synced investigation names it and says it syncs', async () => {
    renderChat('S');
    const handler = await sendAndGetHandler();
    const pending = start(handler, call('create_note', { title: 'Global view note', content: 'x' }));
    const shown = await card();
    expect(within(shown).getByText('Approve a change to this investigation?')).toBeInTheDocument();
    expect(await within(shown).findByText('Shared case: syncs to its members')).toBeInTheDocument();
    await approve();
    expect((await pending).isError).toBe(false);
    expect(await notesTitled('Global view note')).toEqual([expect.objectContaining({ folderId: 'S' })]);
  });

  it('names a local-only investigation and says the change stays on this device', async () => {
    state.folder = { id: 'S', name: 'Shared case', order: 0, createdAt: 1 };
    renderChat('L2');
    const handler = await sendAndGetHandler();
    void start(handler, call('update_note', { id: 'L2-note', content: 'Changed' }));
    expect(await within(await card()).findByText('Hunting case: stays on this device')).toBeInTheDocument();
  });

  it('an unfiled thread says its change stays outside any investigation', async () => {
    renderChat();
    const handler = await sendAndGetHandler();
    const pending = start(handler, call('create_note', { title: 'Unfiled note', content: 'x' }));
    const shown = await card();
    // The title does not claim an investigation the change is outside of.
    expect(within(shown).getByText('Approve a change outside any investigation?')).toBeInTheDocument();
    expect(within(shown).queryByText('Approve a change to this investigation?')).toBeNull();
    expect(await within(shown).findByText('Outside any investigation: stays on this device')).toBeInTheDocument();
    await approve();
    expect((await pending).isError).toBe(false);
    expect(await notesTitled('Unfiled note')).toEqual([expect.objectContaining({ folderId: undefined })]);
  });

  it('an agent change does not claim to sync: deployments stay on this device', async () => {
    renderChat('S');
    const handler = await sendAndGetHandler();
    void start(handler, call('deploy_agent', { profileId: 'ap-threat-hunter' }));
    const shown = await card();
    expect(within(shown).getByText('Change the AI agents?')).toBeInTheDocument();
    expect(within(shown).getByText('Changes the AI agents working in this investigation.')).toBeInTheDocument();
    await cardLoaded();
    expect(within(shown).queryByText(/syncs to its members|stays on this device/)).toBeNull();
  });

  it('a change to another investigation names only that one, not the conversation\'s', async () => {
    renderChat('S');
    const handler = await sendAndGetHandler();
    void start(handler, call('update_note', { id: 'P-note', content: 'Changed' }));
    const shown = await card();
    expect(within(shown).getByText('Change another investigation?')).toBeInTheDocument();
    // The target line loads together with the conversation's name.
    expect(await within(shown).findByText('Private case: syncs to its members')).toBeInTheDocument();
    expect(within(shown).queryByText(/^Shared case:/)).toBeNull();
  });

  it('an enrichment card says where the value goes, not that the conversation syncs', async () => {
    renderChat('S');
    const handler = await sendAndGetHandler();
    void start(handler, call('enrich_ioc', { iocId: 'S-ioc' }));
    const shown = await card();
    // The looked-up value loads together with the conversation's name.
    expect(await within(shown).findByText('Nothing is sent: no enabled lookup applies to canary-s.example.')).toBeInTheDocument();
    expect(within(shown).queryByText(/^Shared case:/)).toBeNull();
  });
});

// The card's title and its line agree: a lookup with no enabled vendor sends nothing.
describe('C4-3 an enrichment card that sends nothing does not ask to send data', () => {
  it('titles the card as an enrichment and says nothing is sent, on the card and in the announcement', async () => {
    renderChat('S');
    const handler = await sendAndGetHandler();
    void start(handler, call('enrich_ioc', { iocId: 'S-ioc' }));
    const shown = await card();
    expect(within(shown).getByText('Approve an IOC enrichment?')).toBeInTheDocument();
    expect(within(shown).queryByText('Send data outside ThreatCaddy?')).toBeNull();
    expect(await within(shown).findByText('Nothing is sent: no enabled lookup applies to canary-s.example.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Approve an IOC enrichment? enrich_ioc');
  });

  it('keeps asking to send data when an enabled lookup applies', async () => {
    await db.installedIntegrations.add({ id: 'vt', templateId: 'vt-domain-lookup', name: 'VT', enabled: true, config: {}, scopeType: 'all',
      scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 });
    renderChat('S');
    const handler = await sendAndGetHandler();
    void start(handler, call('enrich_ioc', { iocId: 'S-ioc' }));
    const shown = await card();
    expect(within(shown).getByText('Send data outside ThreatCaddy?')).toBeInTheDocument();
    expect(await within(shown).findByText(/^Sends canary-s\.example to: .*www\.virustotal\.com/)).toBeInTheDocument();
    expect(within(shown).queryByText(/Nothing is sent/)).toBeNull();
  });
});

// With no team server bound, nothing syncs yet: the lines say when it would.
describe('C4-2 without a team server, cards and /fetch do not claim that anything syncs', () => {
  beforeEach(async () => { await db.table('_syncMeta').delete(SYNC_WORKSPACE_KEY); });
  const LATER = /syncs to its members|which syncs to the members of "[^"]+"\.$/;

  it('a write card says the conversation\'s investigation stays on this device until a team server is connected', async () => {
    renderChat('S');
    const handler = await sendAndGetHandler();
    void start(handler, call('create_note', { title: 'Unbound note', content: 'x' }));
    const shown = await card();
    expect(await within(shown).findByText('Shared case: stays on this device until a team server is connected')).toBeInTheDocument();
    expect(within(shown).queryByText(LATER)).toBeNull();
  });

  it('a change to another investigation says the same of that investigation', async () => {
    renderChat('S');
    const handler = await sendAndGetHandler();
    void start(handler, call('update_note', { id: 'P-note', content: 'Changed' }));
    const shown = await card();
    expect(await within(shown).findByText('Private case: stays on this device until a team server is connected')).toBeInTheDocument();
    expect(within(shown).queryByText(LATER)).toBeNull();
  });

  it('a cross-read card says the conversation syncs once a team server is connected', async () => {
    renderChat('S');
    const handler = await sendAndGetHandler();
    void start(handler, call('search_across_investigations', { query: 'CANARY' }));
    const shown = await card();
    expect(await within(shown).findByText('What it reads becomes part of this conversation, which syncs to the members of "Shared case" '
      + 'once a team server is connected.')).toBeInTheDocument();
    expect(within(shown).queryByText(LATER)).toBeNull();
  });

  it('a local-only investigation still stays on this device', async () => {
    renderChat('L2');
    const handler = await sendAndGetHandler();
    void start(handler, call('update_note', { id: 'L2-note', content: 'Changed' }));
    expect(await within(await card()).findByText('Hunting case: stays on this device')).toBeInTheDocument();
  });

  it('/fetch says its note stays on this device until a team server is connected', async () => {
    const props = renderChat('S');
    await act(async () => { await state.input.onSend('/fetch https://www.cisa.gov/advisory'); });
    expect(replies(props)).toEqual(['Created note **Fixture page** from https://www.cisa.gov/advisory\n\n'
      + 'Shared case: stays on this device until a team server is connected']);
  });
});

describe('C2-2 /fetch says where its note goes', () => {
  it('names the thread\'s synced investigation from the global view', async () => {
    const props = renderChat('S');
    await act(async () => { await state.input.onSend('/fetch https://www.cisa.gov/advisory'); });
    expect(await notesTitled('Fixture page')).toEqual([expect.objectContaining({ folderId: 'S' })]);
    expect(replies(props)).toEqual(['Created note **Fixture page** from https://www.cisa.gov/advisory\n\nShared case: syncs to its members']);
  });

  it('says a local-only investigation\'s note stays on this device', async () => {
    state.folder = { id: 'S', name: 'Shared case', order: 0, createdAt: 1 };
    const props = renderChat('L2');
    await act(async () => { await state.input.onSend('/fetch https://www.cisa.gov/advisory'); });
    expect(await notesTitled('Fixture page')).toEqual([expect.objectContaining({ folderId: 'L2' })]);
    expect(replies(props)).toEqual(['Created note **Fixture page** from https://www.cisa.gov/advisory\n\nHunting case: stays on this device']);
  });

  it('says an unfiled thread\'s note stays outside any investigation', async () => {
    const props = renderChat();
    await act(async () => { await state.input.onSend('/fetch https://www.cisa.gov/advisory'); });
    expect(await notesTitled('Fixture page')).toEqual([expect.objectContaining({ folderId: undefined })]);
    expect(replies(props)).toEqual(['Created note **Fixture page** from https://www.cisa.gov/advisory\n\nOutside any investigation: stays on this device']);
  });
});
