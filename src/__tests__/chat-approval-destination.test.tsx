/**
 * C2-2: chat works in the conversation's investigation, which in the All Investigations
 * view is not the one selected in the sidebar (there is none). A write card and the /fetch
 * confirmation name where the change lands and whether it syncs.
 */
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { ChatThread, Folder, Settings, ToolUseBlock } from '../types';
import type { ToolExecutionResult } from '../lib/llm-tool-execution';
import { ChatView } from '../components/Chat/ChatView';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';
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
const notesTitled = (title: string) => db.notes.where('title').equals(title).toArray();
const replies = (props: ReturnType<typeof renderChat>) =>
  props.onAddMessage.mock.calls.map(([, message]) => message).filter(message => message.role === 'assistant').map(message => message.content);

let egress: EgressSpy;
beforeEach(async () => {
  discardAllComposerDrafts();
  vi.clearAllMocks();
  await seedAIWorkspace();
  localStorage.clear();
  localStorage.setItem('caddyai-onboarded', '1');
  egress = installEgressSpy();
  state.folder = undefined;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); egress.restore(); discardAllComposerDrafts(); });

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
    expect(await within(await card()).findByText('Outside any investigation: stays on this device')).toBeInTheDocument();
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
    expect(within(shown).queryByText(/syncs to its members|stays on this device/)).toBeNull();
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
