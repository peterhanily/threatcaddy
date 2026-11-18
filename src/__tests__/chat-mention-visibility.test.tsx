/**
 * C2-1: an @-mention reads an entity by id outside the tool gate, so it follows the
 * gate's row 1 (hidden). A model-written chip never carries one; resolveMentions leaves
 * trashed entities, and local-only ones while the conversation can sync, as unresolved
 * tokens; the composer suggests only what the conversation's investigation may see.
 * Analyst-typed mentions of visible entities keep working across investigations.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { ChatMessage, ChatThread, Folder, Settings } from '../types';
import { ChatView } from '../components/Chat/ChatView';
import type { ChatMessageBubble as RealBubble } from '../components/Chat/ChatMessage';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';
import { resolveMentions, searchMentions } from '../lib/chat-mentions';
import { canary, ids, seedAIWorkspace, syncQueueContains } from './helpers/ai-workspace';

type BubbleProps = ComponentProps<typeof RealBubble>;
const state = vi.hoisted(() => ({
  folder: undefined as Folder | undefined,
  input: {} as { onSend: (text: string) => Promise<void>; folderId?: string },
  send: vi.fn(),
  onSuggestionClick: vi.fn<(text: string) => void>(),
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
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
// The real bubble renders the chips; the wrapper keeps ChatView's handler so a test can call it directly.
vi.mock('../components/Chat/ChatMessage', async importOriginal => {
  const actual = await importOriginal<typeof import('../components/Chat/ChatMessage')>();
  return { ChatMessageBubble: (props: BubbleProps) => {
    if (props.onSuggestionClick) state.onSuggestionClick.mockImplementation(props.onSuggestionClick);
    return <actual.ChatMessageBubble {...props} />;
  } };
});
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: unknown) => ReactNode }) =>
  <>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</> }));

const L = ids('L');
const S = ids('S');
const P = ids('P');
const settings = { llmAnthropicApiKey: 'synthetic-unit-test-only', llmRoutingMode: 'auto' } as Settings;
const makeThread = (messages: ChatMessage[]): ChatThread => ({ id: 'thread', title: 'Shared chat', folderId: 'S', model: 'synthetic-model',
  provider: 'anthropic', messages, tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });

// What the app's useChats.addMessage does: append to the persisted thread, which syncs with S.
const addMessage = async (threadId: string, message: ChatMessage) => {
  await db.chatThreads.where('id').equals(threadId).modify(t => { t.messages.push(message); t.updatedAt = Date.now(); });
};

async function renderChat(messages: ChatMessage[] = [{ id: 'm1', role: 'user', content: 'Earlier question', createdAt: 1 }]) {
  const thread = makeThread(messages);
  await db.chatThreads.add(thread);
  await db.table('_syncQueue').clear();
  const onAddMessage = vi.fn(addMessage);
  render(<ChatView threads={[thread]} settings={settings} onCreateThread={vi.fn()} onUpdateThread={vi.fn()} onAddMessage={onAddMessage} onTrashThread={vi.fn()} />);
  return { onAddMessage };
}
const sentText = () => JSON.stringify((state.send.mock.calls[0][0] as { messages: unknown }).messages);
const storedLast = async () => (await db.chatThreads.get('thread'))?.messages.at(-1)?.content;

beforeEach(async () => {
  discardAllComposerDrafts();
  vi.clearAllMocks();
  state.onSuggestionClick.mockReset();
  state.folder = undefined;
  await seedAIWorkspace();
  localStorage.setItem('caddyai-onboarded', '1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); discardAllComposerDrafts(); });

describe('C2-1 a model-written suggestion chip never carries an @-mention', () => {
  it('renders no chip with a mention token of any kind, and the click handler refuses one', async () => {
    const { onAddMessage } = await renderChat([
      { id: 'm1', role: 'user', content: 'Summarise the case', createdAt: 1 },
      { id: 'm2', role: 'assistant', createdAt: 2,
        content: `Done. <!-- suggestions: What changed? | Compare with @note:${L.note} | Check @ioc:${L.ioc} | Open @investigation:L | See @note:${P.note} -->` },
    ]);
    expect(screen.getByRole('button', { name: 'What changed?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /@(note|ioc|investigation):/ })).toBeNull();

    expect(state.onSuggestionClick.getMockImplementation()).toBeDefined();
    act(() => state.onSuggestionClick(`Compare with @note:${L.note}`));
    act(() => state.onSuggestionClick(`See @note:${P.note}`));
    act(() => state.onSuggestionClick('Open @investigation:L'));
    fireEvent.click(screen.getByRole('button', { name: 'What changed?' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(onAddMessage.mock.calls.map(([, message]) => message.content)).toEqual(['What changed?']);
    expect(sentText()).not.toContain(canary('L'));
    expect(await syncQueueContains('Local case')).toBe(false);
  });
});

describe('C2-1 mentions follow the tool gate\'s visibility', () => {
  it('in a synced conversation, local-only and trashed entities stay unresolved tokens', async () => {
    await db.notes.update(S.note, { trashed: true });
    const text = `Compare @note:${L.note} @ioc:${L.ioc} @investigation:L @investigation:L2 @note:${S.note}`;
    const resolved = await resolveMentions(text, 'S');
    expect(resolved.displayText).toBe(text);
    expect(resolved.contextBlock).toBe('');
    for (const leaked of [canary('L'), canary('L2'), canary('S'), 'Local case', 'Hunting case', 'Shared case note']) {
      expect(JSON.stringify(resolved)).not.toContain(leaked);
    }
  });

  it('the persisted local-only marker hides an investigation whose flag is missing', async () => {
    await db.folders.update('L', { localOnly: undefined });
    await db.table('_syncMeta').put({ key: JSON.stringify(['localOnly', 'L']), value: true });
    const resolved = await resolveMentions(`@note:${L.note} @investigation:L`, 'S');
    expect(resolved.contextBlock).toBe('');
  });

  it('visible entities still resolve, across investigations as today', async () => {
    const resolved = await resolveMentions(`@note:${P.note} @ioc:${S.ioc} @investigation:P`, 'S');
    expect(resolved.displayText).toBe('@Private case note @domain:canary-s.example @Private case');
    expect(resolved.contextBlock).toContain(canary('P'));
    expect(resolved.contextBlock).toContain(canary('S'));
    expect(resolved.contextBlock).toContain('[Referenced Investigation: "Private case"]');
  });

  it('a local-only or unfiled conversation can mention local-only entities, but never trashed ones', async () => {
    expect((await resolveMentions(`@note:${ids('L2').note}`, 'L')).contextBlock).toContain(canary('L2'));
    expect((await resolveMentions(`@note:${L.note} @investigation:L`, undefined)).contextBlock).toContain(canary('L'));
    await db.notes.update(L.note, { trashed: true });
    await db.standaloneIOCs.update(L.ioc, { trashed: true });
    const trashed = await resolveMentions(`@note:${L.note} @ioc:${L.ioc}`, 'L');
    expect(trashed.contextBlock).toBe('');
    expect(trashed.displayText).toBe(`@note:${L.note} @ioc:${L.ioc}`);
  });

  it('sending a mention of a local-only note from a synced thread puts neither its content nor its title anywhere', async () => {
    await renderChat();
    await act(async () => { await state.input.onSend(`Compare with @note:${L.note}`); });
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(sentText()).not.toContain(canary('L'));
    expect(await storedLast()).toBe(`Compare with @note:${L.note}`);
    expect(await syncQueueContains('Local case note')).toBe(false);
    expect(await syncQueueContains(canary('L'))).toBe(false);
  });

  it('an analyst-typed mention of a visible note in another investigation still reaches the model', async () => {
    await renderChat();
    await act(async () => { await state.input.onSend(`Compare with @note:${P.note}`); });
    expect(sentText()).toContain(canary('P'));
    expect(await storedLast()).toBe('Compare with @Private case note');
  });
});

describe('C2-1 the composer suggests only what the conversation may see', () => {
  it('searches in the conversation\'s investigation in the global view', async () => {
    await renderChat();
    expect(state.input.folderId).toBe('S');
  });

  it('never offers a local-only investigation in a synced conversation', async () => {
    const names = async (folderId?: string) => (await searchMentions('investigation', '', folderId)).map(item => item.id).sort();
    expect(await names('S')).toEqual(['P', 'S']);
    expect(await names('L')).toEqual(['L', 'L2', 'P', 'S']);
    expect(await names(undefined)).toEqual(['L', 'L2', 'P', 'S']);
    expect((await searchMentions('note', '', 'S')).map(item => item.id)).toEqual([S.note]);
  });

  // The search runs on every keystroke after '@investigation:'.
  it('reads the local-only markers once per search, however many investigations there are', async () => {
    const meta = db.table('_syncMeta');
    const marker = (id: string, value: unknown) => meta.put({ key: JSON.stringify(['localOnly', id]), value });
    // A marker hides an investigation whose flag is missing; only a true marker counts.
    await db.folders.update('L', { localOnly: undefined });
    await marker('L', true);
    const gets = vi.spyOn(meta, 'get');
    const wheres = vi.spyOn(meta, 'where');
    const search = async () => {
      gets.mockClear();
      wheres.mockClear();
      const found = (await searchMentions('investigation', 'case', 'S', 1000)).map(item => item.id).sort();
      return { found, reads: gets.mock.calls.length + wheres.mock.calls.length };
    };
    try {
      const few = await search();
      expect(few.found).toEqual(['P', 'S']);

      await db.folders.bulkAdd(Array.from({ length: 300 }, (_, i) => ({ id: `extra-${i}`, name: `Extra case ${i}`, order: 10 + i, createdAt: 2 + i })));
      await db.folders.update('extra-0', { localOnly: true });
      await marker('extra-1', true);
      await marker('extra-2', false);
      const many = await search();
      expect(many.found).toEqual(['P', 'S', ...Array.from({ length: 298 }, (_, i) => `extra-${i + 2}`)].sort());
      expect(many.reads).toBe(few.reads);
      expect(many.reads).toBeLessThanOrEqual(2);
      // A conversation that cannot sync still sees every investigation.
      expect((await searchMentions('investigation', 'case', 'L2', 1000)).length).toBe(304);
    } finally {
      gets.mockRestore();
      wheres.mockRestore();
    }
  });
});
