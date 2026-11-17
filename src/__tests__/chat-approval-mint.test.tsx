/**
 * A.2 call-site plumbing: approving a chat write card mints the approval the
 * dispatcher requires, so the approved write runs through the real executeTool.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { ChatThread, Folder, Settings, ToolUseBlock } from '../types';
import type { ToolExecutionResult } from '../lib/llm-tool-execution';
import { ChatView } from '../components/Chat/ChatView';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';

type ToolHandler = (toolUse: ToolUseBlock, signal: AbortSignal) => Promise<ToolExecutionResult>;
const state = vi.hoisted(() => ({
  folder: { id: 'case', name: 'Case', order: 0, createdAt: 1 } as Folder,
  input: { onSend: async () => {} } as { onSend: (text: string) => Promise<void> },
  send: vi.fn(),
}));
vi.mock('../hooks/useLLM', () => ({ useLLM: () => ({ extensionAvailable: true, streamingContent: '', isStreaming: false, error: null,
  toolActivity: [], sendAgentRequest: state.send, abort: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: '', user: null }) }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ selectedChatThreadId: 'thread', setSelectedChatThreadId: vi.fn() }) }));
vi.mock('../contexts/InvestigationContext', () => ({ useInvestigation: () => ({ selectedFolderId: state.folder.id, selectedFolder: state.folder }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/useChatLoops', () => ({ useChatLoops: () => ({ loops: [], startLoop: vi.fn(), stopAllForThread: vi.fn() }) }));
vi.mock('../hooks/useCustomSlashCommands', () => ({ useCustomSlashCommands: () => ({ commands: [] }),
  interpolateTemplate: (template: string) => template }));
vi.mock('../components/Chat/ChatInput', () => ({ ChatInput: (props: typeof state.input) => { state.input = props; return null; } }));
vi.mock('../components/Chat/ChatMessage', () => ({ ChatMessageBubble: () => null }));
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
// The approval card lives in the list footer.
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ components }: { components?: { Footer?: () => ReactNode } }) => <>{components?.Footer?.()}</> }));

const thread: ChatThread = { id: 'thread', title: 'Synthetic chat', folderId: 'case', model: 'synthetic-model', provider: 'anthropic',
  messages: [{ id: 'm1', role: 'user', content: 'Earlier question', createdAt: 1 }], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
const settings = { llmAnthropicApiKey: 'synthetic-unit-test-only', llmRoutingMode: 'auto' } as Settings;

beforeEach(async () => {
  discardAllComposerDrafts();
  vi.clearAllMocks();
  await db.notes.clear();
  await db.folders.clear();
  await db.folders.add(state.folder);
  localStorage.setItem('caddyai-onboarded', '1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); discardAllComposerDrafts(); });

describe('chat write approval', () => {
  it('an approved create_note card runs through the dispatcher and writes the note', async () => {
    render(<ChatView threads={[thread]} settings={settings} onCreateThread={vi.fn()} onUpdateThread={vi.fn()} onAddMessage={vi.fn().mockResolvedValue(undefined)} onTrashThread={vi.fn()} />);
    await act(async () => { await state.input.onSend('Write the finding down'); });
    const handleTool = state.send.mock.calls[0][1] as ToolHandler;

    let pending!: Promise<ToolExecutionResult>;
    act(() => { pending = handleTool({ type: 'tool_use', id: 'toolu_1', name: 'create_note', input: { title: 'Approved finding', content: 'Beacon seen' } }, new AbortController().signal); });
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    const result = await pending;

    expect(result.isError).toBe(false);
    await waitFor(async () => expect(await db.notes.where('folderId').equals('case').toArray()).toEqual([
      expect.objectContaining({ title: 'Approved finding', createdBy: 'Analyst', tags: [] }),
    ]));
  });

  it('a rejected card writes nothing', async () => {
    render(<ChatView threads={[thread]} settings={settings} onCreateThread={vi.fn()} onUpdateThread={vi.fn()} onAddMessage={vi.fn().mockResolvedValue(undefined)} onTrashThread={vi.fn()} />);
    await act(async () => { await state.input.onSend('Write the finding down'); });
    const handleTool = state.send.mock.calls[0][1] as ToolHandler;

    let pending!: Promise<ToolExecutionResult>;
    act(() => { pending = handleTool({ type: 'tool_use', id: 'toolu_1', name: 'create_note', input: { title: 'Rejected finding' } }, new AbortController().signal); });
    fireEvent.click(await screen.findByRole('button', { name: /reject/i }));

    expect((await pending).isError).toBe(true);
    expect(await db.notes.count()).toBe(0);
  });
});
