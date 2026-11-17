/**
 * M-LLM-ROUTING-HIDDEN in chat: prompts go where Settings → AI says they go.
 * Real useLLM and route resolver; recorded transports and extension.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ChatMessage, type ChatThread, type Folder, type Settings } from '../types';
import { ChatView } from '../components/Chat/ChatView';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';
import { sendDirectToLocal, sendViaServer, type LLMRouteCallbacks } from '../lib/llm-router';
import { generateChatTitle, summarizeConversation } from '../lib/chat-utils';
import { fetchViaExtensionBridge } from '../lib/llm-tools';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import type { ChatLoopInfo } from '../lib/chat-loop';
import i18n from '../i18n';
import enSettings from '../../public/locales/en/settings.json';
import deChat from '../../public/locales/de/chat.json';

const state = vi.hoisted(() => ({
  signedIn: false,
  folder: { id: 'case', name: 'Case', order: 0, createdAt: 1 } as Folder,
  input: { onSend: async () => {} } as { onSend: (text: string) => Promise<void>; route?: string },
  startLoop: vi.fn<(opts: { transport: () => Promise<unknown> }) => { id: string; intervalMs: number; formattedInterval: string }>(
    () => ({ id: 'loop', intervalMs: 30_000, formattedInterval: '30s' })),
  stopAllForThread: vi.fn<(threadId: string) => number>(() => 1),
  loops: [] as ChatLoopInfo[],
}));
const { answer } = vi.hoisted(() => ({
  answer: (_request: unknown, callbacks: LLMRouteCallbacks) => { callbacks.onChunk('Answer.'); callbacks.onDone('end_turn', [{ type: 'text', text: 'Answer.' }]); return 'request'; },
}));
vi.mock('../lib/llm-router', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/llm-router')>(), sendViaServer: vi.fn(answer), sendDirectToLocal: vi.fn(answer),
}));
vi.mock('../lib/chat-utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/chat-utils')>(), generateChatTitle: vi.fn().mockResolvedValue(null), summarizeConversation: vi.fn().mockResolvedValue(null),
}));
vi.mock('../lib/llm-tools', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/llm-tools')>(), buildSystemPrompt: async () => 'Synthetic context',
  fetchViaExtensionBridge: vi.fn().mockResolvedValue({ success: true, title: 'Synthetic page', content: 'Synthetic content' }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => (state.signedIn
  ? { serverUrl: 'https://team.example', user: { id: 'user-1', email: 'analyst@example.test', displayName: 'Analyst' } }
  : { serverUrl: null, user: null }) }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ selectedChatThreadId: 'thread', setSelectedChatThreadId: vi.fn() }) }));
vi.mock('../contexts/InvestigationContext', () => ({ useInvestigation: () => ({ selectedFolderId: state.folder.id, selectedFolder: state.folder }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/useChatLoops', () => ({ useChatLoops: () => ({ loops: state.loops, startLoop: state.startLoop, stopAllForThread: state.stopAllForThread }) }));
vi.mock('../hooks/useCustomSlashCommands', () => ({ useCustomSlashCommands: () => ({ commands: [] }), interpolateTemplate: (template: string) => template }));
vi.mock('../components/Chat/ChatInput', () => ({ ChatInput: (props: typeof state.input) => { state.input = props; return null; } }));
vi.mock('../components/Chat/ChatMessage', () => ({ ChatMessageBubble: () => null }));
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
vi.mock('react-virtuoso', () => ({ Virtuoso: () => null }));

const signIn = () => {
  state.signedIn = true;
  localStorage.setItem(workspaceStorageKey('threatcaddy-auth'), JSON.stringify({
    serverUrl: 'https://team.example', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
    user: { id: 'user-1', email: 'analyst@example.test', displayName: 'Analyst' },
  }));
};

// Extension double: records every request to the extension and answers it at once.
let extensionRequests: unknown[] = [];
function installExtensionDouble() {
  vi.spyOn(window, 'postMessage').mockImplementation(((message: { type?: string; requestId?: string }) => {
    if (message?.type === 'TC_LLM_REQUEST') {
      extensionRequests.push(message);
      setTimeout(() => {
        window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'TC_LLM_CHUNK', requestId: message.requestId, content: 'Answer.' } }));
        window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'TC_LLM_DONE', requestId: message.requestId, stopReason: 'end_turn', contentBlocks: [{ type: 'text', text: 'Answer.' }] } }));
      }, 0);
    } else if (message?.type?.startsWith('TC_LLM_')) {
      // useLLM forwards server and local transport events to itself.
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: message })), 0);
    }
  }) as typeof window.postMessage);
}
const announceExtension = () => act(() => { window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'TC_EXTENSION_READY', protocolVersion: 2, capabilities: [] } })); });

const message = (id: string, role: 'user' | 'assistant'): ChatMessage => ({ id, role, content: `Earlier ${role} message ${id}`, createdAt: 1 });
const makeThread = (provider: ChatThread['provider'], messages: ChatMessage[] = []): ChatThread => ({ id: 'thread', title: 'Synthetic chat', folderId: 'case',
  model: provider === 'local' ? 'llama3' : 'synthetic-model', provider, messages, tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const onAddMessage = vi.fn().mockResolvedValue(undefined);
const chat = (settings: Partial<Settings>, thread = makeThread('anthropic')) => <ChatView threads={[thread]}
  settings={{ ...DEFAULT_SETTINGS, ...settings }} onCreateThread={vi.fn()} onUpdateThread={vi.fn()} onAddMessage={onAddMessage}
  onTrashThread={vi.fn()} onOpenSettings={vi.fn()} />;
const renderChat = (settings: Partial<Settings>, thread = makeThread('anthropic')) => render(chat(settings, thread));

beforeEach(() => {
  discardAllComposerDrafts();
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('caddyai-onboarded', '1');
  state.signedIn = false;
  state.loops = [];
  extensionRequests = [];
  Element.prototype.scrollIntoView = vi.fn();
  installExtensionDouble();
});
afterEach(() => { cleanup(); discardAllComposerDrafts(); vi.restoreAllMocks(); });

describe('chat routes where Settings says', () => {
  it('explicit Browser Extension, no extension, signed in: shows why with a Settings link and sends nothing', async () => {
    signIn();
    renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'extension', serverUrl: 'https://team.example' });
    await act(async () => { await state.input.onSend('What happened?'); });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(enSettings['ai.dataFlow.errorNoExtension']);
    expect(within(alert).getByRole('button', { name: 'Settings → AI/LLM' })).toBeInTheDocument();
    expect(sendViaServer).not.toHaveBeenCalled();
    expect(sendDirectToLocal).not.toHaveBeenCalled();
    expect(extensionRequests).toEqual([]);
    expect(onAddMessage).not.toHaveBeenCalled();
  });

  it('signed in, in a new workspace whose settings have no server URL: Auto chat goes through the team server', async () => {
    signIn();
    renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'auto' });
    await act(async () => { await state.input.onSend('What happened?'); });
    expect(sendViaServer).toHaveBeenCalledOnce();
    expect(extensionRequests).toEqual([]);
  });

  it('Auto while signed in: a local model with an endpoint is called directly with its own key', async () => {
    signIn();
    renderChat({ llmRoutingMode: 'auto', serverUrl: 'https://team.example', llmLocalEndpoint: 'http://localhost:11434/v1', llmLocalModelName: 'llama3',
      llmLocalApiKey: 'synthetic-local-key' }, makeThread('local'));
    expect(state.input.route).toBe('local-direct');
    await act(async () => { await state.input.onSend('What happened?'); });
    expect(sendDirectToLocal).toHaveBeenCalledOnce();
    expect(vi.mocked(sendDirectToLocal).mock.calls[0][0]).toMatchObject({ apiKey: 'synthetic-local-key', endpoint: 'http://localhost:11434/v1' });
    expect(sendViaServer).not.toHaveBeenCalled();
    expect(extensionRequests).toEqual([]);
  });

  it('a local model with no key of its own is called with no Authorization header', async () => {
    const actual = await vi.importActual<typeof import('../lib/llm-router')>('../lib/llm-router');
    vi.mocked(sendDirectToLocal).mockImplementationOnce(actual.sendDirectToLocal);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"Answer."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
    renderChat({ llmRoutingMode: 'auto', llmLocalEndpoint: 'http://localhost:11434/v1', llmLocalModelName: 'llama3' }, makeThread('local'));
    await act(async () => { await state.input.onSend('What happened?'); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
  });

  it('/fetch is not a model request: explicit Team Server routing while signed out still fetches the page', async () => {
    renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'server' });
    announceExtension();
    await act(async () => { await state.input.onSend('/fetch https://example.test/report'); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchViaExtensionBridge).toHaveBeenCalledExactlyOnceWith('https://example.test/report');
    expect(sendViaServer).not.toHaveBeenCalled();
    expect(extensionRequests).toEqual([]);
  });

  it('explicit Team Server routing while signed out: a prompt is still refused with the reason', async () => {
    renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'server' });
    announceExtension();
    expect(state.input.route).toBe('unavailable');
    await act(async () => { await state.input.onSend('Fetch https://example.test/report and summarise it'); });
    expect(screen.getByRole('alert')).toHaveTextContent(enSettings['ai.dataFlow.errorNoServer']);
    expect(sendViaServer).not.toHaveBeenCalled();
    expect(extensionRequests).toEqual([]);
    expect(onAddMessage).not.toHaveBeenCalled();
  });

  // The title helper runs after a first exchange; the summary helper once a thread outgrows the context limit.
  // Both can only use the extension, which would send the text straight to the provider.
  const helpers = [
    ['title', generateChatTitle, [] as ChatMessage[]],
    ['summary', summarizeConversation, [message('m1', 'user'), message('m2', 'assistant'), message('m3', 'user')]],
  ] as const;

  it.each(helpers)('through the team server, the chat %s does not go to the provider through the extension', async (_name, helper, earlier) => {
    signIn();
    renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'auto', serverUrl: 'https://team.example', llmMaxContextMessages: 2 },
      makeThread('anthropic', [...earlier]));
    announceExtension();
    await act(async () => { await state.input.onSend('What happened?'); });
    await waitFor(() => expect(onAddMessage).toHaveBeenCalledWith('thread', expect.objectContaining({ role: 'assistant', content: 'Answer.' })));
    expect(sendViaServer).toHaveBeenCalledOnce();
    expect(helper).not.toHaveBeenCalled();
    expect(extensionRequests).toEqual([]);
  });

  it.each(helpers)('through the extension, the chat %s still runs', async (_name, helper, earlier) => {
    renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'auto', serverUrl: 'https://team.example', llmMaxContextMessages: 2 },
      makeThread('anthropic', [...earlier]));
    announceExtension();
    await act(async () => { await state.input.onSend('What happened?'); });
    await waitFor(() => expect(helper).toHaveBeenCalledOnce());
    expect(extensionRequests).toHaveLength(1);
    expect(sendViaServer).not.toHaveBeenCalled();
  });
  it('/fetch calls no model, so it needs no API key: with the extension and no key it still fetches the page', async () => {
    renderChat({ llmRoutingMode: 'auto' });
    announceExtension();
    await act(async () => { await state.input.onSend('/fetch https://example.test/report'); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchViaExtensionBridge).toHaveBeenCalledExactlyOnceWith('https://example.test/report');
    expect(extensionRequests).toEqual([]);
  });

  it('/stoploop calls no model, so it stops the schedules while no AI route is available', async () => {
    renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'server' });
    announceExtension();
    expect(state.input.route).toBe('unavailable');
    await act(async () => { await state.input.onSend('/stoploop'); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(state.stopAllForThread).toHaveBeenCalledExactlyOnceWith('thread');
  });

  it('/stoploop stops the schedules in a thread over its token budget', async () => {
    const spent: ChatMessage = { ...message('m1', 'assistant'), tokenCount: { input: 900, output: 200 } };
    renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'auto', llmTokenBudget: 1000 }, makeThread('anthropic', [spent]));
    announceExtension();
    await act(async () => { await state.input.onSend('/stoploop'); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(state.stopAllForThread).toHaveBeenCalledExactlyOnceWith('thread');
  });

  it('/fetch calls no model, so it saves the page in a thread over its token budget', async () => {
    const spent: ChatMessage = { ...message('m1', 'assistant'), tokenCount: { input: 900, output: 200 } };
    renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'auto', llmTokenBudget: 1000 }, makeThread('anthropic', [spent]));
    announceExtension();
    await act(async () => { await state.input.onSend('/fetch https://example.test/report'); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchViaExtensionBridge).toHaveBeenCalledExactlyOnceWith('https://example.test/report');
    expect(extensionRequests).toEqual([]);
  });

  it('a loop retrying after an error says so in the analyst’s language, with the reason on hover', async () => {
    state.loops = [{ id: 'loop', threadId: 'thread', prompt: 'Check the feed', intervalMs: 30_000, status: 'running', runCount: 0, error: 'Synthetic reason' }];
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'chat', deChat, true, true);
    await i18n.changeLanguage('de');
    try {
      renderChat({ llmAnthropicApiKey: 'synthetic-key' });
      const label = screen.getByText(deChat.view.loopRetrying);
      expect(label).toHaveAttribute('role', 'status');
      expect(label).toHaveAttribute('title', 'Synthetic reason');
    } finally { await act(async () => { await i18n.changeLanguage('en'); }); }
  });

  it('every /loop run goes where Settings → AI shows at that moment, not where the loop started', async () => {
    const view = renderChat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'auto' });
    announceExtension();
    await act(async () => { await state.input.onSend('/loop 30s Check the feed'); });
    expect(state.startLoop).toHaveBeenCalledOnce();
    const { transport } = state.startLoop.mock.calls[0][0];
    await expect(transport()).resolves.toEqual({ useServerProxy: false, apiKey: 'synthetic-key' });
    // The analyst switches to Team Server routing while signed out: the next run sends nothing and says why.
    view.rerender(chat({ llmAnthropicApiKey: 'synthetic-key', llmRoutingMode: 'server' }));
    await expect(transport()).resolves.toEqual({ error: enSettings['ai.dataFlow.errorNoServer'] });
    // After signing in, runs go through the team server.
    signIn();
    await expect(transport()).resolves.toEqual({ useServerProxy: true, apiKey: 'server-proxy' });
  });

  // The extension sends any key it is given to a local model as a bearer token.
  it.each(helpers)('a local model with no key of its own: the chat %s gives the extension no key', async (name, helper, earlier) => {
    renderChat({ llmRoutingMode: 'auto', llmLocalEndpoint: 'http://localhost:11434/v1', llmLocalModelName: 'llama3', llmMaxContextMessages: 2 },
      makeThread('local', [...earlier]));
    announceExtension();
    await act(async () => { await state.input.onSend('What happened?'); });
    await waitFor(() => expect(helper).toHaveBeenCalledOnce());
    expect((vi.mocked(helper).mock.calls[0] as unknown[])[name === 'title' ? 4 : 3]).toBe('');
  });

  it.each(helpers)('a local model with its own key: the chat %s gives the extension that key', async (name, helper, earlier) => {
    renderChat({ llmRoutingMode: 'auto', llmLocalEndpoint: 'http://localhost:11434/v1', llmLocalModelName: 'llama3', llmLocalApiKey: 'synthetic-local-key',
      llmMaxContextMessages: 2 }, makeThread('local', [...earlier]));
    announceExtension();
    await act(async () => { await state.input.onSend('What happened?'); });
    await waitFor(() => expect(helper).toHaveBeenCalledOnce());
    expect((vi.mocked(helper).mock.calls[0] as unknown[])[name === 'title' ? 4 : 3]).toBe('synthetic-local-key');
  });
});
