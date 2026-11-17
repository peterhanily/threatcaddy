/**
 * C-CHAT-2 and the mode copy: Plan offers only reads of this investigation, and
 * the Plan, Ask and YOLO labels say what each mode does.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatThread, Folder, Settings } from '../types';
import { ChatView } from '../components/Chat/ChatView';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';
import i18n from '../i18n';
import deChat from '../../public/locales/de/chat.json';
import { AGENT_CONTROL_TOOLS, AGENT_NEVER_TOOLS, CROSS_CASE_READ_TOOLS, isEgressToolName } from '../lib/caddy-agent-policy';
import { isWriteTool } from '../lib/llm-tool-defs';
import { isDynamicTool } from '../lib/tool-binding';

const CASE: Folder = { id: 'case', name: 'Case', order: 0, createdAt: 1 };
const state = vi.hoisted(() => ({
  folder: undefined as Folder | undefined,
  input: { onSend: async () => {} } as { onSend: (text: string) => Promise<void> },
  send: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../hooks/useLLM', () => ({ useLLM: () => ({ extensionAvailable: true, streamingContent: '', isStreaming: false, error: null,
  toolActivity: [], sendAgentRequest: state.send, abort: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: '', user: null }) }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ selectedChatThreadId: 'thread', setSelectedChatThreadId: vi.fn() }) }));
vi.mock('../contexts/InvestigationContext', () => ({ useInvestigation: () => ({ selectedFolderId: state.folder?.id, selectedFolder: state.folder }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: state.toast }) }));
vi.mock('../hooks/useChatLoops', () => ({ useChatLoops: () => ({ loops: [], startLoop: vi.fn(), stopAllForThread: vi.fn() }) }));
vi.mock('../hooks/useCustomSlashCommands', () => ({ useCustomSlashCommands: () => ({ commands: [] }),
  interpolateTemplate: (template: string) => template }));
vi.mock('../components/Chat/ChatInput', () => ({ ChatInput: (props: typeof state.input) => { state.input = props; return null; } }));
vi.mock('../components/Chat/ChatMessage', () => ({ ChatMessageBubble: () => null }));
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
vi.mock('react-virtuoso', () => ({ Virtuoso: () => null }));

const makeThread = (mode: 'act' | 'plan', messages: ChatMessage[] = [], folderId: string | null = 'case'): ChatThread => ({ id: 'thread', title: 'Synthetic chat',
  folderId: folderId ?? undefined, mode,
  model: 'synthetic-model', provider: 'anthropic', messages, tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const skill = { name: 'lookup', description: 'Look up an indicator', parameters: { type: 'object' as const, properties: {} } };
const settings = {
  llmAnthropicApiKey: 'synthetic-unit-test-only', llmRoutingMode: 'auto',
  llmLocalEndpoint: 'http://localhost:11434/v1', llmLocalSkills: [skill],
  agentHosts: [{ id: 'host-1', name: 'cti', displayName: 'CTI host', url: 'https://cti.example', enabled: true, skills: [skill] }],
} as Settings;
// folderId null: a conversation filed in no investigation.
const renderChat = (mode: 'act' | 'plan', onUpdateThread = vi.fn(), onAddMessage = vi.fn().mockResolvedValue(undefined), messages: ChatMessage[] = [],
  folderId: string | null = 'case') =>
  render(<ChatView threads={[makeThread(mode, messages, folderId)]} settings={settings}
    onCreateThread={vi.fn()} onUpdateThread={onUpdateThread} onAddMessage={onAddMessage} onTrashThread={vi.fn()} />);

beforeEach(() => {
  discardAllComposerDrafts();
  vi.clearAllMocks();
  state.folder = CASE;
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

  // With no investigation, Plan reads every investigation (decision table rows 2 and 14), so the prompt claims none.
  it('outside any investigation, the prompt says Plan only reads without naming one investigation', async () => {
    state.folder = undefined;
    renderChat('plan', vi.fn(), vi.fn().mockResolvedValue(undefined), [], null);
    await act(async () => { await state.input.onSend('What happened?'); });
    const { systemPrompt } = state.send.mock.calls[0][0] as { systemPrompt: string };
    expect(systemPrompt).toContain('You are in PLAN MODE. You can only read; describe anything else as a plan');
    expect(systemPrompt).not.toContain('this investigation');
  });

  it('Act mode still offers skills and web fetch, behind the card', async () => {
    renderChat('act');
    await act(async () => { await state.input.onSend('What happened?'); });
    const names = (state.send.mock.calls[0][0] as { tools: Array<{ name: string }> }).tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(['fetch_url', 'local:lookup', 'host:cti:lookup']));
  });
});

// The copy must hold in an investigation that can sync, in a local-only one and outside any investigation
// (decision table rows 3 and 6-13; tool-reach.test.ts pins the claims in each of those contexts).
const PLAN_TITLE = 'Plan mode: CaddyAI only reads and describes anything else as a plan. In an investigation it reads only that investigation; '
  + 'outside any investigation it can read all of them.';
const ACT_TITLE = 'Act mode: CaddyAI can make changes and use tools. The Ask/YOLO switch sets what needs your approval.';
// 'Most': YOLO still asks for a change outside the conversation's investigation, a call read from the reply text and
// create_in_investigation (rows 3, 5 and 7), and no short list is true in every context.
const ASK_TITLE = 'CaddyAI asks before each change, web page, vendor lookup, skill or other integration, and before reading other investigations '
  + 'from an investigation that can sync. Click to turn on YOLO: most changes and built-in vendor lookups then run without asking, except changes to '
  + 'other investigations or to agents.';
const YOLO_TITLE = 'YOLO is on: most changes and built-in vendor lookups run without asking. Web pages, skills, other integrations, and changes to other '
  + 'investigations or to agents still need your approval, as does reading other investigations from an investigation that can sync. '
  + 'A vendor lookup skips other integrations instead of asking; turn YOLO off to approve them.';
// Plan refuses every change and every call that leaves ThreatCaddy, whatever the switch says (decision table row 2).
const IN_PLAN = 'In Plan mode CaddyAI only reads; the Ask/YOLO switch applies only in Act mode. ';

async function inGerman(run: () => void) {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'chat', deChat, true, true);
  await act(async () => { await i18n.changeLanguage('de'); });
  try { run(); } finally { await act(async () => { await i18n.changeLanguage('en'); }); }
}

describe('mode copy', () => {
  it('describes Plan on its pill and when switching to it', () => {
    const onUpdateThread = vi.fn();
    renderChat('act', onUpdateThread);
    fireEvent.click(screen.getByRole('button', { name: 'Act' }));
    expect(onUpdateThread).toHaveBeenCalledWith('thread', { mode: 'plan' });
    expect(state.toast).toHaveBeenCalledWith('success', 'Switched to Plan mode. CaddyAI only reads and describes anything else as a plan.');
    cleanup();
    renderChat('plan');
    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('title', PLAN_TITLE);
  });

  // YOLO can be on in Act mode, so Act's copy must not promise that every action waits for approval.
  it('describes Act on its pill, when switching to it and in the conversation without promising approval', () => {
    const onUpdateThread = vi.fn();
    const onAddMessage = vi.fn().mockResolvedValue(undefined);
    const plan: ChatMessage = { id: 'plan', role: 'assistant', content: `Proposed plan: ${'review the evidence and record findings. '.repeat(4)}`, createdAt: 1 };
    renderChat('plan', onUpdateThread, onAddMessage, [plan]);
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(onUpdateThread).toHaveBeenCalledWith('thread', { mode: 'act' });
    expect(state.toast).toHaveBeenCalledWith('success', 'Switched to Act mode. The Ask/YOLO switch sets what needs your approval.');
    expect(onAddMessage).toHaveBeenCalledWith('thread', expect.objectContaining({ role: 'assistant', content: 'Switched to **Act mode**. '
      + 'Send "execute the plan" to run the proposed actions, or continue the conversation. The Ask/YOLO switch sets which actions need your approval.' }));
    cleanup();
    renderChat('act');
    expect(screen.getByRole('button', { name: 'Act' })).toHaveAttribute('title', ACT_TITLE);
  });

  it('labels the approval toggle Ask and says what each setting asks about', () => {
    renderChat('act');
    const toggle = screen.getByRole('button', { name: 'Ask' });
    expect(toggle).toHaveAttribute('title', ASK_TITLE);
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'YOLO' })).toHaveAttribute('title', YOLO_TITLE);
  });

  it('says in Plan mode that the Ask/YOLO switch applies only in Act mode', () => {
    renderChat('plan');
    const toggle = screen.getByRole('button', { name: 'Ask' });
    expect(toggle).toHaveAttribute('title', IN_PLAN + ASK_TITLE);
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'YOLO' })).toHaveAttribute('title', IN_PLAN + YOLO_TITLE);
  });

  it('shows the mode descriptions in the analyst’s language', () => inGerman(() => {
    renderChat('act');
    expect(screen.getByRole('button', { name: deChat.view.actMode }).title).toBe(deChat.view.actModeTitleV2);
    const toggle = screen.getByRole('button', { name: deChat.mode.askLabel });
    expect(toggle.title).toBe(deChat.mode.yoloOffTitleV2);
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: deChat.view.yoloLabel }).title).toBe(deChat.mode.yoloOnTitleV2);
    cleanup();
    renderChat('plan');
    expect(screen.getByRole('button', { name: deChat.view.planMode }).title).toBe(deChat.mode.planTitleV2);
    expect(screen.getByRole('button', { name: deChat.mode.askLabel }).title)
      .toBe(deChat.mode.yoloInPlanTitle.replace('{{setting}}', deChat.mode.yoloOffTitleV2));
    expect(deChat.view.actModeTitleV2).not.toBe(ACT_TITLE);
    expect(deChat.mode.yoloOffTitleV2).not.toBe(ASK_TITLE);
    expect(deChat.mode.yoloOnTitleV2).not.toBe(YOLO_TITLE);
    expect(deChat.mode.planTitleV2).not.toBe(PLAN_TITLE);
    expect(deChat.mode.yoloInPlanTitle).not.toBe(`${IN_PLAN}{{setting}}`);
    // The German YOLO copy keeps the 'most' of the English one.
    expect(deChat.mode.yoloOnTitleV2).toMatch(/die meisten Änderungen/i);
    expect(deChat.mode.yoloOffTitleV2).toMatch(/die meisten Änderungen/i);
  }));
});

// Assistive technology gets the switch's state and the description the tooltip gives mouse users.
describe('the Ask/YOLO switch for assistive technology', () => {
  it('says whether YOLO is on and describes the current setting', () => {
    renderChat('act');
    const toggle = screen.getByRole('button', { name: 'Ask' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleDescription(ASK_TITLE);
    fireEvent.click(toggle);
    const on = screen.getByRole('button', { name: 'YOLO' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on).toHaveAccessibleDescription(YOLO_TITLE);
    expect(on).toHaveAttribute('title', YOLO_TITLE);
  });

  it('in Plan mode, the description says the switch applies only in Act mode', () => {
    renderChat('plan');
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAccessibleDescription(IN_PLAN + ASK_TITLE);
  });
});

// Encryption is off by default, and a conversation in an investigation that syncs reaches its team server.
const EMPTY_SUBTITLE = 'Messages are saved in this browser. A conversation in an investigation that syncs is shared with its team server, '
  + 'and each request goes where Settings → AI shows.';
describe('the empty conversation', () => {
  it('says where messages are kept and where they go, without claiming encryption', () => {
    renderChat('act');
    expect(screen.getByText(EMPTY_SUBTITLE)).toBeInTheDocument();
    expect(screen.queryByText(/encrypt/i)).toBeNull();
  });

  it('says so in the analyst’s language', () => inGerman(() => {
    renderChat('act');
    expect(screen.getByText(deChat.view.emptySubtitleV2)).toBeInTheDocument();
    expect(deChat.view.emptySubtitleV2).not.toBe(EMPTY_SUBTITLE);
  }));
});

// The strings this round added or changed are translated in every locale, none left in English.
const chatCatalogs = import.meta.glob<{ default: Record<string, unknown> }>('../../public/locales/*/chat.json', { eager: true });
const valueOf = (catalog: Record<string, unknown>, key: string): unknown => key in catalog ? catalog[key]
  : key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
describe('the chat copy this round changed is translated', () => {
  const KEYS = ['view.emptySubtitleV2', 'mode.yoloOnTitleV2', 'mode.yoloOffTitleV2', 'approval.title.lookupNothingSent', 'approval.lookupNone',
    'approval.targetSyncsLater', 'approval.conversationSyncsLater'];
  const english = chatCatalogs['../../public/locales/en/chat.json'].default;
  const others = Object.entries(chatCatalogs).filter(([path]) => !path.endsWith('/en/chat.json'));
  it('has 20 other locales', () => expect(others).toHaveLength(20));
  it.each(others.map(([path, catalog]) => [path.split('/').at(-2), catalog.default] as const))('%s', (_language, catalog) => {
    for (const key of KEYS) {
      expect(typeof valueOf(english, key), key).toBe('string');
      expect(typeof valueOf(catalog, key), key).toBe('string');
      expect(valueOf(catalog, key), key).not.toBe(valueOf(english, key));
    }
    // The superseded empty-state line is gone.
    expect(valueOf(catalog, 'view.emptySubtitle')).toBeUndefined();
  });
});
