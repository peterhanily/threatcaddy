import { persistChatCompletion } from '../../lib/locked-chat-recovery';
import { useState, useEffect, useRef, useCallback, useMemo, useId, useSyncExternalStore, type KeyboardEvent } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Plus, Trash2, MessageSquare, Share2, Pencil, FileText, Key, Puzzle, Shield, ArrowLeft, Square, RefreshCw, Eye, Play, FolderPlus, ChevronRight, ChevronDown } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import type { ChatThread, ChatMessage, LLMProvider, Settings, ToolUseBlock } from '../../types';
import { ClsSelect } from '../Common/ClsSelect';
import { ClsBadge } from '../Common/ClsBadge';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { ChatMessageBubble } from './ChatMessage';
import { ChatApprovalCard, ChatApprovalStatus } from './ChatApprovalCard';
import { AgentCycleSummaryCard } from '../Agent/AgentCycleSummaryCard';
import { ChatInput } from './ChatInput';
import { useLLM } from '../../hooks/useLLM';
import { DEFAULT_MODEL_PER_PROVIDER } from '../../lib/models';
import { cn, formatDate } from '../../lib/utils';
import { nanoid } from 'nanoid';
import { TOOL_DEFINITIONS, buildSystemPrompt, isWriteTool, fetchViaExtensionBridge } from '../../lib/llm-tools';
import { getHostToolDefinitions, executeHostSkill, isHttpsOrLoopback } from '../../lib/agent-hosts';
import { mintHumanApproval, type HumanApproval } from '../../lib/human-approval';
import { createChatToolExecutor, type ApprovalItem } from '../../lib/chat-tool-executor';
import { isPlanModeTool } from '../../lib/tool-reach';
import { parseCtiSlashCommand, planCtiSourceRequests, normalizeCtiSourceRunResult, renderCtiRunMarkdown } from '../../lib/cti-source-formatting';
import { generateChatTitle } from '../../lib/chat-utils';
import { truncateConversation, summarizeConversation, MAX_CONTEXT_MESSAGES } from '../../lib/chat-utils';
import { db } from '../../db';
import { useChatLoops } from '../../hooks/useChatLoops';
import { hasLoopsForThread, type LoopTransport } from '../../lib/chat-loop';
import { hasMentionToken, resolveMentions } from '../../lib/chat-mentions';
import { isShareableFolder } from '../../lib/ai-scope';
import { isSyncWorkspaceBound } from '../../lib/sync-workspace';
import { executeCheckpointedTool, restoreCheckpoint } from '../../lib/checkpoints';
import { useCustomSlashCommands, interpolateTemplate } from '../../hooks/useCustomSlashCommands';
import { useToast } from '../../contexts/ToastContext';
import { supportsVision, describeImage } from '../../lib/image-ocr';
import { hasServerSession, resolveRoute, unavailableRouteError } from '../../lib/llm-router';
import { chatThreadGroups } from '../../lib/folder-tree';
import { useImageAttachments } from '../../hooks/useImageAttachments';
import { hasComposerDrafts, subscribeComposerDrafts, discardAllComposerDrafts } from '../../lib/chat-composer-drafts';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useInvestigation } from '../../contexts/InvestigationContext';
import { useScreenshare } from '../../hooks/ScreenshareContext';

/** Strip tool call JSON from streaming content (local LLMs output tool calls as text). */
// Regexes hoisted to module scope — compiled once, not per render frame
const RE_COMPLETE_TAG = new RegExp('<(?:tool_call|function_call)>[\\s\\S]*?</(?:tool_call|function_call)>', 'gi');
const RE_OPEN_TAG = new RegExp('<(?:tool_call|function_call)>[\\s\\S]*$', 'i');
const RE_COMPLETE_JSON = new RegExp('```json\\s*\\n?\\s*\\{\\s*"name"\\s*:[\\s\\S]*?```', 'gi');
const RE_PARTIAL_JSON = new RegExp('```json\\s*\\n?\\s*\\{\\s*"name"\\s*:[\\s\\S]*$', 'i');

function cleanStreamingContent(text: string): string {
  let cleaned = text.replace(RE_COMPLETE_TAG, '').replace(RE_COMPLETE_JSON, '');
  const openMatch = cleaned.match(RE_OPEN_TAG);
  if (openMatch?.index !== undefined) cleaned = cleaned.slice(0, openMatch.index);
  const jsonMatch = cleaned.match(RE_PARTIAL_JSON);
  if (jsonMatch?.index !== undefined) cleaned = cleaned.slice(0, jsonMatch.index);
  return cleaned.trim();
}

interface ChatViewProps {
  threads: ChatThread[];
  onCreateThread: (partial?: Partial<ChatThread>) => Promise<ChatThread>;
  onUpdateThread: (id: string, updates: Partial<ChatThread>) => void;
  onAddMessage: (threadId: string, message: ChatMessage) => Promise<void>;
  onTrashThread: (id: string) => void;
  onShareThread?: (thread: ChatThread) => void;
  settings: Settings;
  onEntitiesChanged?: () => void;
  onNavigateToEntity?: (type: string, id: string) => void;
  onOpenSettings?: (tab?: string) => void;
}

/** A queued approval card; resolve(null) rejects it. */
interface PendingApproval {
  id: string;
  item: ApprovalItem;
  threadId: string;
  resolve: (approval: HumanApproval | null) => void;
}

export function ChatView({
  threads,
  onCreateThread,
  onUpdateThread,
  onAddMessage,
  onTrashThread,
  onShareThread,
  settings,
  onEntitiesChanged,
  onNavigateToEntity,
  onOpenSettings,
}: ChatViewProps) {
  const { selectedChatThreadId: selectedThreadId, setSelectedChatThreadId: onSelectThread } = useNavigation();
  const { selectedFolderId, selectedFolder } = useInvestigation();
  const { maxLevel: screenshareMaxLevel } = useScreenshare();
  const { extensionAvailable, streamingContent, isStreaming, error, toolActivity, sendAgentRequest, abort } = useLLM();
  const { t } = useTranslation('chat');
  const { addToast } = useToast();
  // Re-render on sign-in and sign-out. The route reads the stored session, as Settings → AI does.
  useAuth();
  const serverSession = hasServerSession();
  // Where cloud models go; a local model with an endpoint is always called directly.
  const cloudRoute = resolveRoute(settings, { extensionAvailable, serverSession }).route;
  const localRoute = resolveRoute(settings, { extensionAvailable, serverSession, provider: 'local' }).route;
  const hasLocalLLM = !!settings.llmLocalEndpoint?.trim();
  const canChat = extensionAvailable || serverSession || hasLocalLLM;
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
  const { images: pendingImages, setImages: setPendingImages, attach: handleImageAttach,
    clear: clearImages, reading: readingImages } = useImageAttachments(selectedThreadId, code => {
    setErrorHasSettingsLink(false);
    setLocalError(t(`input.imageError.${code}`));
  });
  const hasDrafts = useSyncExternalStore(subscribeComposerDrafts, hasComposerDrafts);
  const [discardDraftsOpen, setDiscardDraftsOpen] = useState(false);

  // ── YOLO mode — auto-approve in-scope changes and passive lookups; the decision table still asks for the rest
  const [yoloMode, setYoloMode] = useState(false);
  const yoloDescriptionId = useId();
  // Track which thread is streaming so we don't show stale content on thread switch
  const streamingThreadRef = useRef<string | undefined>(undefined);
  const yoloModeRef = useRef(false);
  useEffect(() => { yoloModeRef.current = yoloMode; }, [yoloMode]);

  // ── Tool approval queue, one card at a time, oldest first (declared early so handleSend can reference it)
  const approvalQueueRef = useRef<PendingApproval[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const settleApproval = useCallback((id: string, approval: HumanApproval | null) => {
    const entry = approvalQueueRef.current.find(pending => pending.id === id);
    if (!entry) return;
    approvalQueueRef.current = approvalQueueRef.current.filter(pending => pending !== entry);
    setPendingApprovals(approvalQueueRef.current);
    entry.resolve(approval);
  }, []);

  // Auto-select first non-folder thread when none selected (or stale selection)
  useEffect(() => {
    // App keeps this view mounted but hidden while sharing. Privacy filtering
    // must not replace the retained thread or its unsent input/attachments.
    if (screenshareMaxLevel !== null) return;
    if (threads.length > 0 && (!selectedThreadId || !threads.some(t => t.id === selectedThreadId))) {
      const first = threads.find(t => !t.isFolder);
      if (first) onSelectThread(first.id);
    }
  }, [selectedThreadId, threads, onSelectThread, screenshareMaxLevel]);

  // Scroll to bottom on new messages or streaming content
  useEffect(() => {
    if (screenshareMaxLevel !== null) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages?.length, streamingContent, toolActivity.length, screenshareMaxLevel]);

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
      // Also check source !== 'agent-meeting' and that it's not the currently selected (possibly just-trashed) thread
      const existingEmpty = threads.find(t =>
        !t.trashed && !t.isFolder && t.messages.length === 0 &&
        t.id !== selectedThreadId &&
        (selectedFolderId ? t.folderId === selectedFolderId : true) &&
        t.source !== 'agent' && t.source !== 'agent-meeting'
      );
      if (existingEmpty) {
        onSelectThread(existingEmpty.id);
        return;
      }

      let defaultModel = settings.llmDefaultModel || 'claude-sonnet-4-6';
      let defaultProvider: LLMProvider = (settings.llmDefaultProvider as LLMProvider) || 'anthropic';
      // If the default provider has no API key, pick the first configured provider
      if (cloudRoute !== 'server' && configuredProviders.size > 0 && !configuredProviders.has(defaultProvider)) {
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
      setLocalError(t('view.errorCreateThread'));
    }
  }, [onCreateThread, onSelectThread, settings, selectedFolderId, configuredProviders, threads, selectedThreadId, cloudRoute, t]);

  const getApiKeyForProvider = useCallback((provider: LLMProvider, s: Settings): string | undefined => {
    switch (provider) {
      case 'anthropic': return s.llmAnthropicApiKey?.trim();
      case 'openai': return s.llmOpenAIApiKey?.trim();
      case 'gemini': return s.llmGeminiApiKey?.trim();
      case 'mistral': return s.llmMistralApiKey?.trim();
      case 'local': return s.llmLocalApiKey?.trim() || 'local';
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

  // Where a prompt to this provider goes now (the route Settings → AI shows), or why it cannot be sent.
  // Chat sends and every /loop run use it, so a schedule never keeps the route it started with.
  const resolveTransport = useCallback(async (provider: LLMProvider): Promise<LoopTransport> => {
    const route = resolveRoute(settings, { extensionAvailable, serverSession: hasServerSession(), provider });
    if (route.route === 'unavailable') return { error: await unavailableRouteError(route.reason) };
    // The server has its own keys.
    if (route.route === 'server') return { useServerProxy: true, apiKey: 'server-proxy' };
    if (provider === 'local' && !settings.llmLocalEndpoint) return { error: t('view.errorNoLocalEndpoint') };
    const apiKey = getApiKeyForProvider(provider, settings);
    if (!apiKey) return { error: t('view.errorNoApiKey', { provider: getProviderLabel(provider) }) };
    return { useServerProxy: false, apiKey, endpoint: provider === 'local' ? settings.llmLocalEndpoint : undefined };
  }, [settings, extensionAvailable, getApiKeyForProvider, getProviderLabel, t]);
  const resolveTransportRef = useRef(resolveTransport);
  useEffect(() => { resolveTransportRef.current = resolveTransport; }, [resolveTransport]);

  const handleSend = useCallback(async (text: string, onCommitted?: () => void) => {
    if (!activeThread || readingImages) return;
    setLocalError(null);
    setErrorHasSettingsLink(false);

    const provider = activeThread.provider;
    const currentTokenTotal = activeThread.messages.reduce((sum, message) => sum + (message.tokenCount ? message.tokenCount.input + message.tokenCount.output : 0), 0);

    // CTI slash commands run allowlisted host tools directly (no LLM call), so they
    // must NOT be gated behind the LLM route / API-key / token-budget checks below.
    const isDirectCtiCommand = parseCtiSlashCommand(text) !== null;
    // /fetch <url> saves a page through the extension and /stoploop stops schedules; neither calls a model,
    // so the AI route, API key and token budget do not gate them.
    const isFetchCommand = /^\/fetch\s+https?:\/\/\S+$/i.test(text);
    const isStopLoopCommand = /^\/stoploop$/i.test(text);

    // No route or no key: say why and send nothing.
    const transport = isDirectCtiCommand || isFetchCommand || isStopLoopCommand ? { useServerProxy: false, apiKey: undefined } : await resolveTransport(provider);
    if ('error' in transport) {
      setLocalError(transport.error);
      setErrorHasSettingsLink(true);
      return;
    }
    const { useServerProxy, apiKey } = transport;

    // Hard token budget cap — prevent sending when over budget
    if (!isDirectCtiCommand && !isFetchCommand && !isStopLoopCommand && settings.llmTokenBudget && currentTokenTotal > settings.llmTokenBudget) {
      setLocalError(t('view.errorOverBudget', `Token budget exceeded (${currentTokenTotal.toLocaleString()} / ${settings.llmTokenBudget.toLocaleString()}). Start a new thread or increase the budget in Settings > AI.`));
      return;
    }

    // Resolve @-mentions: replace tokens with labels for display, inject entity data for LLM
    const { displayText: mentionDisplayText, contextBlock: mentionContext } = await resolveMentions(text, activeThread.folderId ?? selectedFolderId);

    // Retain the draft's images until the user message is actually saved.
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;

    // Add user message (with readable @-mention labels)
    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: mentionDisplayText,
      attachments: images,
      createdAt: Date.now(),
    };
    await onAddMessage(activeThread.id, userMsg);
    if (images) setPendingImages(previous => previous.filter(image => !images.includes(image)));
    onCommitted?.();

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

    // The conversation's investigation: its tools, prompt and /fetch notes work where its messages sync.
    const homeFolderId = activeThread.folderId ?? selectedFolderId ?? undefined;

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
            folderId: homeFolderId,
            tags: [],
            pinned: false,
            archived: false,
            trashed: false,
            createdAt: now,
            updatedAt: now,
          });
          // Say where the note went: the sidebar may show another investigation, or none. Nothing syncs before a team server is connected.
          const shareableKey = await isSyncWorkspaceBound() ? 'approval.targetSynced' : 'approval.targetSyncsLater';
          const destination = homeFolderId
            ? t(await isShareableFolder(homeFolderId) ? shareableKey : 'approval.targetLocal', { name: (await db.folders.get(homeFolderId))?.name ?? homeFolderId })
            : t('approval.unfiled');
          const confirmMsg: ChatMessage = {
            id: nanoid(),
            role: 'assistant',
            content: `${t('fetch.createdNote', { title, url })}\n\n${destination}`,
            createdAt: Date.now(),
          };
          await onAddMessage(activeThread.id, confirmMsg);
          onEntitiesChanged?.();
        } else {
          const errorMsg: ChatMessage = {
            id: nanoid(),
            role: 'assistant',
            content: t('fetch.failed', { error: result.error || t('fetch.unknownError') }),
            createdAt: Date.now(),
          };
          await onAddMessage(activeThread.id, errorMsg);
        }
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: t('fetch.failed', { error: (err as Error).message || String(err) }),
          createdAt: Date.now(),
        };
        await onAddMessage(activeThread.id, errorMsg);
      }
      return;
    }

    const homeFolder = homeFolderId === selectedFolderId ? selectedFolder : homeFolderId ? await db.folders.get(homeFolderId) : undefined;

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
        systemPrompt: await buildSystemPrompt(homeFolder, settings.llmSystemPrompt, activeThread.provider),
        endpoint: activeThread.provider === 'local' ? settings.llmLocalEndpoint : undefined,
        useServerProxy,
        transport: () => resolveTransportRef.current(provider),
        onMessage: onAddMessage,
      });
      const confirmMsg: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: `${t('loop.started', { id: loopId, interval: formattedInterval })}\n\n> ${prompt}\n\n${t('loop.stopHint')}`,
        createdAt: Date.now(),
      };
      await onAddMessage(activeThread.id, confirmMsg);
      return;
    }

    // Intercept /stoploop — stop all loops for this thread
    if (isStopLoopCommand) {
      const count = stopAllForThread(activeThread.id);
      const confirmMsg: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: count > 0 ? t('loop.stopped', { count }) : t('loop.noneToStop'),
        createdAt: Date.now(),
      };
      await onAddMessage(activeThread.id, confirmMsg);
      return;
    }

    // Intercept CTI source slash commands (/vt, /censys, /flashpoint, /cti, /all, …) —
    // run allowlisted CTI Agent Host tools directly and render deterministic markdown (no LLM).
    const ctiCommand = parseCtiSlashCommand(text);
    if (ctiCommand) {
      const availableToolNames = getHostToolDefinitions(settings).map((d) => d.name);
      const { planned, skipped, validationErrors } = planCtiSourceRequests(ctiCommand, availableToolNames);
      if (validationErrors.length > 0) {
        await onAddMessage(activeThread.id, {
          id: nanoid(),
          role: 'assistant',
          content: `${t('cti.invalidCommand')}\n\n${validationErrors.map((e) => `- ${e}`).join('\n')}`,
          createdAt: Date.now(),
        });
        return;
      }
      const results = await Promise.all(planned.map(async (plan) => {
        try {
          const raw = await executeHostSkill(plan.tool, plan.input, settings);
          return normalizeCtiSourceRunResult(plan, raw);
        } catch (err) {
          return normalizeCtiSourceRunResult(plan, (err as Error).message || String(err));
        }
      }));
      // A legacy 'cti' host on plain http to another computer is not offered: say so rather than that hosts are unconfigurable.
      const ctiNeedsHttps = (settings.agentHosts ?? []).some(host => host.name === 'cti' && host.enabled && host.skills.length > 0 && !isHttpsOrLoopback(host.url));
      await onAddMessage(activeThread.id, {
        id: nanoid(),
        role: 'assistant',
        content: !availableToolNames.some(name => name.startsWith('host:cti:'))
          ? t(ctiNeedsHttps ? 'cti.hostNeedsHttps' : 'cti.noSourcesV2')
          : renderCtiRunMarkdown(ctiCommand.target, results, skipped),
        createdAt: Date.now(),
      });
      return;
    }

    // Build for this submission's scope. A shared async cache can complete out
    // of order after an investigation switch and attach another case's context.
    const systemPrompt = await buildSystemPrompt(homeFolder, settings.llmSystemPrompt, activeThread.provider);

    // Build text-only messages for truncation, then overlay multimodal content
    const allMessages = [...activeThread.messages, userMsg];
    const textMessages = allMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m === userMsg ? llmText : m.content,
    }));

    // Truncate conversation to fit context window (use cached summary if available)
    const maxMessages = settings.llmMaxContextMessages || MAX_CONTEXT_MESSAGES;
    const truncatedTextMessages = truncateConversation(textMessages, maxMessages, activeThread.contextSummary);

    // Title and summary requests go through the extension only, so they never run while chat goes through
    // the team server. The extension sends any key it gets as a bearer token, so a local model without a
    // key of its own gets none (chat's 'local' placeholder is for sendDirectToLocal, which drops it).
    const extensionApiKey = provider === 'local' ? settings.llmLocalApiKey?.trim() || '' : apiKey!;

    // Trigger async summarization of truncated messages for future use.
    if (!useServerProxy && textMessages.length > maxMessages && !activeThread.contextSummary) {
      const truncatedPortion = textMessages.slice(2, -(maxMessages - 2));
      summarizeConversation(truncatedPortion, activeThread.provider, activeThread.model, extensionApiKey, activeThread.provider === 'local' ? settings.llmLocalEndpoint : undefined)
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
    const assistantMessageId = nanoid();
    const checkpointContext = { id: nanoid(), threadId: activeThread.id, messageId: assistantMessageId };

    // In plan mode, offer only reads of this investigation
    const currentMode = activeThread.mode || 'act';
    const hostTools = getHostToolDefinitions(settings);
    const allTools = hostTools.length > 0 ? [...TOOL_DEFINITIONS, ...hostTools] : TOOL_DEFINITIONS;
    const tools = currentMode === 'plan'
      ? allTools.filter(t => isPlanModeTool(t.name))
      : allTools;
    const allowedTools = new Set(tools.map(tool => tool.name));

    // In plan mode, append instructions to the system prompt. With no investigation, Plan reads them all (tool-reach row 14).
    const finalSystemPrompt = currentMode === 'plan'
      ? systemPrompt + `\n\nYou are in PLAN MODE. You can only read${homeFolderId ? ' this investigation' : ''}; describe anything else as a plan: list the tools you would call, what data you would create, and what your analysis plan is. Present this as a structured plan the analyst can review before switching to Act mode.`
      : systemPrompt;

    // Track which thread is streaming
    streamingThreadRef.current = activeThread.id;

    const threadId = activeThread.id;
    const executeChatTool = createChatToolExecutor({
      homeFolderId,
      mode: currentMode,
      isYolo: () => yoloModeRef.current,
      settings,
      allowedTools,
      requestApproval: (item, signal) => new Promise<HumanApproval | null>((resolve) => {
        if (signal.aborted) { resolve(null); return; }
        const id = nanoid();
        const abortApproval = () => settleApproval(id, null);
        signal.addEventListener('abort', abortApproval, { once: true });
        approvalQueueRef.current = [...approvalQueueRef.current, {
          id, item, threadId,
          resolve: approval => { signal.removeEventListener('abort', abortApproval); resolve(approval); },
        }];
        setPendingApprovals(approvalQueueRef.current);
      }),
      runCheckpointed: (execute, signal, toolUse) => executeCheckpointedTool({ ...checkpointContext, signal }, toolUse, execute),
    });

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
        useServerProxy,
      },
      async (toolUse: ToolUseBlock, signal: AbortSignal) => {
        const result = await executeChatTool(toolUse, signal);
        if (isWriteTool(toolUse.name) && !result.isError) {
          usedWriteTool = true;
        }
        return result;
      },
      async ({ content, toolCalls, usage }) => {
        const msgId = assistantMessageId;
        const assistantMsg: ChatMessage = {
          id: msgId,
          role: 'assistant',
          content,
          model: activeThread.model,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          tokenCount: usage,
          createdAt: Date.now(),
        };
        const completed = await persistChatCompletion(
          { threadId: activeThread.id, messageId: assistantMessageId, model: activeThread.model, provider: activeThread.provider },
          assistantMsg, () => onAddMessage(activeThread.id, assistantMsg),
        );
        if (!completed) return;

        // Trigger entity reload if any write tools were used
        if (usedWriteTool && onEntitiesChanged) {
          onEntitiesChanged();
        }

        // Auto-generate a contextual title after first exchange (through the extension only, like summaries)
        if (activeThread.messages.length <= 1 && content && !useServerProxy) {
          const titleApiKey = getApiKeyForProvider(activeThread.provider, settings);
          if (titleApiKey) {
            const titleEndpoint = activeThread.provider === 'local' ? settings.llmLocalEndpoint : undefined;
            generateChatTitle(text, content, activeThread.provider, activeThread.model, extensionApiKey, titleEndpoint)
              .then((title) => {
                if (title) onUpdateThread(activeThread.id, { title });
              })
              .catch(() => { /* ignore title generation failures */ });
          }
        }
      },
      { threadId: activeThread.id, messageId: assistantMessageId, model: activeThread.model, provider: activeThread.provider },
    );
  }, [activeThread, settings, selectedFolder, selectedFolderId, sendAgentRequest, onAddMessage, onUpdateThread, onEntitiesChanged, getApiKeyForProvider, resolveTransport, startLoop, stopAllForThread, pendingImages, setPendingImages, readingImages, customCommands, settleApproval, t]);

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
      folderId: activeThread.folderId ?? (selectedFolderId || undefined),
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

  // A chip is model-written text: it may ask a question, never run a slash command such as /fetch
  // or read an entity through an @-mention.
  const handleSuggestionClick = useCallback((text: string) => {
    if (text.trimStart().startsWith('/') || hasMentionToken(text)) return;
    handleSend(text);
  }, [handleSend]);

  // ── Tool approval handlers ──────────────────────────────────────────
  const visibleApprovals = useMemo(() => pendingApprovals.filter(pending => pending.threadId === selectedThreadId), [pendingApprovals, selectedThreadId]);
  const headApproval = visibleApprovals[0];

  // The only place a chat approval is minted: the analyst approved this card.
  const handleApprove = useCallback(() => {
    if (!headApproval) return;
    const { toolUse, reach } = headApproval.item;
    settleApproval(headApproval.id, mintHumanApproval(toolUse, reach.homeFolderId, 'chat-card'));
  }, [headApproval, settleApproval]);

  const handleReject = useCallback(() => {
    if (headApproval) settleApproval(headApproval.id, null);
  }, [headApproval, settleApproval]);

  // Focus stays in the composer after sending, so Escape there rejects the card too, when
  // nothing is typed and no composer menu used the key.
  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || !headApproval) return;
    if (!(event.target instanceof HTMLTextAreaElement) || event.target.value !== '') return;
    event.preventDefault();
    settleApproval(headApproval.id, null);
  }, [headApproval, settleApproval]);

  // Reject every queued card when the thread changes (prevents ghosts from trashed threads)
  useEffect(() => {
    const queue = approvalQueueRef.current;
    if (queue.length === 0) return;
    approvalQueueRef.current = [];
    setPendingApprovals([]);
    for (const pending of queue) pending.resolve(null);
  }, [selectedThreadId]);

  // ── Plan/Act mode ──────────────────────────────────────────────────
  const threadMode = activeThread?.mode || 'act';
  const yoloTitle = threadMode === 'plan'
    ? t('mode.yoloInPlanTitle', { setting: yoloMode ? t('mode.yoloOnTitleV2') : t('mode.yoloOffTitleV2') })
    : yoloMode ? t('mode.yoloOnTitleV2') : t('mode.yoloOffTitleV2');

  const toggleMode = useCallback(() => {
    if (!activeThread) return;
    const newMode = threadMode === 'act' ? 'plan' : 'act';
    onUpdateThread(activeThread.id, { mode: newMode });
    addToast('success', newMode === 'plan' ? t('mode.switchedToPlanV2') : t('view.switchedToActV2'));

    // When switching from Plan to Act, if the last assistant message exists,
    // prompt the user to execute the plan
    if (newMode === 'act' && activeThread.messages.length > 0) {
      const lastMsg = activeThread.messages[activeThread.messages.length - 1];
      if (lastMsg.role === 'assistant' && lastMsg.content.length > 100) {
        // Auto-send a prompt to execute the plan
        const executeMsg: ChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: t('view.switchedToActMessageV2'),
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

    let restored = false;
    try {
      restored = await restoreCheckpoint(cp.id);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Undo could not be completed.');
    }
    if (restored) {
      setCheckpointMessageIds(prev => {
        const next = new Set(prev);
        next.delete(restoreConfirmMsgId);
        return next;
      });
      onEntitiesChanged?.();
      addToast('success', t('view.restoredCheckpoint', { count: cp.snapshot.length }));
    }
    setRestoreConfirmMsgId(null);
  }, [restoreConfirmMsgId, onEntitiesChanged, addToast]);

  // ── Session branching ──────────────────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    if (!activeThread || activeThread.messages.length < 2) return;
    // Find last user message
    let lastUserIdx = -1;
    for (let i = activeThread.messages.length - 1; i >= 0; i--) {
      if (activeThread.messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const userText = activeThread.messages[lastUserIdx].content;
    // Remove all messages after (and including) the last user message
    const trimmed = activeThread.messages.slice(0, lastUserIdx);
    await onUpdateThread(activeThread.id, { messages: trimmed });
    // Re-send the user message
    handleSend(userText);
  }, [activeThread, onUpdateThread, handleSend]);

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
    addToast('success', t('view.branchedAt', { index: messageIndex + 1 }));
  }, [activeThread, onCreateThread, onSelectThread, onAddMessage, addToast]);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {hasDrafts && <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle p-2 text-xs">
        <span className="flex-1 text-text-muted">{t('input.memoryDrafts')}</span>
        <button onClick={() => setDiscardDraftsOpen(true)} className="rounded border border-border-subtle px-2 py-1 text-text-secondary hover:text-red-400">{t('input.discardAllDrafts')}</button>
      </div>}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Thread list — hidden on mobile when a thread is selected */}
      <div className={cn(
        'w-56 border-r border-border-subtle flex flex-col shrink-0',
        activeThread ? 'hidden md:flex' : 'w-full md:w-56'
      )}>
        <div className="p-2 border-b border-border-subtle flex gap-1">
          <button
            onClick={handleNewChat}
            disabled={!canChat}
            className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-accent text-white text-xs font-medium hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100"
            title={canChat ? t('view.startChatTitle') : t('view.extensionOrServerRequired')}
          >
            <Plus size={14} />
            {t('view.newChat')}
          </button>
          <button
            onClick={() => setShowNewChatFolder(!showNewChatFolder)}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={t('view.newFolder')}
          >
            <FolderPlus size={14} />
          </button>
        </div>
        {showNewChatFolder && (
          <div className="px-2 py-1.5 border-b border-border-subtle flex gap-1">
            <input
              autoFocus
              className="flex-1 bg-surface-raised border border-border-default rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue"
              placeholder={t('view.folderNamePlaceholder')}
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
              {t('common:create')}
            </button>
          </div>
        )}
        {/* Thread source filter */}
        <div className="flex gap-1 px-3 py-1.5 border-b border-border-subtle" role="tablist" aria-label={t('view.filterThreadsAria')}>
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
              {t(`view.filter${f.charAt(0).toUpperCase() + f.slice(1)}`)}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredThreads.length === 0 ? (
            <div className="p-4 text-center text-text-muted text-xs">
              {threads.length === 0 ? t('view.noThreadsYet') : t('view.noFilteredThreads', { filter: threadSourceFilter })}
            </div>
          ) : (() => {
            // Separate folders and top-level threads, then build ordered list
            const { folders: chatFolders, topLevel, childrenOf: childOf } = chatThreadGroups(filteredThreads);

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
                  indented && 'ps-7',
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
                      <span className="shrink-0 text-[8px] px-1 py-px rounded bg-accent-blue/10 text-accent-blue font-normal">{t('view.badgeAgent')}</span>
                    )}
                    {thread.source === 'agent-meeting' && (
                      <span className="shrink-0 text-[8px] px-1 py-px rounded bg-purple/10 text-purple font-normal">{t('view.badgeMeeting')}</span>
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
                  title={t('view.deleteThread')}
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
                            title={t('view.renameFolder')}
                            aria-label={t('view.renameFolderAria', { name: folder.title })}
                          >
                            <Pencil size={10} />
                          </button>
                        </>)}
                        <span className="text-[9px] text-text-muted">{children.length}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setTrashConfirmId(folder.id); }}
                          className="opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-red-400 transition-all shrink-0"
                          title={t('view.deleteFolder')}
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
                className="md:hidden p-1.5 -ms-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label={t('view.backToThreads')}
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
                  aria-label={t('view.threadTitleAria')}
                />
              ) : (
                <button
                  onClick={() => {
                    setEditingTitleValue(activeThread.title);
                    setEditingTitle(true);
                    setTimeout(() => titleInputRef.current?.select(), 0);
                  }}
                  className="flex items-center gap-1.5 min-w-0 group"
                  title={t('view.clickToRename')}
                >
                  <span className="text-sm font-medium text-text-primary truncate">{activeThread.title}</span>
                  <Pencil size={12} className="shrink-0 text-text-muted opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" />
                </button>
              )}
              <div className="flex items-center gap-1 ms-auto shrink-0">
                <button
                  onClick={toggleMode}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors me-1',
                    threadMode === 'plan'
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                  )}
                  title={threadMode === 'plan' ? t('mode.planTitleV2') : t('view.actModeTitleV2')}
                >
                  {threadMode === 'plan' ? <Eye size={10} /> : <Play size={10} />}
                  {threadMode === 'plan' ? t('view.planMode') : t('view.actMode')}
                </button>
                <button
                  onClick={() => setYoloMode(!yoloMode)}
                  aria-pressed={yoloMode}
                  aria-describedby={yoloDescriptionId}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors me-1',
                    yoloMode
                      ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                      : 'bg-surface-raised border-border-subtle text-text-muted hover:text-text-secondary'
                  )}
                  title={yoloTitle}
                >
                  <Shield size={10} />
                  {yoloMode ? t('view.yoloLabel') : t('mode.askLabel')}
                </button>
                {/* The title reaches only mouse users; assistive technology reads the same text as the switch's description.
                    Hidden, so it is read only through aria-describedby and not again as text after the switch. */}
                <span id={yoloDescriptionId} hidden>{yoloTitle}</span>
                {threadTokenTotal > 0 && (
                  <span className={cn(
                    'text-[10px] font-mono px-1.5 py-0.5 rounded border me-1',
                    settings.llmTokenBudget && threadTokenTotal > settings.llmTokenBudget
                      ? 'text-red-400 bg-red-500/10 border-red-500/20'
                      : settings.llmTokenBudget && threadTokenTotal > settings.llmTokenBudget * 0.8
                      ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                      : 'text-text-muted bg-bg-deep border-border-subtle'
                  )} title={settings.llmTokenBudget ? t('view.tokenTotalBudget', { total: threadTokenTotal.toLocaleString(), budget: settings.llmTokenBudget.toLocaleString() }) : t('view.tokenTotal', { total: threadTokenTotal.toLocaleString() })}>
                    {threadTokenTotal >= 1000 ? `${(threadTokenTotal / 1000).toFixed(1)}k` : threadTokenTotal} {t('view.tokSuffix')}
                  </span>
                )}
                {activeLoops.length > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple/10 border border-purple/20 text-[10px] text-purple me-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple animate-pulse" />
                    {t('view.loopCount', { count: activeLoops.length })}
                    {activeLoops.some(loop => loop.error) && <span role="status" className="text-amber-300" title={activeLoops.filter(loop => loop.error).map(loop => loop.error).join('\n')}>{t('view.loopRetrying')}</span>}
                    <button
                      onClick={() => stopAllForThread(activeThread.id)}
                      className="ms-0.5 hover:text-red-400 transition-colors"
                      title={t('view.stopAllLoops')}
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
                    title={t('view.exportAsNote')}
                  >
                    <FileText size={14} />
                  </button>
                )}
                {onShareThread && activeThread.messages.length > 0 && (
                  <button
                    onClick={() => onShareThread(activeThread)}
                    className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                    title={t('view.shareChat')}
                  >
                    <Share2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Messages — virtualized for performance on long threads */}
            <div className="flex-1 overflow-hidden" aria-live="polite">
              {activeThread.messages.length === 0 && !isStreaming ? (
                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                  <MessageSquare size={40} className="mb-3 opacity-30" />
                  <p className="text-sm font-medium">{t('view.emptyTitle')}</p>
                  <p className="text-xs mt-1 max-w-md px-4 text-center">{t('view.emptySubtitleV2')}</p>
                  {selectedFolder && (
                    <p className="text-xs mt-1 text-purple">
                      {t('view.emptyFolderContext', { name: selectedFolder.name })}
                    </p>
                  )}
                </div>
              ) : (
              <Virtuoso
                data={activeThread.messages}
                followOutput="smooth"
                className="h-full"
                itemContent={(idx, msg) => (
                  <div className="px-4">
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
                      onRegenerate={msg.role === 'assistant' ? handleRegenerate : undefined}
                    />
                    {msg.agentCycleSummary && (
                      <AgentCycleSummaryCard summary={msg.agentCycleSummary} />
                    )}
                  </div>
                )}
                components={{
                  Footer: () => (
                    <div className="px-4 pb-2">
                      {isStreaming && streamingContent && streamingThreadRef.current === selectedThreadId && (
                        <ChatMessageBubble role="assistant" content={cleanStreamingContent(streamingContent)} isStreaming />
                      )}
                      {/* Tool activity indicators during streaming */}
                      {isStreaming && toolActivity.length > 0 && streamingThreadRef.current === selectedThreadId && (
                        <div className="ms-2 mb-2 space-y-1">
                          {toolActivity.filter(ta => ta.status !== 'running').length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {toolActivity.filter(ta => ta.status !== 'running').map((ta) => (
                                <span
                                  key={ta.id}
                                  className={cn(
                                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono',
                                    ta.status === 'error' ? 'text-red-400' : 'text-emerald-400/70'
                                  )}
                                >
                                  {ta.status === 'error' ? '✗' : '✓'} {ta.name}
                                </span>
                              ))}
                            </div>
                          )}
                          {toolActivity.filter(ta => ta.status === 'running').map((ta) => (
                            <span
                              key={ta.id}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono border border-purple/30 text-purple bg-purple/10 animate-pulse"
                            >
                              {t('view.toolRunning', { name: ta.name })}
                            </span>
                          ))}
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  ),
                }}
              />
              )}
            </div>

            {/* Tool approval card: the head of this thread's queue. Outside the list, whose
                footer remounts on every render, so the card keeps its state and focus. On a short
                window the card scrolls within itself, so the composer and its buttons stay reachable.
                Keyed by the card, so the next queued card starts at its title, not where the last one was scrolled. */}
            {headApproval && (
              <div key={headApproval.id} className="px-4 min-h-0 max-h-[40vh] overflow-y-auto">
                <ChatApprovalCard
                  item={headApproval.item}
                  index={1}
                  total={visibleApprovals.length}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              </div>
            )}
            <ChatApprovalStatus item={headApproval?.item} total={visibleApprovals.length} />

            {/* Input */}
            {localError && (
              <div role="alert" className="mx-auto max-w-md my-3 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {errorHasSettingsLink && onOpenSettings ? (
                  <span>
                    {localError.replace(/Settings \u2192 AI\/LLM\.?/, '')}{' '}
                    <button onClick={() => onOpenSettings('ai')} className="underline hover:text-red-300 font-medium">
                      {t('view.settingsAiLlm')}
                    </button>
                  </span>
                ) : localError}
              </div>
            )}
            <div onKeyDown={handleComposerKeyDown}>
              <ChatInput
                draftScope={selectedThreadId}
                onSend={handleSend}
                onStop={abort}
                isStreaming={isStreaming}
                extensionAvailable={extensionAvailable}
                serverRoute={cloudRoute === 'server'}
                route={activeThread.provider === 'local' ? localRoute : cloudRoute}
                provider={activeThread.provider}
                model={activeThread.model}
                onModelChange={handleModelChange}
                localModelName={settings.llmLocalModelName}
                configuredProviders={configuredProviders}
                onOpenSettings={onOpenSettings ? () => onOpenSettings('ai') : undefined}
                folderId={activeThread.folderId ?? selectedFolderId}
                customCommands={customCommands.map(c => ({ command: `/${c.name}`, description: c.description }))}
                onImageAttach={handleImageAttach}
                readingImages={readingImages}
                attachedImages={pendingImages.map(a => ({ name: a.name || 'Image' }))}
                onClearImages={clearImages}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <MessageSquare size={48} className="mb-3 opacity-20" />
            <p className="text-lg font-medium">{t('view.caddyAI')}</p>
            <p className="text-sm mt-1">
              {threads.length > 0
                ? t('view.selectThread')
                : t('view.aiAssistant')}
            </p>
            {!canChat && (
              <p className="text-xs mt-3 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                {t('view.extensionRequired')}
              </p>
            )}
          </div>
        )}
      </div>

      </div>
      <ConfirmDialog open={discardDraftsOpen} onClose={() => setDiscardDraftsOpen(false)}
        onConfirm={discardAllComposerDrafts} title={t('input.discardAllDrafts')}
        message={t('input.discardAllDraftsConfirm')} confirmLabel={t('input.discardDraftsConfirm')} danger />

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
        title={t('view.deleteThreadDialog')}
        message={threads.find(th => th.id === trashConfirmId)?.isFolder ? t('view.deleteFolderMessage') : t('view.deleteThreadMessage')}
        confirmLabel={t('common:delete')}
        danger
      />

      <ConfirmDialog
        open={rewindConfirmIndex !== null}
        onClose={() => setRewindConfirmIndex(null)}
        onConfirm={handleRewindConfirmed}
        title={t('view.rewindDialog')}
        message={t('view.rewindMessage', { count: activeThread ? activeThread.messages.length - (rewindConfirmIndex ?? 0) - 1 : 0 })}
        confirmLabel={t('view.rewindLabel')}
        danger
      />

      <ConfirmDialog
        open={restoreConfirmMsgId !== null}
        onClose={() => setRestoreConfirmMsgId(null)}
        onConfirm={handleRestoreCheckpointConfirmed}
        title={t('view.restoreDialog')}
        message={t('view.restoreMessage')}
        confirmLabel={t('view.restoreLabel')}
        danger
      />

      {/* First-use onboarding overlay */}
      {showOnboarding && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-xl">
          <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl shadow-2xl p-6 max-w-md mx-4 w-full">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('view.onboardingTitle')}</h3>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Key size={16} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t('view.onboardingStep1Title')}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{t('view.onboardingStep1Desc')} (<a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Anthropic</a>, <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">OpenAI</a>, <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google Gemini</a>, <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Mistral</a>)</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Puzzle size={16} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t('view.onboardingStep2Title')}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{t('view.onboardingStep2Desc')} (<a href="https://chromewebstore.google.com/detail/threatcaddy-%E2%80%94-quick-captu/lakelgngpkkaeinfdlnmifookbeeffbh" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Chrome Web Store</a>)</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Shield size={16} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t('view.onboardingStep3Title')}</p>
                  {/* The command stays left to right, so a right-to-left language does not show its slash after it. */}
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5"><Trans i18nKey="view.onboardingStep3Desc" ns="chat" components={{ cmd: <bdi dir="ltr" /> }} /></p>
                </div>
              </div>
            </div>
            <button
              onClick={dismissOnboarding}
              className="w-full mt-5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {t('view.onboardingDismiss')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
