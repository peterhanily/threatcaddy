import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from '../components/Chat/ChatView';
import type { Settings } from '../types';
import { discardAllComposerDrafts, getComposerDraft, setComposerText } from '../lib/chat-composer-drafts';
import { hasPendingChanges } from '../lib/pending-changes';

const mocks = vi.hoisted(() => ({ send: vi.fn(), addMessage: vi.fn(), select: vi.fn() }));
vi.mock('../hooks/useLLM', () => ({ useLLM: () => ({ extensionAvailable: false,
  streamingContent: '', isStreaming: false, error: null, toolActivity: [], sendAgentRequest: mocks.send, abort: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: '' }) }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ selectedChatThreadId: undefined, setSelectedChatThreadId: mocks.select }) }));
vi.mock('../contexts/InvestigationContext', () => ({ useInvestigation: () => ({ selectedFolderId: undefined, selectedFolder: undefined }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/useChatLoops', () => ({ useChatLoops: () => ({ loops: [], startLoop: vi.fn(), stopAllForThread: vi.fn() }) }));
vi.mock('../hooks/useCustomSlashCommands', () => ({ useCustomSlashCommands: () => ({ commands: [] }) }));
vi.mock('../lib/llm-tools', () => ({ TOOL_DEFINITIONS: [], buildSystemPrompt: async () => '', executeTool: vi.fn(), isWriteTool: () => false }));
vi.mock('../lib/agent-hosts', () => ({ getHostToolDefinitions: () => [], executeHostSkill: vi.fn() }));
vi.mock('../components/Chat/ChatInput', () => ({ ChatInput: () => null }));
vi.mock('../components/Chat/ChatMessage', () => ({ ChatMessageBubble: () => null }));
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
vi.mock('react-virtuoso', () => ({ Virtuoso: () => null }));

beforeEach(() => {
  discardAllComposerDrafts(); vi.clearAllMocks();
  localStorage.setItem('caddyai-onboarded', '1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); discardAllComposerDrafts(); });

describe('hidden chat draft disposal', () => {
  it('requires explicit confirmation and is reachable without an active thread or configured provider', () => {
    setComposerText('deleted-or-hidden-thread', 'Synthetic unsent draft');
    render(<ChatView threads={[]} settings={{} as Settings} onCreateThread={vi.fn()} onUpdateThread={vi.fn()}
      onAddMessage={mocks.addMessage} onTrashThread={vi.fn()} />);
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Discard all unsent chat drafts' }));
    open(); expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(getComposerDraft('deleted-or-hidden-thread').text).toBe('Synthetic unsent draft');
    expect(hasPendingChanges()).toBe(true);
    open(); fireEvent.click(screen.getByRole('button', { name: 'Discard unsent drafts' }));
    expect(getComposerDraft('deleted-or-hidden-thread').text).toBe('');
    expect(hasPendingChanges()).toBe(false);
    expect(screen.queryByRole('button', { name: 'Discard all unsent chat drafts' })).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.addMessage).not.toHaveBeenCalled();
  });
});
