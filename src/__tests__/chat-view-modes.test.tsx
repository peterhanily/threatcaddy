/**
 * C-CHAT-2 and the mode copy: Plan offers only reads of this investigation, and
 * the Plan, Ask and YOLO labels say what each mode does.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatThread, Folder, Settings } from '../types';
import { ChatView } from '../components/Chat/ChatView';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';
import { AGENT_CONTROL_TOOLS, AGENT_NEVER_TOOLS, CROSS_CASE_READ_TOOLS, isEgressToolName } from '../lib/caddy-agent-policy';
import { isWriteTool } from '../lib/llm-tool-defs';
import { isDynamicTool } from '../lib/tool-binding';

const state = vi.hoisted(() => ({
  folder: { id: 'case', name: 'Case', order: 0, createdAt: 1 } as Folder,
  input: { onSend: async () => {} } as { onSend: (text: string) => Promise<void> },
  send: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../hooks/useLLM', () => ({ useLLM: () => ({ extensionAvailable: true, streamingContent: '', isStreaming: false, error: null,
  toolActivity: [], sendAgentRequest: state.send, abort: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: '', user: null }) }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ selectedChatThreadId: 'thread', setSelectedChatThreadId: vi.fn() }) }));
vi.mock('../contexts/InvestigationContext', () => ({ useInvestigation: () => ({ selectedFolderId: state.folder.id, selectedFolder: state.folder }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: state.toast }) }));
vi.mock('../hooks/useChatLoops', () => ({ useChatLoops: () => ({ loops: [], startLoop: vi.fn(), stopAllForThread: vi.fn() }) }));
vi.mock('../hooks/useCustomSlashCommands', () => ({ useCustomSlashCommands: () => ({ commands: [] }),
  interpolateTemplate: (template: string) => template }));
vi.mock('../components/Chat/ChatInput', () => ({ ChatInput: (props: typeof state.input) => { state.input = props; return null; } }));
vi.mock('../components/Chat/ChatMessage', () => ({ ChatMessageBubble: () => null }));
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
vi.mock('react-virtuoso', () => ({ Virtuoso: () => null }));

const makeThread = (mode: 'act' | 'plan'): ChatThread => ({ id: 'thread', title: 'Synthetic chat', folderId: 'case', mode, model: 'synthetic-model',
  provider: 'anthropic', messages: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const skill = { name: 'lookup', description: 'Look up an indicator', parameters: { type: 'object' as const, properties: {} } };
const settings = {
  llmAnthropicApiKey: 'synthetic-unit-test-only', llmRoutingMode: 'auto',
  llmLocalEndpoint: 'http://localhost:11434/v1', llmLocalSkills: [skill],
  agentHosts: [{ id: 'host-1', name: 'cti', displayName: 'CTI host', url: 'https://cti.example', enabled: true, skills: [skill] }],
} as Settings;
const renderChat = (mode: 'act' | 'plan', onUpdateThread = vi.fn()) => render(<ChatView threads={[makeThread(mode)]} settings={settings}
  onCreateThread={vi.fn()} onUpdateThread={onUpdateThread} onAddMessage={vi.fn().mockResolvedValue(undefined)} onTrashThread={vi.fn()} />);

beforeEach(() => {
  discardAllComposerDrafts();
  vi.clearAllMocks();
  localStorage.setItem('caddyai-onboarded', '1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); discardAllComposerDrafts(); });

describe('C-CHAT-2 Plan mode only reads this investigation', () => {
  it('offers no write, egress, cross-investigation, skill or agent tool, and says so in the prompt', async () => {
    renderChat('plan');
    await act(async () => { await state.input.onSend('What happened?'); });
    const request = state.send.mock.calls[0][0] as { tools: Array<{ name: string }>; systemPrompt: string };
    const names = request.tools.map(tool => tool.name);
    expect(names).toContain('read_note');
    expect(names).toContain('search_notes');
    expect(names.filter(name => isWriteTool(name) || isEgressToolName(name) || isDynamicTool(name) || CROSS_CASE_READ_TOOLS.has(name)
      || AGENT_NEVER_TOOLS.has(name) || AGENT_CONTROL_TOOLS.has(name))).toEqual([]);
    expect(request.systemPrompt).toContain('You can only read this investigation; describe anything else as a plan');
  });

  it('Act mode still offers skills and web fetch, behind the card', async () => {
    renderChat('act');
    await act(async () => { await state.input.onSend('What happened?'); });
    const names = (state.send.mock.calls[0][0] as { tools: Array<{ name: string }> }).tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(['fetch_url', 'local:lookup', 'host:cti:lookup']));
  });
});

describe('mode copy', () => {
  it('describes Plan on its pill and when switching to it', () => {
    const onUpdateThread = vi.fn();
    renderChat('act', onUpdateThread);
    fireEvent.click(screen.getByRole('button', { name: 'Act' }));
    expect(onUpdateThread).toHaveBeenCalledWith('thread', { mode: 'plan' });
    expect(state.toast).toHaveBeenCalledWith('success', 'Switched to Plan mode. CaddyAI only reads this investigation and describes anything else as a plan');
    cleanup();
    renderChat('plan');
    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('title', 'Plan mode: CaddyAI only reads this investigation and describes anything else as a plan');
  });

  it('labels the approval toggle Ask and says what YOLO still asks about', () => {
    renderChat('act');
    const toggle = screen.getByRole('button', { name: 'Ask' });
    expect(toggle.title).toMatch(/^CaddyAI asks before each change\. Click to turn on YOLO: auto-approves changes inside this investigation and built-in vendor lookups/);
    fireEvent.click(toggle);
    const yolo = screen.getByRole('button', { name: 'YOLO' });
    expect(yolo.title).toBe('YOLO is on: auto-approves changes inside this investigation and built-in vendor lookups. Still asks before opening web pages, reading or writing other investigations, using skills, or changing agents.');
  });
});
