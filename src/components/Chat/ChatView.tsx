import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, Trash2, MessageSquare, Share2, Pencil, FileText, Key, Puzzle, Shield, ArrowLeft, Square, RefreshCw, Eye, Play, Check, X, FolderPlus, ChevronRight, ChevronDown } from 'lucide-react';
import type { ChatThread, ChatMessage, LLMProvider, Settings, Folder, ToolUseBlock } from '../../types';
import { ClsSelect } from '../Common/ClsSelect';
import { ClsBadge } from '../Common/ClsBadge';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { ChatMessageBubble } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useLLM } from '../../hooks/useLLM';
import { DEFAULT_MODEL_PER_PROVIDER } from '../../lib/models';
import { cn, formatDate } from '../../lib/utils';
import { nanoid } from 'nanoid';
import { TOOL_DEFINITIONS, buildSystemPrompt, executeTool, isWriteTool, fetchViaExtensionBridge } from '../../lib/llm-tools';
import { getHostToolDefinitions } from '../../lib/agent-hosts';
import { generateChatTitle } from '../../lib/chat-utils';
import { truncateConversation, summarizeConversation, MAX_CONTEXT_MESSAGES } from '../../lib/chat-utils';
import { db } from '../../db';
import { useChatLoops } from '../../hooks/useChatLoops';
import { hasLoopsForThread } from '../../lib/chat-loop';
import { resolveMentions } from '../../lib/chat-mentions';
import { createCheckpoint, restoreCheckpoint } from '../../lib/checkpoints';
import { useCustomSlashCommands, interpolateTemplate } from '../../hooks/useCustomSlashCommands';
import { useToast } from '../../contexts/ToastContext';
import { supportsVision, describeImage } from '../../lib/image-ocr';
import { resolveRoutingMode } from '../../lib/llm-router';
import type { ChatAttachment } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

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
  onOpenSettings?: (tab?: string) => void;
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
  onOpenSettings,
}: ChatViewProps) {
  const { extensionAvailable, streamingContent, isStreaming, error, toolActivity, sendAgentRequest, abort } = useLLM();
  const { addToast } = useToast();
  const { serverUrl } = useAuth();
  const serverConnected = !!serverUrl;
  const effectiveRoute = resolveRoutingMode(settings.llmRoutingMode, extensionAvailable, serverConnected);
  const hasLocalLLM = !!settings.llmLocalEndpoint?.trim();
  const canChat = extensionAvailable || serverConnected || hasLocalLLM;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [threadSourceFilter, setThreadSourceFilter] = useState<'all' | 'human' | 'agent' | 'meeting'>('all');
  const [expandedChatFolders, setExpandedChatFolders] = useState<Set<string>>(new Set());
  const [showNewChatFolder, setShowNewChatFolder] = useState(false);
  const [newChatFolderName, setNewChatFolderName] = useState('');
  const [renamingChatFolderId, setRenamingChatFolderId] = useState<string | null>(null);
  const [renamingChatFolderValue, setRenamingChatFolderValue] = useState('');

  const filteredThreads = useMemo(() => threadSourceFilter === 'all'
    ? threads
    : threads.filter(t => {
        if (t.isFolder) return true; // folders always visible
        if (threadSourceFilter === 'human') return !t.source || t.source === 'user';
        if (threadSourceFilter === 'agent') return t.source === 'agent';
        if (threadSourceFilter === 'meeting') return t.source === 'agent-meeting';
        return true;
      }), [threads, threadSourceFilter]);
  const [errorHasSettingsLink, setErrorHasSettingsLink] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('caddyai-onboarded');
  });

  const dismissOnboarding = useCallback(() => {
    localStorage.setItem('caddyai-onboarded', '1');
    setShowOnboarding(false);
  }, []);
  const [trashConfirmId, setTrashConfirmId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const activeThread = threads.find((t) => t.id === selectedThreadId);
  const { loops: activeLoops, startLoop, stopAllForThread } = useChatLoops(activeThread?.id);
  const { commands: customCommands } = useCustomSlashCommands();

  // ── Image attachments ──────────────────────────────────────────────
  const [pendingImages, setPendingImages] = useState<ChatAttachment[]>([]);

  const handleImageAttach = useCallback(async (files: File[]) => {
    const attachments: ChatAttachment[] = [];
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      attachments.push({ type: 'image', data: base64, mimeType: file.type, name: file.name });
    }
    setPendingImages(prev => [...prev, ...attachments]);
  }, []);

  // ── YOLO mode — auto-approve all write tools without prompting
  const [yoloMode, setYoloMode] = useState(false);

  // ── Write tool approval flow (state declared early so handleSend can reference it)
  const [pendingApproval, setPendingApproval] = useState<{
    toolName: string;
    input: Record<string, unknown>;
    resolve: (approved: boolean) => void;
  } | null>(null);

  // Memoize system prompt — only rebuild when folder context changes
  const systemPromptRef = useRef<string>('');
  const systemPromptKeyRef = useRef<string>('');
  useEffect(() => {
    const provider = activeThread?.provider ?? 'anthropic';
    const key = `${selectedFolder?.id ?? ''}:${selectedFolder?.updatedAt ?? ''}:${settings.llmSystemPrompt ?? ''}:${provider}`;
    if (key === systemPromptKeyRef.current) return;
    systemPromptKeyRef.current = key;
    buildSystemPrompt(selectedFolder, settings.llmSystemPrompt, provider).then((prompt) => {
      systemPromptRef.current = prompt;
    });
  }, [selectedFolder, settings.llmSystemPrompt, activeThread?.provider]);

  // Auto-select first non-folder thread when none selected (or stale selection)
  useEffect(() => {
    if (threads.length > 0 && (!selectedThreadId || !threads.some(t => t.id === selectedThreadId))) {
      const first = threads.find(t => !t.isFolder);
      if (first) onSelectThread(first.id);
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
      // If there's already an empty (no messages) non-folder thread in scope, just select it
      const existingEmpty = threads.find(t =>
        !t.trashed && !t.isFolder && t.messages.length === 0 &&
        (selectedFolderId ? t.folderId === selectedFolderId : true) &&
        t.source !== 'agent'
      );
      if (existingEmpty) {
        onSelectThread(existingEmpty.id);
        return;
      }

      let defaultModel = settings.llmDefaultModel || 'claude-sonnet-4-6';
      let defaultProvider: LLMProvider = (settings.llmDefaultProvider as LLMProvider) || 'anthropic';
      // If the default provider has no API key, pick the first configured provider
      if (configuredProviders.size > 0 && !configuredProviders.has(defaultProvider)) {
        const first = configuredProviders.values().next().value!;
        defaultProvider = first as LLMProvider;
        // Pick a sensible model for that provider
        defaultModel = DEFAULT_MODEL_PER_PROVIDER[defaultProvider] || settings.llmLocalModelName || defaultModel;
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
  }, [onCreateThread, onSelectThread, settings, selectedFolderId, configuredProviders, threads]);

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
    setErrorHasSettingsLink(false);

    const provider = activeThread.provider;
    const useServerProxy = effectiveRoute === 'server';

    // Validate API key (skip when routing through server — server has its own keys)
    if (!useServerProxy) {
      if (provider === 'local' && !settings.llmLocalEndpoint) {
        setLocalError('No Local LLM endpoint configured. Add it in Settings \u2192 AI/LLM.');
        setErrorHasSettingsLink(true);
        return;
      }
      const apiKey = getApiKeyForProvider(provider, settings);
      if (!apiKey) {
        setLocalError(`No ${getProviderLabel(provider)} API key configured. Add an API key or local LLM endpoint in Settings \u2192 AI/LLM.`);
        setErrorHasSettingsLink(true);
        return;
      }
    }
    const apiKey = useServerProxy ? 'server-proxy' : getApiKeyForProvider(provider, settings);

    // Resolve @-mentions: replace tokens with labels for display, inject entity data for LLM
    const { displayText: mentionDisplayText, contextBlock: mentionContext } = await resolveMentions(text);

    // Capture and clear pending images
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;
    if (images) setPendingImages([]);

    // Add user message (with readable @-mention labels)
    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: mentionDisplayText,
      attachments: images,
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
    let llmText = text + mentionContext;
    if (slashMatch) {
      const [, cmd, arg] = slashMatch;
      const transform = SLASH_TRANSFORMS[cmd.toLowerCase()];
      if (transform) {
        llmText = transform(arg.trim());
      } else {
        // Check custom slash commands
        const cmdName = cmd.slice(1).toLowerCase();
        const custom = customCommands.find(c => c.name === cmdName);
        if (custom) {
          llmText = interpolateTemplate(custom.template, arg.trim());
        }
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

    // Intercept /loop <interval> <prompt> — start a background scheduling loop
    const loopMatch = text.match(/^\/loop\s+(\d+[smh])\s+([\s\S]+)$/i);
    if (loopMatch) {
      const [, intervalStr, prompt] = loopMatch;
      const { id: loopId, formattedInterval } = startLoop({
        threadId: activeThread.id,
        prompt,
        intervalStr,
        model: activeThread.model,
        provider: activeThread.provider,
        apiKey: apiKey!,
        systemPrompt: systemPromptRef.current || await buildSystemPrompt(selectedFolder, settings.llmSystemPrompt, activeThread.provider),
        endpoint: activeThread.provider === 'local' ? settings.llmLocalEndpoint : undefined,
        onMessage: onAddMessage,
      });
      const confirmMsg: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: `Started background loop \`${loopId}\`. Running every ${formattedInterval}:\n\n> ${prompt}\n\nUse \`/stoploop\` to stop.`,
        createdAt: Date.now(),
      };
      await onAddMessage(activeThread.id, confirmMsg);
      return;
    }

    // Intercept /stoploop — stop all loops for this thread
    if (text.match(/^\/stoploop$/i)) {
      const count = stopAllForThread(activeThread.id);
      const confirmMsg: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: count > 0
          ? `Stopped ${count} background loop${count > 1 ? 's' : ''}.`
          : 'No active loops to stop.',
        createdAt: Date.now(),
      };
      await onAddMessage(activeThread.id, confirmMsg);
      return;
    }

    // Use memoized system prompt — only rebuilt when folder context changes
    const systemPrompt = systemPromptRef.current || await buildSystemPrompt(selectedFolder, settings.llmSystemPrompt, activeThread.provider);

    // Build text-only messages for truncation, then overlay multimodal content
    const allMessages = [...activeThread.messages, userMsg];
    const textMessages = allMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m === userMsg ? llmText : m.content,
    }));

    // Truncate conversation to fit context window (use cached summary if available)
    const maxMessages = settings.llmMaxContextMessages || MAX_CONTEXT_MESSAGES;
    const truncatedTextMessages = truncateConversation(textMessages, maxMessages, activeThread.contextSummary);

    // Trigger async summarization of truncated messages for future use
    if (textMessages.length > maxMessages && !activeThread.contextSummary) {
      const truncatedPortion = textMessages.slice(2, -(maxMessages - 2));
      summarizeConversation(truncatedPortion, activeThread.provider, activeThread.model, apiKey!, activeThread.provider === 'local' ? settings.llmLocalEndpoint : undefined)
        .then((summary) => {
          if (summary) onUpdateThread(activeThread.id, { contextSummary: summary });
        })
        .catch(() => { /* ignore summarization failures */ });
    }

    // Build final messages with multimodal content blocks for images
    const isVisionCapable = supportsVision(activeThread.provider);
    const conversationMessagesPromises = truncatedTextMessages.map(async (m) => {
      const original = allMessages.find(om => om.content === m.content || (om === userMsg && m.content === llmText));
      if (original?.attachments && original.attachments.length > 0) {
        if (isVisionCapable) {
          const blocks = [
            ...original.attachments.map(att => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: att.mimeType, data: att.data },
            })),
            { type: 'text' as const, text: m.content },
          ];
          return { role: m.role, content: blocks as unknown as string };
        }
        // Fallback: describe images as text for non-vision providers
        const descriptions = await Promise.all(
          original.attachments.map(att => describeImage(att.data, att.mimeType, att.name))
        );
        return { role: m.role, content: m.content + '\n\n' + descriptions.join('\n') };
      }
      return m;
    });
    const conversationMessages = await Promise.all(conversationMessagesPromises);

    // Track whether any write tools were used
    let usedWriteTool = false;

    // In plan mode, filter out write tools so the LLM can only read/analyze
    const currentMode = activeThread.mode || 'act';
    const hostTools = getHostToolDefinitions(settings);
    const allTools = hostTools.length > 0 ? [...TOOL_DEFINITIONS, ...hostTools] : TOOL_DEFINITIONS;
    const tools = currentMode === 'plan'
      ? allTools.filter(t => !isWriteTool(t.name))
      : allTools;

    // In plan mode, append instructions to the system prompt
    const finalSystemPrompt = currentMode === 'plan'
      ? systemPrompt + '\n\nYou are in PLAN MODE. Do NOT create, update, or modify any entities. Instead, describe what you WOULD do: list the tools you would call, what data you would create, and what your analysis plan is. Present this as a structured plan the analyst can review before switching to Act mode.'
      : systemPrompt;

    // Send with agentic loop
    sendAgentRequest(
      {
        provider: activeThread.provider,
        model: activeThread.model,
        messages: conversationMessages,
        apiKey: apiKey!,
        systemPrompt: finalSystemPrompt,
        tools,
        endpoint: activeThread.provider === 'local' ? settings.llmLocalEndpoint : undefined,
        useServerProxy: effectiveRoute === 'server',
      },
      async (toolUse: ToolUseBlock) => {
        // Approval gate for write tools in Act mode (skip if yolo mode)
        if (isWriteTool(toolUse.name) && !yoloMode) {
          const approved = await new Promise<boolean>((resolve) => {
            setPendingApproval({
              toolName: toolUse.name,
              input: toolUse.input as Record<string, unknown>,
              resolve,
            });
          });

          if (!approved) {
            return {
              result: JSON.stringify({ error: 'Tool execution rejected by analyst' }),
              isError: true,
            };
          }
        }

        const result = await executeTool(toolUse, selectedFolderId);
        if (isWriteTool(toolUse.name) && !result.isError) {
          usedWriteTool = true;
        }
        return result;
      },
      async ({ content, toolCalls, usage }) => {
        const msgId = nanoid();
        const assistantMsg: ChatMessage = {
          id: msgId,
          role: 'assistant',
          content,
          model: activeThread.model,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          tokenCount: usage,
          createdAt: Date.now(),
        };
        await onAddMessage(activeThread.id, assistantMsg);

        // Create checkpoint for write tool actions (enables undo)
        if (usedWriteTool && toolCalls.length > 0) {
          createCheckpoint(activeThread.id, msgId, toolCalls).catch(() => { /* ignore checkpoint failures */ });
        }

        // Trigger entity reload if any write tools were used
        if (usedWriteTool && onEntitiesChanged) {
          onEntitiesChanged();
        }

        // Auto-generate a contextual title after first exchange
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
  }, [activeThread, settings, selectedFolder, selectedFolderId, sendAgentRequest, onAddMessage, onUpdateThread, onEntitiesChanged, getApiKeyForProvider, getProviderLabel, startLoop, stopAllForThread]);

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
    // Navigate to the newly created note — delay slightly to let the notes list reload
    setTimeout(() => onNavigateToEntity?.('note', noteId), 100);
  }, [activeThread, selectedFolderId, onEntitiesChanged, onNavigateToEntity]);

  const handleSuggestionClick = useCallback((text: string) => {
    handleSend(text);
  }, [handleSend]);

  // ── Write tool approval handlers ────────────────────────────────────
  const handleApprove = useCallback(() => {
    pendingApproval?.resolve(true);
    setPendingApproval(null);
  }, [pendingApproval]);

  const handleReject = useCallback(() => {
    pendingApproval?.resolve(false);
    setPendingApproval(null);
  }, [pendingApproval]);

  // ── Plan/Act mode ──────────────────────────────────────────────────
  const threadMode = activeThread?.mode || 'act';

  const toggleMode = useCallback(() => {
    if (!activeThread) return;
    const newMode = threadMode === 'act' ? 'plan' : 'act';
    onUpdateThread(activeThread.id, { mode: newMode });
    addToast('success', newMode === 'plan' ? 'Switched to Plan mode — AI will propose without executing' : 'Switched to Act mode — AI will execute with approval');

    // When switching from Plan to Act, if the last assistant message exists,
    // prompt the user to execute the plan
    if (newMode === 'act' && activeThread.messages.length > 0) {
      const lastMsg = activeThread.messages[activeThread.messages.length - 1];
      if (lastMsg.role === 'assistant' && lastMsg.content.length > 100) {
        // Auto-send a prompt to execute the plan
        const executeMsg: ChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: 'Switched to **Act mode**. Send "execute the plan" to run the proposed actions with approval gating, or continue the conversation.',
          createdAt: Date.now(),
        };
        onAddMessage(activeThread.id, executeMsg);
      }
    }
  }, [activeThread, threadMode, onUpdateThread, addToast, onAddMessage]);

  // ── Thread token totals ─────────────────────────────────────────────
  const threadTokenTotal = useMemo(() => {
    if (!activeThread) return 0;
    return activeThread.messages.reduce((sum, m) => {
      if (m.tokenCount) return sum + m.tokenCount.input + m.tokenCount.output;
      return sum;
    }, 0);
  }, [activeThread]);

  // ── Session rewind ──────────────────────────────────────────────────
  const [rewindConfirmIndex, setRewindConfirmIndex] = useState<number | null>(null);

  const handleRewindConfirmed = useCallback(async () => {
    if (!activeThread || rewindConfirmIndex === null) return;
    const trimmedMessages = activeThread.messages.slice(0, rewindConfirmIndex + 1);
    onUpdateThread(activeThread.id, { messages: trimmedMessages });
    setRewindConfirmIndex(null);
  }, [activeThread, rewindConfirmIndex, onUpdateThread]);

  // ── Checkpoint restore ──────────────────────────────────────────────
  const [checkpointMessageIds, setCheckpointMessageIds] = useState<Set<string>>(new Set());
  const [restoreConfirmMsgId, setRestoreConfirmMsgId] = useState<string | null>(null);

  // Load checkpoint message IDs for the active thread
  useEffect(() => {
    if (!activeThread || !db.checkpoints) return;
    db.checkpoints.where('threadId').equals(activeThread.id).toArray().then((cps) => {
      setCheckpointMessageIds(new Set(cps.filter(cp => !cp.restored).map(cp => cp.messageId)));
    });
  }, [activeThread?.id, activeThread?.messages?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRestoreCheckpointConfirmed = useCallback(async () => {
    if (!restoreConfirmMsgId) return;
    const cps = await db.checkpoints.where('messageId').equals(restoreConfirmMsgId).toArray();
    const cp = cps.find(c => !c.restored);
    if (!cp) return;

    const restored = await restoreCheckpoint(cp.id);
    if (restored) {
      setCheckpointMessageIds(prev => {
        const next = new Set(prev);
        next.delete(restoreConfirmMsgId);
        return next;
      });
      onEntitiesChanged?.();
      addToast('success', `Restored checkpoint: ${cp.snapshot.length} entity(s) reverted`);
    }
    setRestoreConfirmMsgId(null);
  }, [restoreConfirmMsgId, onEntitiesChanged, addToast]);

  // ── Session branching ──────────────────────────────────────────────
  const handleBranchFromHere = useCallback(async (messageIndex: number) => {
    if (!activeThread) return;
    const branchedMessages = activeThread.messages.slice(0, messageIndex + 1);
    const branched = await onCreateThread({
      title: `Branch: ${activeThread.title}`,
      messages: branchedMessages,
      model: activeThread.model,
      provider: activeThread.provider,
      folderId: activeThread.folderId,
      tags: [...activeThread.tags],
      clsLevel: activeThread.clsLevel,
    });
    // Add a system message to the new branch so it's clear what happened
    const branchNotice: ChatMessage = {
      id: nanoid(),
      role: 'assistant',
      content: `Branched from **${activeThread.title}** at message ${messageIndex + 1} of ${activeThread.messages.length}. You can continue this conversation independently.`,
      createdAt: Date.now(),
    };
    await onAddMessage(branched.id, branchNotice);
    onSelectThread(branched.id);
    addToast('success', `Branched conversation at message ${messageIndex + 1}`);
  }, [activeThread, onCreateThread, onSelectThread, onAddMessage, addToast]);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Thread list — hidden on mobile when a thread is selected */}
      <div className={cn(
        'w-56 border-r border-border-subtle flex flex-col shrink-0',
        activeThread ? 'hidden md:flex' : 'w-full md:w-56'
      )}>
        <div className="p-2 border-b border-border-subtle flex gap-1">
          <button
            onClick={handleNewChat}
            disabled={!canChat}
            className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-purple text-white text-xs font-medium hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100"
            title={canChat ? 'Start a new chat' : 'Extension or server connection required'}
          >
            <Plus size={14} />
            New Chat
          </button>
          <button
            onClick={() => setShowNewChatFolder(!showNewChatFolder)}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="New folder"
          >
            <FolderPlus size={14} />
          </button>
        </div>
        {showNewChatFolder && (
          <div className="px-2 py-1.5 border-b border-border-subtle flex gap-1">
            <input
              autoFocus
              className="flex-1 bg-surface-raised border border-border-default rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue"
              placeholder="Folder name..."
              value={newChatFolderName}
              onChange={e => setNewChatFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newChatFolderName.trim()) {
                  onCreateThread({ title: newChatFolderName.trim(), isFolder: true, folderId: selectedFolderId, messages: [], tags: ['chat-folder'] } as Partial<ChatThread>);
                  setNewChatFolderName('');
                  setShowNewChatFolder(false);
                } else if (e.key === 'Escape') {
                  setShowNewChatFolder(false);
                }
              }}
            />
            <button
              onClick={() => {
                if (newChatFolderName.trim()) {
                  onCreateThread({ title: newChatFolderName.trim(), isFolder: true, folderId: selectedFolderId, messages: [], tags: ['chat-folder'] } as Partial<ChatThread>);
                  setNewChatFolderName('');
                  setShowNewChatFolder(false);
                }
              }}
              disabled={!newChatFolderName.trim()}
              className="text-xs px-2 py-1 rounded bg-accent-blue text-white disabled:opacity-40"
            >
              Create
            </button>
          </div>
        )}
        {/* Thread source filter */}
        <div className="flex gap-1 px-3 py-1.5 border-b border-border-subtle" role="tablist" aria-label="Filter threads by source">
          {(['all', 'human', 'agent', 'meeting'] as const).map(f => (
            <button
              key={f}
              role="tab"
              aria-selected={threadSourceFilter === f}
              onClick={() => setThreadSourceFilter(f)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded capitalize transition-colors',
                threadSourceFilter === f
                  ? 'bg-surface-raised text-text-primary font-medium'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredThreads.length === 0 ? (
            <div className="p-4 text-center text-text-muted text-xs">
              {threads.length === 0 ? 'No chat threads yet' : `No ${threadSourceFilter} threads`}
            </div>
          ) : (() => {
            // Separate folders and top-level threads, then build ordered list
            const chatFolders = filteredThreads.filter(t => t.isFolder);
            const topLevel = filteredThreads.filter(t => !t.isFolder && !t.parentThreadId);
            const childOf = (fId: string) => filteredThreads.filter(t => !t.isFolder && t.parentThreadId === fId);

            const renderThread = (thread: ChatThread, indented = false) => (
              <div
                key={thread.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectThread(thread.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelectThread(thread.id); }}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', thread.id)}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-b border-border-subtle',
                  indented && 'pl-7',
                  selectedThreadId === thread.id
                    ? 'bg-bg-active text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                )}
              >
                <MessageSquare size={14} className="shrink-0 text-text-muted" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-xs font-medium truncate">
                    {thread.title}
                    {thread.source === 'agent' && (
                      <span className="shrink-0 text-[8px] px-1 py-px rounded bg-accent-blue/10 text-accent-blue font-normal">agent</span>
                    )}
                    {thread.source === 'agent-meeting' && (
                      <span className="shrink-0 text-[8px] px-1 py-px rounded bg-purple/10 text-purple font-normal">meeting</span>
                    )}
                    {hasLoopsForThread(thread.id) && (
                      <RefreshCw size={10} className="shrink-0 text-purple animate-spin" style={{ animationDuration: '3s' }} />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-text-muted font-mono">
                    <span>{formatDate(thread.updatedAt)}</span>
                    {thread.clsLevel && <ClsBadge level={thread.clsLevel} />}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setTrashConfirmId(thread.id); }}
                  className="opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-red-400 transition-all shrink-0"
                  title="Delete thread"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );

            return (
              <>
                {/* Chat folders */}
                {chatFolders.map(folder => {
                  const children = childOf(folder.id);
                  const expanded = expandedChatFolders.has(folder.id);
                  return (
                    <div key={folder.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={expandedChatFolders.has(folder.id)}
                        className={cn(
                          'group flex items-center gap-1.5 px-3 py-2 cursor-pointer transition-colors border-b border-border-subtle',
                          'text-text-secondary hover:bg-bg-hover',
                        )}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const next = new Set(expandedChatFolders); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); setExpandedChatFolders(next); } }}
                        onClick={() => {
                          const next = new Set(expandedChatFolders);
                          if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
                          setExpandedChatFolders(next);
                        }}
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('ring-1', 'ring-accent-blue'); }}
                        onDragLeave={(e) => { e.currentTarget.classList.remove('ring-1', 'ring-accent-blue'); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('ring-1', 'ring-accent-blue');
                          const draggedId = e.dataTransfer.getData('text/plain');
                          if (draggedId && draggedId !== folder.id) {
                            onUpdateThread(draggedId, { parentThreadId: folder.id });
                          }
                        }}
                      >
                        {expanded ? <ChevronDown size={12} className="text-accent-blue shrink-0" /> : <ChevronRight size={12} className="text-accent-amber shrink-0" />}
                        <span className="text-sm">📁</span>
                        {renamingChatFolderId === folder.id ? (
                          <input
                            autoFocus
                            className="flex-1 text-xs font-medium bg-surface-raised border border-accent-blue rounded px-1 py-0.5 text-text-primary outline-none"
                            value={renamingChatFolderValue}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setRenamingChatFolderValue(e.target.value)}
                            onKeyDown={e => {
                              e.stopPropagation();
                              if (e.key === 'Enter' && renamingChatFolderValue.trim()) {
                                onUpdateThread(folder.id, { title: renamingChatFolderValue.trim() });
                                setRenamingChatFolderId(null);
                              } else if (e.key === 'Escape') setRenamingChatFolderId(null);
                            }}
                            onBlur={() => {
                              if (renamingChatFolderValue.trim() && renamingChatFolderValue.trim() !== folder.title) {
                                onUpdateThread(folder.id, { title: renamingChatFolderValue.trim() });
                              }
                              setRenamingChatFolderId(null);
                            }}
                          />
                        ) : (<>
                          <span className="flex-1 text-xs font-medium truncate">{folder.title}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setRenamingChatFolderId(folder.id); setRenamingChatFolderValue(folder.title); }}
                            className="text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all shrink-0"
                            title="Rename folder"
                            aria-label={`Rename ${folder.title}`}
                          >
                            <Pencil size={10} />
                          </button>
                        </>)}
                        <span className="text-[9px] text-text-muted">{children.length}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setTrashConfirmId(folder.id); }}
                          className="opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-red-400 transition-all shrink-0"
                          title="Delete folder"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                      {expanded && children.map(t => renderThread(t, true))}
                    </div>
                  );
                })}
                {/* Top-level threads (no folder) */}
                {topLevel.map(t => renderThread(t))}
              </>
            );
          })()}
        </div>
      </div>

      {/* Chat area — hidden on mobile when no thread selected */}
      <div className={cn('flex-1 flex flex-col min-w-0', !activeThread && 'hidden md:flex')}>
        {activeThread ? (
          <>
            {/* Header toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle shrink-0">
              {/* Mobile back button */}
              <button
                onClick={() => onSelectThread('')}
                className="md:hidden p-1.5 -ml-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Back to threads"
              >
                <ArrowLeft size={18} />
              </button>
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
                  aria-label="Chat thread title"
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
                  <Pencil size={12} className="shrink-0 text-text-muted opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" />
                </button>
              )}
              <div className="flex items-center gap-1 ml-auto shrink-0">
                <button
                  onClick={toggleMode}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors mr-1',
                    threadMode === 'plan'
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                  )}
                  title={threadMode === 'plan' ? 'Plan mode: AI proposes but does not execute write actions' : 'Act mode: AI executes actions with approval'}
                >
                  {threadMode === 'plan' ? <Eye size={10} /> : <Play size={10} />}
                  {threadMode === 'plan' ? 'Plan' : 'Act'}
                </button>
                <button
                  onClick={() => setYoloMode(!yoloMode)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors mr-1',
                    yoloMode
                      ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                      : 'bg-surface-raised border-border-subtle text-text-muted hover:text-text-secondary'
                  )}
                  title={yoloMode ? 'YOLO mode ON — all tool calls auto-approved' : 'Click to enable YOLO mode (auto-approve all actions)'}
                >
                  <Shield size={10} />
                  {yoloMode ? 'YOLO' : 'Safe'}
                </button>
                {threadTokenTotal > 0 && (
                  <span className={cn(
                    'text-[10px] font-mono px-1.5 py-0.5 rounded border mr-1',
                    settings.llmTokenBudget && threadTokenTotal > settings.llmTokenBudget
                      ? 'text-red-400 bg-red-500/10 border-red-500/20'
                      : settings.llmTokenBudget && threadTokenTotal > settings.llmTokenBudget * 0.8
                      ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                      : 'text-text-muted bg-bg-deep border-border-subtle'
                  )} title={`Total tokens: ${threadTokenTotal.toLocaleString()}${settings.llmTokenBudget ? ` / ${settings.llmTokenBudget.toLocaleString()} budget` : ''}`}>
                    {threadTokenTotal >= 1000 ? `${(threadTokenTotal / 1000).toFixed(1)}k` : threadTokenTotal} tok
                  </span>
                )}
                {activeLoops.length > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple/10 border border-purple/20 text-[10px] text-purple mr-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple animate-pulse" />
                    {activeLoops.length} loop{activeLoops.length > 1 ? 's' : ''}
                    <button
                      onClick={() => stopAllForThread(activeThread.id)}
                      className="ml-0.5 hover:text-red-400 transition-colors"
                      title="Stop all loops"
                    >
                      <Square size={10} />
                    </button>
                  </div>
                )}
                <ClsSelect
                  value={activeThread.clsLevel}
                  onChange={(clsLevel) => onUpdateThread(activeThread.id, { clsLevel })}
                  clsLevels={settings?.tiClsLevels}
                />
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
            <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
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
                  attachments={msg.attachments}
                  toolCalls={msg.toolCalls}
                  onEntityClick={onNavigateToEntity}
                  onSuggestionClick={handleSuggestionClick}
                  isLastAssistant={msg.role === 'assistant' && idx === activeThread.messages.length - 1}
                  messageIndex={idx}
                  onBranchFromHere={handleBranchFromHere}
                  onRewindToHere={setRewindConfirmIndex}
                  tokenCount={msg.tokenCount}
                  messageId={msg.id}
                  onRestoreCheckpoint={setRestoreConfirmMsgId}
                  hasCheckpoint={checkpointMessageIds.has(msg.id)}
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
              {/* Write tool approval card */}
              {pendingApproval && (
                <div className="mx-auto max-w-md my-3 rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-amber-500/20 flex items-center gap-2">
                    <Shield size={14} className="text-amber-400" />
                    <span className="text-xs font-medium text-amber-400">Approve write action?</span>
                  </div>
                  <div className="px-4 py-2.5 space-y-1.5">
                    <div className="text-xs">
                      <span className="font-mono font-medium text-purple">{pendingApproval.toolName}</span>
                    </div>
                    <pre className="text-[10px] font-mono text-text-secondary bg-bg-deep rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {JSON.stringify(pendingApproval.input, null, 2)}
                    </pre>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleApprove}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors"
                      >
                        <Check size={12} /> Approve
                      </button>
                      <button
                        onClick={handleReject}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
                      >
                        <X size={12} /> Reject
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {localError && (
                <div className="mx-auto max-w-md my-3 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  {errorHasSettingsLink && onOpenSettings ? (
                    <span>
                      {localError.replace(/Settings \u2192 AI\/LLM\.?/, '')}{' '}
                      <button
                        onClick={() => onOpenSettings('ai')}
                        className="underline hover:text-red-300 font-medium"
                      >
                        Settings &rarr; AI/LLM
                      </button>
                    </span>
                  ) : (
                    localError
                  )}
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
              onOpenSettings={onOpenSettings ? () => onOpenSettings('ai') : undefined}
              folderId={selectedFolderId}
              customCommands={customCommands.map(c => ({ command: `/${c.name}`, description: c.description }))}
              onImageAttach={handleImageAttach}
              attachedImages={pendingImages.map(a => ({ name: a.name || 'Image' }))}
              onClearImages={() => setPendingImages([])}
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
            {!canChat && (
              <p className="text-xs mt-3 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                Browser extension or team server connection required
              </p>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={trashConfirmId !== null}
        onClose={() => setTrashConfirmId(null)}
        onConfirm={() => {
          if (trashConfirmId) {
            // If deleting a folder, move children to top level first
            const folder = threads.find(t => t.id === trashConfirmId && t.isFolder);
            if (folder) {
              threads.filter(t => t.parentThreadId === folder.id).forEach(t => onUpdateThread(t.id, { parentThreadId: undefined }));
            }
            onTrashThread(trashConfirmId);
          }
          setTrashConfirmId(null);
        }}
        title="Delete Chat Thread"
        message={threads.find(t => t.id === trashConfirmId)?.isFolder ? "This folder and its organization will be removed. Threads inside will be moved to the top level." : "This chat thread will be moved to trash. Are you sure?"}
        confirmLabel="Delete"
        danger
      />

      <ConfirmDialog
        open={rewindConfirmIndex !== null}
        onClose={() => setRewindConfirmIndex(null)}
        onConfirm={handleRewindConfirmed}
        title="Rewind Conversation"
        message={`This will delete ${activeThread ? activeThread.messages.length - (rewindConfirmIndex ?? 0) - 1 : 0} message(s) after this point. This cannot be undone. Use Branch instead to preserve the full history.`}
        confirmLabel="Rewind"
        danger
      />

      <ConfirmDialog
        open={restoreConfirmMsgId !== null}
        onClose={() => setRestoreConfirmMsgId(null)}
        onConfirm={handleRestoreCheckpointConfirmed}
        title="Restore Checkpoint"
        message="This will undo the AI's changes — created entities will be deleted and modified entities will be reverted to their previous state. This cannot be undone."
        confirmLabel="Restore"
        danger
      />

      {/* First-use onboarding overlay */}
      {showOnboarding && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-xl">
          <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl shadow-2xl p-6 max-w-md mx-4 w-full">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Getting Started with CaddyAI</h3>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Key size={16} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">1. Configure an API key</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Go to Settings &gt; CaddyAI / LLM and add an API key for at least one provider (<a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Anthropic</a>, <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">OpenAI</a>, <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google Gemini</a>, <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Mistral</a>) or configure a local LLM endpoint.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Puzzle size={16} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">2. Install the browser extension</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">CaddyAI requires the ThreatCaddy <a href="https://chromewebstore.google.com/detail/threatcaddy-%E2%80%94-quick-captu/lakelgngpkkaeinfdlnmifookbeeffbh" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">browser extension</a> to proxy API requests.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Shield size={16} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">3. Enable permissions</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">In the extension popup, enable &ldquo;Allow CaddyAI&rdquo; for AI provider access and &ldquo;Allow URL fetching&rdquo; for the /fetch tool.</p>
                </div>
              </div>
            </div>
            <button
              onClick={dismissOnboarding}
              className="w-full mt-5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
