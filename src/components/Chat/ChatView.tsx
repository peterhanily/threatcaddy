import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, Trash2, MessageSquare, Share2, Pencil, FileText, Key, Puzzle, Shield } from 'lucide-react';
import type { ChatThread, ChatMessage, LLMProvider, Settings, Folder, ToolUseBlock } from '../../types';
import { ChatMessageBubble } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useLLM } from '../../hooks/useLLM';
import { cn, formatDate } from '../../lib/utils';
import { nanoid } from 'nanoid';
import { TOOL_DEFINITIONS, buildSystemPrompt, executeTool, isWriteTool, fetchViaExtensionBridge } from '../../lib/llm-tools';
import { generateChatTitle } from '../../lib/chat-utils';
import { db } from '../../db';

interface ChatViewProps {
  threads: ChatThread[];
  selectedThreadId?: string;
  onSelectThread: (id: string) => void;
  onCreateThread: (partial?: Partial<ChatThread>) => Promise<ChatThread>;
  onUpdateThread: (id: string, updates: Partial<ChatThread>) => void;
  onAddMessage: (threadId: string, message: ChatMessage) => Promise<void>;
  onTrashThread: (id: string) => void;
  onShareThread?: (thread: ChatThread) => void;
  settings: Settings;
  selectedFolderId?: string;
  selectedFolder?: Folder;
  onEntitiesChanged?: () => void;
  onNavigateToEntity?: (type: string, id: string) => void;
}

export function ChatView({
  threads,
  selectedThreadId,
  onSelectThread,
  onCreateThread,
  onUpdateThread,
  onAddMessage,
  onTrashThread,
  onShareThread,
  settings,
  selectedFolderId,
  selectedFolder,
  onEntitiesChanged,
  onNavigateToEntity,
}: ChatViewProps) {
  const { extensionAvailable, streamingContent, isStreaming, error, toolActivity, sendAgentRequest, abort } = useLLM();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('caddyai-onboarded');
  });

  const dismissOnboarding = useCallback(() => {
    localStorage.setItem('caddyai-onboarded', '1');
    setShowOnboarding(false);
  }, []);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const activeThread = threads.find((t) => t.id === selectedThreadId);

  // Auto-select first thread when none selected (or stale selection) and threads exist
  useEffect(() => {
    if (threads.length > 0 && (!selectedThreadId || !threads.some(t => t.id === selectedThreadId))) {
      onSelectThread(threads[0].id);
    }
  }, [selectedThreadId, threads, onSelectThread]);

  // Scroll to bottom on new messages or streaming content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages?.length, streamingContent, toolActivity.length]);

  // Show LLM errors
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (error) setLocalError(error);
  }, [error]);

  // Compute which providers have API keys configured (must be before handleNewChat)
  const configuredProviders = useMemo(() => {
    const providers = new Set<string>();
    if (settings.llmAnthropicApiKey?.trim()) providers.add('anthropic');
    if (settings.llmOpenAIApiKey?.trim()) providers.add('openai');
    if (settings.llmGeminiApiKey?.trim()) providers.add('gemini');
    if (settings.llmMistralApiKey?.trim()) providers.add('mistral');
    if (settings.llmLocalEndpoint?.trim()) providers.add('local');
    return providers;
  }, [settings.llmAnthropicApiKey, settings.llmOpenAIApiKey, settings.llmGeminiApiKey, settings.llmMistralApiKey, settings.llmLocalEndpoint]);

  const handleNewChat = useCallback(async () => {
    try {
      let defaultModel = settings.llmDefaultModel || 'claude-sonnet-4-6';
      let defaultProvider: LLMProvider = (settings.llmDefaultProvider as LLMProvider) || 'anthropic';
      // If the default provider has no API key, pick the first configured provider
      if (configuredProviders.size > 0 && !configuredProviders.has(defaultProvider)) {
        const first = configuredProviders.values().next().value!;
        defaultProvider = first as LLMProvider;
        // Pick a sensible model for that provider
        const modelMap: Record<string, string> = {
          anthropic: 'claude-sonnet-4-6', openai: 'gpt-4.1', gemini: 'gemini-2.5-flash-preview-05-20',
          mistral: 'mistral-large-latest', local: settings.llmLocalModelName || 'local',
        };
        defaultModel = modelMap[defaultProvider] || defaultModel;
      }
      const thread = await onCreateThread({
        model: defaultModel,
        provider: defaultProvider,
        folderId: selectedFolderId,
      });
      onSelectThread(thread.id);
    } catch (err) {
      console.error('Failed to create chat thread:', err);
      setLocalError('Failed to create chat thread. Try refreshing the page.');
    }
  }, [onCreateThread, onSelectThread, settings, selectedFolderId, configuredProviders]);

  const getApiKeyForProvider = useCallback((provider: LLMProvider, s: Settings): string | undefined => {
    switch (provider) {
      case 'anthropic': return s.llmAnthropicApiKey?.trim();
      case 'openai': return s.llmOpenAIApiKey?.trim();
      case 'gemini': return s.llmGeminiApiKey?.trim();
      case 'mistral': return s.llmMistralApiKey?.trim();
      case 'local': return s.llmLocalApiKey?.trim() || 'none';
      default: return undefined;
    }
  }, []);

  const getProviderLabel = useCallback((provider: LLMProvider): string => {
    switch (provider) {
      case 'anthropic': return 'Anthropic';
      case 'openai': return 'OpenAI';
      case 'gemini': return 'Google Gemini';
      case 'mistral': return 'Mistral';
      case 'local': return 'Local LLM';
      default: return provider;
    }
  }, []);

  const handleSend = useCallback(async (text: string) => {
    if (!activeThread) return;
    setLocalError(null);

    const provider = activeThread.provider;

    // Local provider: validate endpoint is set
    if (provider === 'local' && !settings.llmLocalEndpoint) {
      setLocalError('No Local LLM endpoint configured. Add it in Settings.');
      return;
    }

    // Get API key (trim whitespace from copy-paste)
    const apiKey = getApiKeyForProvider(provider, settings);

    if (!apiKey) {
      setLocalError(`No ${getProviderLabel(provider)} API key configured. Add it in Settings.`);
      return;
    }

    // Add user message
    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };
    await onAddMessage(activeThread.id, userMsg);

    // Transform slash hint commands to natural language before sending to LLM
    const SLASH_TRANSFORMS: Record<string, (arg: string) => string> = {
      '/search':   (q) => `Search my notes for: ${q}`,
      '/note':     (t) => `Create a note titled "${t}"`,
      '/task':     (t) => `Create a task: ${t}`,
      '/iocs':     (t) => `Extract IOCs from the following text:\n${t}`,
      '/summary':  ()  => `Give me a summary of this investigation`,
      '/timeline': ()  => `List the timeline events in this investigation`,
      '/report':   ()  => `Generate a comprehensive investigation report. Analyze all notes, tasks, IOCs, and timeline events, then use the generate_report tool to create a structured report note.`,
      '/triage':   (t) => `Auto-triage the following alert/email. Extract all IOCs, create them as standalone IOCs using bulk_create_iocs, create relevant timeline events, and provide a triage summary:\n\n${t}`,
      '/graph':    ()  => `Analyze the entity relationship graph for this investigation. Identify the most connected entities, any isolated nodes, and interesting clusters or patterns.`,
      '/link':     (t) => `Search across all entities for "${t}" and suggest which ones should be linked together. Then use the link_entities tool to create the cross-references.`,
    };

    const slashMatch = text.match(/^(\/\w+)\s*([\s\S]*)$/);
    let llmText = text;
    if (slashMatch) {
      const [, cmd, arg] = slashMatch;
      const transform = SLASH_TRANSFORMS[cmd.toLowerCase()];
      if (transform) {
        llmText = transform(arg.trim());
      }
    }

    // Intercept /fetch <url> — fetch directly without LLM
    const fetchMatch = text.match(/^\/fetch\s+(https?:\/\/\S+)$/i);
    if (fetchMatch) {
      const url = fetchMatch[1];
      try {
        const result = await fetchViaExtensionBridge(url);
        if (result.success) {
          const title = result.title || new URL(url).hostname;
          const now = Date.now();
          await db.notes.add({
            id: nanoid(),
            title,
            content: result.content || '',
            folderId: selectedFolderId || undefined,
            tags: [],
            pinned: false,
            archived: false,
            trashed: false,
            createdAt: now,
            updatedAt: now,
          });
          const confirmMsg: ChatMessage = {
            id: nanoid(),
            role: 'assistant',
            content: `Created note **${title}** from ${url}`,
            createdAt: Date.now(),
          };
          await onAddMessage(activeThread.id, confirmMsg);
          onEntitiesChanged?.();
        } else {
          const errorMsg: ChatMessage = {
            id: nanoid(),
            role: 'assistant',
            content: `Failed to fetch URL: ${result.error || 'Unknown error'}`,
            createdAt: Date.now(),
          };
          await onAddMessage(activeThread.id, errorMsg);
        }
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: `Failed to fetch URL: ${(err as Error).message || String(err)}`,
          createdAt: Date.now(),
        };
        await onAddMessage(activeThread.id, errorMsg);
      }
      return;
    }

    // Build enriched system prompt with investigation context
    const systemPrompt = await buildSystemPrompt(selectedFolder, settings.llmSystemPrompt);

    // Build conversation messages (string content for history)
    // Use transformed text for the last user message so the LLM gets natural language
    const conversationMessages = [...activeThread.messages, userMsg].map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m === userMsg ? llmText : m.content,
    }));

    // Track whether any write tools were used
    let usedWriteTool = false;

    // Send with agentic loop
    sendAgentRequest(
      {
        provider: activeThread.provider,
        model: activeThread.model,
        messages: conversationMessages,
        apiKey,
        systemPrompt,
        tools: TOOL_DEFINITIONS,
        endpoint: activeThread.provider === 'local' ? settings.llmLocalEndpoint : undefined,
      },
      async (toolUse: ToolUseBlock) => {
        const result = await executeTool(toolUse, selectedFolderId);
        if (isWriteTool(toolUse.name) && !result.isError) {
          usedWriteTool = true;
        }
        return result;
      },
      async ({ content, toolCalls }) => {
        const assistantMsg: ChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content,
          model: activeThread.model,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          createdAt: Date.now(),
        };
        await onAddMessage(activeThread.id, assistantMsg);

        // Trigger entity reload if any write tools were used
        if (usedWriteTool && onEntitiesChanged) {
          onEntitiesChanged();
        }

        // Auto-generate a contextual title after first exchange
        // The initial auto-title is the truncated first user message — improve it with LLM
        if (activeThread.messages.length <= 1 && content) {
          const titleApiKey = getApiKeyForProvider(activeThread.provider, settings);
          if (titleApiKey) {
            const titleEndpoint = activeThread.provider === 'local' ? settings.llmLocalEndpoint : undefined;
            generateChatTitle(text, content, activeThread.provider, activeThread.model, titleApiKey, titleEndpoint)
              .then((title) => {
                if (title) onUpdateThread(activeThread.id, { title });
              })
              .catch(() => { /* ignore title generation failures */ });
          }
        }
      }
    );
  }, [activeThread, settings, selectedFolder, selectedFolderId, sendAgentRequest, onAddMessage, onUpdateThread, onEntitiesChanged, getApiKeyForProvider, getProviderLabel]);

  const handleModelChange = useCallback((model: string, provider: LLMProvider) => {
    if (activeThread) {
      onUpdateThread(activeThread.id, { model, provider });
    }
  }, [activeThread, onUpdateThread]);

  const handleExportAsNote = useCallback(async () => {
    if (!activeThread || activeThread.messages.length === 0) return;
    let content = `# Chat: ${activeThread.title}\n\n`;
    content += `*Exported on ${new Date().toLocaleDateString()} — Model: ${activeThread.model}*\n\n---\n\n`;
    for (const msg of activeThread.messages) {
      const label = msg.role === 'user' ? '**You:**' : '**CaddyAI:**';
      content += `${label}\n\n${msg.content}\n\n`;
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          content += `> Tool: \`${tc.name}\` — ${tc.isError ? 'Error' : 'Success'}\n\n`;
        }
      }
      content += '---\n\n';
    }
    const noteId = nanoid();
    const now = Date.now();
    await db.notes.add({
      id: noteId,
      title: `Chat Export: ${activeThread.title}`,
      content,
      folderId: selectedFolderId || undefined,
      tags: ['chat-export'],
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
    });
    onEntitiesChanged?.();
    // Navigate to the newly created note
    onNavigateToEntity?.('note', noteId);
  }, [activeThread, selectedFolderId, onEntitiesChanged, onNavigateToEntity]);

  const handleSuggestionClick = useCallback((text: string) => {
    handleSend(text);
  }, [handleSend]);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Thread list */}
      <div className="w-56 border-r border-border-subtle flex flex-col shrink-0">
        <div className="p-2 border-b border-border-subtle">
          <button
            onClick={handleNewChat}
            disabled={!extensionAvailable}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-purple text-white text-xs font-medium hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
            title={extensionAvailable ? 'Start a new chat' : 'Extension required for new chats'}
          >
            <Plus size={14} />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="p-4 text-center text-text-muted text-xs">
              No chat threads yet
            </div>
          ) : (
            threads.map((thread) => (
              <div
                key={thread.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectThread(thread.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelectThread(thread.id); }}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-b border-border-subtle',
                  selectedThreadId === thread.id
                    ? 'bg-bg-active text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                )}
              >
                <MessageSquare size={14} className="shrink-0 text-text-muted" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{thread.title}</div>
                  <div className="text-[10px] text-text-muted font-mono">{formatDate(thread.updatedAt)}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onTrashThread(thread.id); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-red-400 transition-all shrink-0"
                  title="Delete thread"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeThread ? (
          <>
            {/* Header toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle shrink-0">
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={editingTitleValue}
                  onChange={(e) => setEditingTitleValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const trimmed = editingTitleValue.trim();
                      if (trimmed) onUpdateThread(activeThread.id, { title: trimmed });
                      setEditingTitle(false);
                    } else if (e.key === 'Escape') {
                      setEditingTitle(false);
                    }
                  }}
                  onBlur={() => {
                    const trimmed = editingTitleValue.trim();
                    if (trimmed) onUpdateThread(activeThread.id, { title: trimmed });
                    setEditingTitle(false);
                  }}
                  className="flex-1 min-w-0 bg-bg-raised border border-border-subtle rounded px-2 py-1 text-sm font-medium text-text-primary focus:outline-none focus:border-purple"
                />
              ) : (
                <button
                  onClick={() => {
                    setEditingTitleValue(activeThread.title);
                    setEditingTitle(true);
                    setTimeout(() => titleInputRef.current?.select(), 0);
                  }}
                  className="flex items-center gap-1.5 min-w-0 group"
                  title="Click to rename"
                >
                  <span className="text-sm font-medium text-text-primary truncate">{activeThread.title}</span>
                  <Pencil size={12} className="shrink-0 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
              <div className="flex items-center gap-1 ml-auto shrink-0">
                {activeThread.messages.length > 0 && (
                  <button
                    onClick={handleExportAsNote}
                    className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                    title="Export as note"
                  >
                    <FileText size={14} />
                  </button>
                )}
                {onShareThread && activeThread.messages.length > 0 && (
                  <button
                    onClick={() => onShareThread(activeThread)}
                    className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                    title="Share chat"
                  >
                    <Share2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeThread.messages.length === 0 && !isStreaming && (
                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                  <MessageSquare size={40} className="mb-3 opacity-30" />
                  <p className="text-sm font-medium">Start a conversation</p>
                  <p className="text-xs mt-1">Messages are stored locally and encrypted at rest</p>
                  {selectedFolder && (
                    <p className="text-xs mt-1 text-purple/70">
                      AI can read and create entities in &ldquo;{selectedFolder.name}&rdquo;
                    </p>
                  )}
                </div>
              )}
              {activeThread.messages.map((msg, idx) => (
                <ChatMessageBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  toolCalls={msg.toolCalls}
                  onEntityClick={onNavigateToEntity}
                  onSuggestionClick={handleSuggestionClick}
                  isLastAssistant={msg.role === 'assistant' && idx === activeThread.messages.length - 1}
                />
              ))}
              {isStreaming && streamingContent && (
                <ChatMessageBubble role="assistant" content={streamingContent} isStreaming />
              )}
              {/* Tool activity indicators during streaming */}
              {isStreaming && toolActivity.length > 0 && (
                <div className="flex flex-wrap gap-1.5 ml-2 mb-2">
                  {toolActivity.map((ta) => (
                    <span
                      key={ta.id}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border',
                        ta.status === 'running'
                          ? 'border-purple/30 text-purple bg-purple/10 animate-pulse'
                          : ta.status === 'error'
                          ? 'border-red-500/30 text-red-400 bg-red-500/10'
                          : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                      )}
                    >
                      {ta.status === 'running' ? '...' : ta.status === 'error' ? '!' : '\u2713'}{' '}
                      {ta.name}
                    </span>
                  ))}
                </div>
              )}
              {localError && (
                <div className="mx-auto max-w-md my-3 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  {localError}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <ChatInput
              onSend={handleSend}
              onStop={abort}
              isStreaming={isStreaming}
              extensionAvailable={extensionAvailable}
              model={activeThread.model}
              onModelChange={handleModelChange}
              localModelName={settings.llmLocalModelName}
              configuredProviders={configuredProviders}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <MessageSquare size={48} className="mb-3 opacity-20" />
            <p className="text-lg font-medium">CaddyAI</p>
            <p className="text-sm mt-1">
              {threads.length > 0
                ? 'Select a thread to view the conversation'
                : 'AI-powered investigation assistant'}
            </p>
            {!extensionAvailable && (
              <p className="text-xs mt-3 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                Browser extension required to send new messages
              </p>
            )}
          </div>
        )}
      </div>

      {/* First-use onboarding overlay */}
      {showOnboarding && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-raised border border-border-subtle rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Getting Started with CaddyAI</h2>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-purple/15 flex items-center justify-center">
                  <Key size={16} className="text-purple" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">1. Configure an API key</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Go to Settings &gt; CaddyAI / LLM and add an API key for at least one provider (Anthropic, OpenAI, Google Gemini, Mistral) or configure a local LLM endpoint.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-purple/15 flex items-center justify-center">
                  <Puzzle size={16} className="text-purple" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">2. Install the browser extension</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    CaddyAI requires the ThreatCaddy browser extension to proxy API requests. Install it from the extension page.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-purple/15 flex items-center justify-center">
                  <Shield size={16} className="text-purple" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">3. Enable permissions</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    In the extension popup, enable &ldquo;Allow CaddyAI&rdquo; for AI provider access and &ldquo;Allow URL fetching&rdquo; for the /fetch tool.
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={dismissOnboarding}
              className="mt-6 w-full h-9 rounded-lg bg-purple text-white text-sm font-medium hover:brightness-110 transition-all"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
