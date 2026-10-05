import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatThread, Folder, Settings } from '../types';
import { ChatView } from '../components/Chat/ChatView';

const state = vi.hoisted(() => ({
  selectedThreadId: 'thread',
  folder: { id: 'a', name: 'Investigation A', order: 0, createdAt: 1 } as Folder,
  serverUrl: '', extensionAvailable: true,
  commands: [] as { name: string; description: string; template: string }[],
  input: { onSend: async () => {}, onImageAttach: async () => {} } as {
    onSend: (text: string) => Promise<void>; onImageAttach: (files: File[]) => Promise<void>;
  },
  send: vi.fn(), addMessage: vi.fn(), createThread: vi.fn(), updateThread: vi.fn(),
  select: vi.fn(), toast: vi.fn(), startLoop: vi.fn(), stopLoops: vi.fn(),
  prompt: vi.fn(), abort: vi.fn(),
}));
vi.mock('../hooks/useLLM', () => ({ useLLM: () => ({ extensionAvailable: state.extensionAvailable,
  streamingContent: '', isStreaming: false, error: null, toolActivity: [], sendAgentRequest: state.send, abort: state.abort }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: state.serverUrl }) }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ selectedChatThreadId: state.selectedThreadId, setSelectedChatThreadId: state.select }) }));
vi.mock('../contexts/InvestigationContext', () => ({ useInvestigation: () => ({ selectedFolderId: state.folder.id, selectedFolder: state.folder }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: state.toast }) }));
vi.mock('../hooks/useChatLoops', () => ({ useChatLoops: () => ({ loops: [], startLoop: state.startLoop, stopAllForThread: state.stopLoops }) }));
vi.mock('../hooks/useCustomSlashCommands', () => ({ useCustomSlashCommands: () => ({ commands: state.commands }),
  interpolateTemplate: (template: string, args: string) => template.replace('{{input}}', args) }));
vi.mock('../lib/llm-tools', () => ({ TOOL_DEFINITIONS: [], buildSystemPrompt: (...args: unknown[]) => state.prompt(...args),
  executeTool: vi.fn(), isWriteTool: () => false, fetchViaExtensionBridge: vi.fn() }));
vi.mock('../lib/agent-hosts', () => ({ getHostToolDefinitions: () => [], executeHostSkill: vi.fn() }));
vi.mock('../lib/chat-mentions', () => ({ resolveMentions: async (text: string) => ({ displayText: text, contextBlock: '' }) }));
vi.mock('../lib/chat-utils', () => ({ MAX_CONTEXT_MESSAGES: 40, truncateConversation: (messages: unknown[]) => messages,
  summarizeConversation: vi.fn(), generateChatTitle: vi.fn() }));
vi.mock('../lib/image-ocr', () => ({ supportsVision: () => true, describeImage: vi.fn() }));
vi.mock('../components/Chat/ChatInput', () => ({ ChatInput: (props: typeof state.input & { attachedImages: unknown[] }) => {
  state.input = props;
  return <div data-testid="attachments">{props.attachedImages.length}</div>;
} }));
vi.mock('../components/Chat/ChatMessage', () => ({ ChatMessageBubble: () => null }));
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
vi.mock('react-virtuoso', () => ({ Virtuoso: () => null }));

const thread: ChatThread = { id: 'thread', title: 'Synthetic chat', folderId: 'a', messages: [], model: 'synthetic-model',
  provider: 'anthropic', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
const settings = { llmAnthropicApiKey: 'synthetic-unit-test-only', llmRoutingMode: 'auto' } as Settings;
const props = { threads: [thread], settings, onCreateThread: state.createThread, onUpdateThread: state.updateThread,
  onAddMessage: state.addMessage, onTrashThread: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  state.folder = { id: 'a', name: 'Investigation A', order: 0, createdAt: 1 };
  state.serverUrl = ''; state.extensionAvailable = true; state.commands = []; state.selectedThreadId = 'thread';
  state.addMessage.mockResolvedValue(undefined);
  state.prompt.mockImplementation(async (folder?: Folder) => `Context for ${folder?.id}`);
  localStorage.setItem('caddyai-onboarded', '1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('release hardening: committed chat submission state', () => {
  it('sends a newly attached image without requiring unrelated prop changes', async () => {
    render(<ChatView {...props} />);
    const image = { name: 'synthetic.png', type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as File;
    await act(async () => { await state.input.onImageAttach([image]); });
    expect(screen.getByTestId('attachments')).toHaveTextContent('1');
    await act(async () => { await state.input.onSend('Describe attached evidence'); });
    expect(state.addMessage).toHaveBeenCalledWith('thread', expect.objectContaining({ attachments: [expect.objectContaining({ name: 'synthetic.png' })] }));
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ messages: [expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ type: 'image' })]) })] }), expect.any(Function), expect.any(Function));
    expect(screen.getByTestId('attachments')).toHaveTextContent('0');
  });

  it('uses the current route after extension availability changes', async () => {
    state.serverUrl = 'https://server.test';
    const view = render(<ChatView {...props} />);
    state.extensionAvailable = false;
    view.rerender(<ChatView {...props} />);
    await act(async () => { await state.input.onSend('Synthetic question'); });
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ useServerProxy: true }), expect.any(Function), expect.any(Function));
  });

  it('uses edited custom commands on the next submission', async () => {
    state.commands = [{ name: 'brief', description: 'Synthetic command', template: 'Old: {{input}}' }];
    const view = render(<ChatView {...props} />);
    state.commands = [{ name: 'brief', description: 'Synthetic command', template: 'Current: {{input}}' }];
    view.rerender(<ChatView {...props} />);
    await act(async () => { await state.input.onSend('/brief example'); });
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: 'user', content: 'Current: example' }] }), expect.any(Function), expect.any(Function));
  });

  it('does not let an earlier investigation prompt populate a later submission', async () => {
    let releaseOld: ((value: string) => void) | undefined;
    const oldPrompt = new Promise<string>(resolve => { releaseOld = resolve; });
    state.prompt.mockImplementation((folder?: Folder) => folder?.id === 'a' ? oldPrompt : Promise.resolve('Context for b'));
    const view = render(<ChatView {...props} />);
    state.folder = { ...state.folder, id: 'b', name: 'Investigation B' };
    view.rerender(<ChatView {...props} />);
    await act(async () => { releaseOld?.('Context for a'); });
    await act(async () => { await state.input.onSend('Current investigation question'); });
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: 'Context for b' }), expect.any(Function), expect.any(Function));
  });

  it('does not reuse the currently selected empty thread when starting a new chat', async () => {
    const second = { ...thread, id: 'second', title: 'Second empty chat' };
    const viewProps = { ...props, threads: [thread, second] };
    const view = render(<ChatView {...viewProps} />);
    state.selectedThreadId = 'second';
    view.rerender(<ChatView {...viewProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'New Chat' }));
    await waitFor(() => expect(state.select).toHaveBeenCalledWith('thread'));
  });
});
