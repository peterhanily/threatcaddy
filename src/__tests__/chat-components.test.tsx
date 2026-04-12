import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatMessageBubble } from '../components/Chat/ChatMessage';
import { ToastProvider } from '../contexts/ToastContext';
import type { ChatThread, Settings, ToolCallRecord } from '../types';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../lib/markdown', () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
  sanitizeHtml: vi.fn((html: string) => html),
}));

vi.mock('../hooks/useLLM', () => ({
  useLLM: () => ({
    extensionAvailable: true,
    extensionInfo: { protocolVersion: 2, capabilities: ['llm'] },
    streamingContent: '',
    activeRequestId: null,
    error: null,
    toolActivity: [],
    sendAgentRequest: vi.fn(() => 'req-1'),
    abort: vi.fn(),
    isStreaming: false,
  }),
}));

vi.mock('../lib/llm-tools', () => ({
  TOOL_DEFINITIONS: [],
  buildSystemPrompt: vi.fn(async () => 'system prompt'),
  executeTool: vi.fn(async () => ({ result: '{}', isError: false })),
  isWriteTool: vi.fn(() => false),
  fetchViaExtensionBridge: vi.fn(async () => ({ success: false, error: 'test' })),
}));

vi.mock('../lib/chat-utils', () => ({
  generateChatTitle: vi.fn(async () => 'Generated title'),
}));

vi.mock('../db', () => ({
  db: {
    notes: { add: vi.fn(async () => 'note-1') },
  },
}));

vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({
    selectedChatThreadId: 't1',
    setSelectedChatThreadId: vi.fn(),
  }),
}));

vi.mock('../contexts/InvestigationContext', () => ({
  useInvestigation: () => ({
    selectedFolderId: undefined,
    selectedFolder: undefined,
  }),
}));

vi.mock('../lib/utils', () => ({
  cn: (...args: (string | boolean | undefined | null)[]) => args.filter(Boolean).join(' '),
  formatDate: vi.fn((ts: number) => new Date(ts).toLocaleDateString()),
}));

// Mock scrollIntoView for jsdom
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.setItem('caddyai-onboarded', '1');
});

// ── Fixtures ─────────────────────────────────────────────────────────

function makeToolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: 'tc-1',
    name: 'search_notes',
    input: { query: 'test' },
    result: JSON.stringify({ count: 3 }),
    isError: false,
    ...overrides,
  };
}

// ── ChatMessageBubble ────────────────────────────────────────────────

describe('ChatMessageBubble', () => {
  it('renders user message as plain text', () => {
    render(
      <ChatMessageBubble role="user" content="Hello, this is a test" />,
    );
    expect(screen.getByText('Hello, this is a test')).toBeInTheDocument();
  });

  it('applies user styling (right-aligned)', () => {
    const { container } = render(
      <ChatMessageBubble role="user" content="User msg" />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-end');
  });

  it('renders assistant message with markdown div', () => {
    const { container } = render(
      <ChatMessageBubble role="assistant" content="**Bold text**" />,
    );
    const markdown = container.querySelector('.markdown-preview');
    expect(markdown).not.toBeNull();
  });

  it('applies assistant styling (left-aligned)', () => {
    const { container } = render(
      <ChatMessageBubble role="assistant" content="Assistant msg" />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-start');
  });

  it('renders tool call blocks for assistant messages', () => {
    const toolCalls = [
      makeToolCall({ name: 'search_notes', result: JSON.stringify({ count: 5 }) }),
    ];
    render(
      <ChatMessageBubble
        role="assistant"
        content="Here are the results"
        toolCalls={toolCalls}
      />,
    );
    expect(screen.getByText('search_notes')).toBeInTheDocument();
  });

  it('shows error styling for errored tool calls', () => {
    const toolCalls = [
      makeToolCall({
        name: 'search_notes',
        result: JSON.stringify({ error: 'Not found' }),
        isError: true,
      }),
    ];
    const { container } = render(
      <ChatMessageBubble
        role="assistant"
        content="Error occurred"
        toolCalls={toolCalls}
      />,
    );
    // The error tool block gets border-red-500/20
    const blocks = container.querySelectorAll('[class*="border-red"]');
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('shows streaming cursor when isStreaming is true', () => {
    const { container } = render(
      <ChatMessageBubble role="assistant" content="Loading..." isStreaming />,
    );
    const cursor = container.querySelector('.animate-pulse');
    expect(cursor).not.toBeNull();
  });

  it('does not show streaming cursor when isStreaming is false', () => {
    const { container } = render(
      <ChatMessageBubble role="assistant" content="Done." isStreaming={false} />,
    );
    const cursor = container.querySelector('.animate-pulse');
    expect(cursor).toBeNull();
  });

  it('renders multiple tool calls', () => {
    const toolCalls = [
      makeToolCall({ id: 'tc-1', name: 'search_notes', result: JSON.stringify({ count: 2 }) }),
      makeToolCall({ id: 'tc-2', name: 'create_note', result: JSON.stringify({ success: true, title: 'New note' }) }),
    ];
    render(
      <ChatMessageBubble
        role="assistant"
        content="I searched and created."
        toolCalls={toolCalls}
      />,
    );
    expect(screen.getByText('search_notes')).toBeInTheDocument();
    expect(screen.getByText('create_note')).toBeInTheDocument();
  });

  it('renders user message as pre-wrap preserving whitespace', () => {
    const { container } = render(
      <ChatMessageBubble role="user" content="Line 1\nLine 2" />,
    );
    const p = container.querySelector('.whitespace-pre-wrap');
    expect(p).not.toBeNull();
  });

  it('tool call block is expandable', () => {
    const toolCalls = [
      makeToolCall({
        name: 'search_notes',
        input: { query: 'malware analysis' },
        result: JSON.stringify({ count: 3, notes: [{ id: '1', title: 'Malware Report' }] }),
      }),
    ];
    render(
      <ChatMessageBubble
        role="assistant"
        content="Found results"
        toolCalls={toolCalls}
      />,
    );

    // Click the tool call button to expand
    const toolButton = screen.getByText('search_notes').closest('button');
    expect(toolButton).not.toBeNull();
    fireEvent.click(toolButton!);

    // After expansion, should show input and result
    expect(screen.getByText('Input:')).toBeInTheDocument();
    expect(screen.getByText('Result:')).toBeInTheDocument();
  });

  it('shows suggestion chips for last assistant message', () => {
    // The ChatMessageBubble uses parseSuggestions which looks for HTML comments.
    // The renderMarkdown mock wraps in <p> tags but the raw content still has the comment.
    // parseSuggestions works on the raw content string, not the rendered HTML.
    render(
      <ChatMessageBubble
        role="assistant"
        content="Here is info. <!-- suggestions: Show details|Search more|Create report -->"
        isLastAssistant
        onSuggestionClick={vi.fn()}
      />,
    );
    expect(screen.getByText('Show details')).toBeInTheDocument();
    expect(screen.getByText('Search more')).toBeInTheDocument();
    expect(screen.getByText('Create report')).toBeInTheDocument();
  });

  it('calls onSuggestionClick when suggestion chip is clicked', () => {
    const onSuggestion = vi.fn();
    render(
      <ChatMessageBubble
        role="assistant"
        content="Info. <!-- suggestions: Search more -->"
        isLastAssistant
        onSuggestionClick={onSuggestion}
      />,
    );
    fireEvent.click(screen.getByText('Search more'));
    expect(onSuggestion).toHaveBeenCalledWith('Search more');
  });
});

// ── ChatView ─────────────────────────────────────────────────────────

describe('ChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('caddyai-onboarded', '1');
  });

  async function importChatView() {
    const mod = await import('../components/Chat/ChatView');
    return mod.ChatView;
  }

  function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
    return {
      id: 'thread-1',
      title: 'Test Thread',
      messages: [],
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      tags: [],
      trashed: false,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  function makeSettings(): Settings {
    return {
      theme: 'dark',
      defaultView: 'dashboard',
      editorMode: 'split',
      sidebarCollapsed: false,
      taskViewMode: 'list',
      llmAnthropicApiKey: 'test-key',
    } as Settings;
  }

  it('renders thread list', async () => {
    const ChatView = await importChatView();
    const threads = [
      makeThread({ id: 't1', title: 'Thread A' }),
      makeThread({ id: 't2', title: 'Thread B' }),
    ];

    render(
      <ToastProvider><ChatView
        threads={threads}
        onCreateThread={vi.fn(async () => makeThread())}
        onUpdateThread={vi.fn()}
        onAddMessage={vi.fn(async () => {})}
        onTrashThread={vi.fn()}
        settings={makeSettings()}
      /></ToastProvider>,
    );

    // Thread titles appear in the sidebar list (and possibly header for selected thread)
    expect(screen.getAllByText('Thread A').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Thread B').length).toBeGreaterThanOrEqual(1);
  });

  it('shows New Chat button', async () => {
    const ChatView = await importChatView();
    render(
      <ToastProvider><ChatView
        threads={[]}
        onCreateThread={vi.fn(async () => makeThread())}
        onUpdateThread={vi.fn()}
        onAddMessage={vi.fn(async () => {})}
        onTrashThread={vi.fn()}
        settings={makeSettings()}
      /></ToastProvider>,
    );

    expect(screen.getByText('New Chat')).toBeInTheDocument();
  });

  it('shows empty state text when no threads', async () => {
    const ChatView = await importChatView();
    render(
      <ToastProvider><ChatView
        threads={[]}
        onCreateThread={vi.fn(async () => makeThread())}
        onUpdateThread={vi.fn()}
        onAddMessage={vi.fn(async () => {})}
        onTrashThread={vi.fn()}
        settings={makeSettings()}
      /></ToastProvider>,
    );

    expect(screen.getByText('No chat threads yet')).toBeInTheDocument();
  });
});
