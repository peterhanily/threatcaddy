/**
 * C-CHAT-8: CTI slash commands say plainly when no CTI source is available,
 * instead of listing every source as skipped.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatThread, Folder, Settings } from '../types';
import { ChatView } from '../components/Chat/ChatView';
import { discardAllComposerDrafts } from '../lib/chat-composer-drafts';

const state = vi.hoisted(() => ({
  folder: { id: 'case', name: 'Case', order: 0, createdAt: 1 } as Folder,
  input: { onSend: async () => {} } as { onSend: (text: string) => Promise<void> },
  executeHostSkill: vi.fn(),
}));
vi.mock('../hooks/useLLM', () => ({ useLLM: () => ({ extensionAvailable: true, streamingContent: '', isStreaming: false, error: null,
  toolActivity: [], sendAgentRequest: vi.fn(), abort: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: '', user: null }) }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ selectedChatThreadId: 'thread', setSelectedChatThreadId: vi.fn() }) }));
vi.mock('../contexts/InvestigationContext', () => ({ useInvestigation: () => ({ selectedFolderId: state.folder.id, selectedFolder: state.folder }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/useChatLoops', () => ({ useChatLoops: () => ({ loops: [], startLoop: vi.fn(), stopAllForThread: vi.fn() }) }));
vi.mock('../hooks/useCustomSlashCommands', () => ({ useCustomSlashCommands: () => ({ commands: [] }),
  interpolateTemplate: (template: string) => template }));
vi.mock('../lib/agent-hosts', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/agent-hosts')>(), executeHostSkill: state.executeHostSkill }));
vi.mock('../components/Chat/ChatInput', () => ({ ChatInput: (props: typeof state.input) => { state.input = props; return null; } }));
vi.mock('../components/Chat/ChatMessage', () => ({ ChatMessageBubble: () => null }));
vi.mock('../components/Agent/AgentCycleSummaryCard', () => ({ AgentCycleSummaryCard: () => null }));
vi.mock('react-virtuoso', () => ({ Virtuoso: () => null }));

const thread: ChatThread = { id: 'thread', title: 'Synthetic chat', folderId: 'case', model: 'synthetic-model', provider: 'anthropic',
  messages: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
const NO_SOURCES = 'No CTI sources are available. Named agent hosts are no longer configurable in this version.';
const NEEDS_HTTPS = 'No CTI sources are available. The CTI agent host is not used because it needs https (plain http works only on this computer). '
  + 'See Settings → AI.';
const skill = (name: string) => ({ name, description: name, parameters: { type: 'object' as const, properties: {} } });
const ctiHost = (url: string, enabled = true) => ({ id: 'cti', name: 'cti', displayName: 'CTI', url, enabled,
  skills: [skill('virustotal_ioc_report'), skill('censys_host')] });

async function runCommand(settings: Settings) {
  const onAddMessage = vi.fn().mockResolvedValue(undefined);
  render(<ChatView threads={[thread]} settings={settings} onCreateThread={vi.fn()} onUpdateThread={vi.fn()} onAddMessage={onAddMessage} onTrashThread={vi.fn()} />);
  await act(async () => { await state.input.onSend('/cti 8.8.8.8'); });
  return onAddMessage.mock.calls.map(([, message]) => (message as { role: string; content: string }));
}

beforeEach(() => {
  discardAllComposerDrafts();
  vi.clearAllMocks();
  localStorage.setItem('caddyai-onboarded', '1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); discardAllComposerDrafts(); });

describe('C-CHAT-8 CTI slash commands', () => {
  it('say that no CTI source is available when no host offers one', async () => {
    const messages = await runCommand({ llmAnthropicApiKey: 'synthetic-unit-test-only' } as Settings);
    expect(messages.at(-1)).toEqual(expect.objectContaining({ role: 'assistant', content: NO_SOURCES }));
    expect(state.executeHostSkill).not.toHaveBeenCalled();
  });

  it('still run the sources a configured CTI host offers', async () => {
    state.executeHostSkill.mockResolvedValue(JSON.stringify({ ok: true }));
    const messages = await runCommand({ llmAnthropicApiKey: 'synthetic-unit-test-only', agentHosts: [ctiHost('https://cti.example')] } as Settings);
    expect(state.executeHostSkill).toHaveBeenCalled();
    expect(messages.at(-1)?.content).not.toBe(NO_SOURCES);
  });

  // A legacy 'cti' host on plain http to another computer is not offered (every call to it would be refused),
  // so say why instead of claiming that hosts cannot be configured.
  it.each(['http://10.0.0.5:8443', 'http://cti.lan'])('say that a CTI host at %s needs https', async url => {
    const messages = await runCommand({ llmAnthropicApiKey: 'synthetic-unit-test-only', agentHosts: [ctiHost(url)] } as Settings);
    expect(messages.at(-1)).toEqual(expect.objectContaining({ role: 'assistant', content: NEEDS_HTTPS }));
    expect(state.executeHostSkill).not.toHaveBeenCalled();
  });

  it('keep the general answer when the plain-http CTI host is turned off', async () => {
    const messages = await runCommand({ llmAnthropicApiKey: 'synthetic-unit-test-only', agentHosts: [ctiHost('http://10.0.0.5:8443', false)] } as Settings);
    expect(messages.at(-1)).toEqual(expect.objectContaining({ role: 'assistant', content: NO_SOURCES }));
    expect(state.executeHostSkill).not.toHaveBeenCalled();
  });

  it('still run the sources of a CTI host on plain http to this computer', async () => {
    state.executeHostSkill.mockResolvedValue(JSON.stringify({ ok: true }));
    await runCommand({ llmAnthropicApiKey: 'synthetic-unit-test-only', agentHosts: [ctiHost('http://localhost:8080')] } as Settings);
    expect(state.executeHostSkill).toHaveBeenCalled();
  });
});
