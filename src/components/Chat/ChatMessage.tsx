import { useState, useMemo, memo } from 'react';
import { ChevronRight, FileText, ListChecks, Shield, Clock, GitBranch, RotateCcw, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { renderMarkdown, sanitizeHtml } from '../../lib/markdown';
import type { ToolCallRecord, ChatAttachment } from '../../types';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  isStreaming?: boolean;
  toolCalls?: ToolCallRecord[];
  onEntityClick?: (type: string, id: string) => void;
  onSuggestionClick?: (text: string) => void;
  isLastAssistant?: boolean;
  messageIndex?: number;
  onBranchFromHere?: (messageIndex: number) => void;
  onRewindToHere?: (messageIndex: number) => void;
  tokenCount?: { input: number; output: number };
  messageId?: string;
  onRestoreCheckpoint?: (messageId: string) => void;
  hasCheckpoint?: boolean;
  onRegenerate?: () => void;
  isError?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function summarizeInput(input: Record<string, unknown>, noInputLabel: string): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(input)) {
    if (val === undefined || val === null) continue;
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    parts.push(`${key}: ${str.length > 60 ? str.slice(0, 60) + '...' : str}`);
  }
  return parts.join(', ') || noInputLabel;
}

function ToolCallBlock({ tc }: { tc: ToolCallRecord }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  let resultPreview = '';
  try {
    const parsed = JSON.parse(tc.result);
    if (parsed.error) {
      resultPreview = t('tool.errorPrefix', { message: parsed.error });
    } else if (parsed.message) {
      resultPreview = String(parsed.message);
    } else if (parsed.count !== undefined) {
      resultPreview = t('tool.resultCount', { count: parsed.count });
    } else if (parsed.success) {
      const label = parsed.title || parsed.name || parsed.value || parsed.profile || parsed.noteId || parsed.id || '';
      resultPreview = label ? t('tool.doneWithLabel', { label }) : t('tool.done');
    } else if (parsed.title) {
      resultPreview = parsed.title;
    } else if (Array.isArray(parsed)) {
      resultPreview = parsed.length === 0 ? t('tool.noResults') : t('tool.itemCount', { count: parsed.length });
    } else if (typeof parsed === 'object' && Object.keys(parsed).length === 0) {
      resultPreview = t('tool.doneEmpty');
    } else {
      resultPreview = tc.result.length > 80 ? tc.result.slice(0, 80) + '...' : tc.result;
    }
  } catch {
    resultPreview = tc.result.length > 80 ? tc.result.slice(0, 80) + '...' : tc.result;
  }

  return (
    <div className={cn(
      'my-1.5 rounded-lg border text-[11px]',
      tc.isError ? 'border-red-500/20 bg-red-500/5' : 'border-border-subtle bg-bg-deep/50'
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-start hover:bg-bg-hover/50 rounded-lg transition-colors"
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 text-text-muted transition-transform', expanded && 'rotate-90')}
        />
        <span className="font-mono font-medium text-purple shrink-0">{tc.name}</span>
        <span className="text-text-muted truncate flex-1 min-w-0">{summarizeInput(tc.input, t('tool.noInput'))}</span>
        <span className={cn(
          'shrink-0 ms-1 max-w-[200px] truncate',
          tc.isError ? 'text-red-400' : 'text-emerald-400'
        )}>
          {resultPreview}
        </span>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2 border-t border-border-subtle mt-0.5 pt-1.5">
          <div className="mb-1">
            <span className="text-text-muted">{t('tool.inputLabel')}</span>
            <pre className="mt-0.5 p-1.5 rounded bg-bg-deep text-[10px] font-mono overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(tc.input, null, 2)}
            </pre>
          </div>
          <div>
            <span className="text-text-muted">{t('tool.resultLabel')}</span>
            <pre className="mt-0.5 p-1.5 rounded bg-bg-deep text-[10px] font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
              {(() => { try { return JSON.stringify(JSON.parse(tc.result), null, 2); } catch { return tc.result; } })()}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Entity Link Processing ─────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function processEntityLinks(html: string, onEntityClick?: (type: string, id: string) => void): string {
  if (!onEntityClick) return html;
  // Replace [type:id:label] with styled spans
  return html.replace(/\[(note|task|ioc|event):([^\]]+)\]/g, (_match, type: string, rest: string) => {
    const parts = rest.split(':');
    let id: string, label: string;
    const iconMap: Record<string, string> = { note: '📄', task: '☑️', ioc: '🛡️', event: '🕐' };
    if (type === 'ioc') {
      id = `${parts[0]}:${parts.slice(1).join(':')}`;
      label = parts.slice(1).join(':');
    } else {
      id = parts[0];
      label = parts.slice(1).join(':') || id;
    }
    return `<span class="tc-entity-link tc-entity-${escapeHtml(type)}" data-entity-type="${escapeHtml(type)}" data-entity-id="${escapeHtml(id)}">${iconMap[type] || ''} ${escapeHtml(label)}</span>`;
  });
}

function parseSuggestions(content: string): string[] {
  const match = content.match(/<!--\s*suggestions:\s*(.*?)\s*-->/);
  if (!match) return [];
  return match[1].split('|').map(s => s.trim()).filter(Boolean);
}

function stripSuggestions(content: string): string {
  return content.replace(/<!--\s*suggestions:.*?-->/g, '').trim();
}

// ── Sources Footer ─────────────────────────────────────────────────

function SourcesFooter({ toolCalls, onEntityClick, sourcesLabel }: { toolCalls: ToolCallRecord[]; onEntityClick?: (type: string, id: string) => void; sourcesLabel: string }) {
  const sources = useMemo(() => {
    const items: { type: string; id: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const tc of toolCalls) {
      if (tc.isError) continue;
      try {
        const result = JSON.parse(tc.result);
        // Collect entity references from tool results
        const entities = [
          ...(result.notes || []).map((n: { id: string; title: string }) => ({ type: 'note', id: n.id, label: n.title })),
          ...(result.tasks || []).map((t: { id: string; title: string }) => ({ type: 'task', id: t.id, label: t.title })),
          ...(result.events || []).map((e: { id: string; title: string }) => ({ type: 'event', id: e.id, label: e.title })),
          ...(result.iocs || []).map((i: { id: string; type: string; value: string }) => ({ type: 'ioc', id: i.id, label: `${i.type}: ${i.value}` })),
        ];
        // Also handle nested results from search_all
        if (result.notes?.results) entities.push(...result.notes.results.map((n: { id: string; title: string }) => ({ type: 'note', id: n.id, label: n.title })));
        if (result.tasks?.results) entities.push(...result.tasks.results.map((t: { id: string; title: string }) => ({ type: 'task', id: t.id, label: t.title })));
        if (result.events?.results) entities.push(...result.events.results.map((e: { id: string; title: string }) => ({ type: 'event', id: e.id, label: e.title })));
        if (result.iocs?.results) entities.push(...result.iocs.results.map((i: { id: string; type: string; value: string }) => ({ type: 'ioc', id: i.id, label: `${i.type}: ${i.value}` })));
        // Single entity reads
        if (result.id && result.title && tc.name === 'read_note') entities.push({ type: 'note', id: result.id, label: result.title });

        for (const e of entities) {
          const key = `${e.type}:${e.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push(e);
          }
        }
      } catch { /* ignore */ }
    }
    return items.slice(0, 8); // Cap at 8
  }, [toolCalls]);

  if (sources.length === 0) return null;

  const IconMap: Record<string, typeof FileText> = { note: FileText, task: ListChecks, ioc: Shield, event: Clock };
  const colorMap: Record<string, string> = { note: 'text-blue-400', task: 'text-green-400', ioc: 'text-amber-400', event: 'text-purple-400' };

  return (
    <div className="mt-2 pt-2 border-t border-border-subtle">
      <div className="text-[10px] text-text-muted mb-1 font-medium uppercase tracking-wider">{sourcesLabel}</div>
      <div className="flex flex-wrap gap-1">
        {sources.map((s) => {
          const Icon = IconMap[s.type] || FileText;
          return (
            <button
              key={`${s.type}:${s.id}`}
              onClick={() => onEntityClick?.(s.type, s.id)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-border-subtle hover:bg-bg-hover transition-colors',
                colorMap[s.type] || 'text-text-secondary'
              )}
            >
              <Icon size={10} />
              <span className="truncate max-w-[120px]">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Suggestion Chips ───────────────────────────────────────────────

function SuggestionChips({ suggestions, onSuggestionClick }: { suggestions: string[]; onSuggestionClick?: (text: string) => void }) {
  if (suggestions.length === 0 || !onSuggestionClick) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSuggestionClick(s)}
          className="px-2.5 py-1 rounded-full text-[11px] border border-purple/30 text-purple hover:bg-purple/10 transition-colors"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export const ChatMessageBubble = memo(function ChatMessageBubble({ role, content, attachments, isStreaming, toolCalls, onEntityClick, onSuggestionClick, isLastAssistant, messageIndex, onBranchFromHere, onRewindToHere, tokenCount, messageId, onRestoreCheckpoint, hasCheckpoint, onRegenerate, isError }: ChatMessageProps) {
  const { t } = useTranslation('chat');
  const isUser = role === 'user';

  const suggestions = useMemo(() => {
    if (isUser || isStreaming || !isLastAssistant) return [];
    return parseSuggestions(content);
  }, [content, isUser, isStreaming, isLastAssistant]);

  const displayContent = useMemo(() => {
    if (isUser) return content;
    let text = stripSuggestions(content);
    // Strip tool_call XML tags that leak into display (from text-based tool parsing)
    text = text.replace(/<(?:tool_call|function_call)>\s*[\s\S]*?\s*<\/(?:tool_call|function_call)>/gi, '').trim();
    // Strip bare JSON tool call blocks that look like {"name":"tool_name","arguments":{...}}
    text = text.replace(/```json\s*\n?\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:[\s\S]*?\}\s*\n?\s*```/gi, '').trim();
    return text;
  }, [content, isUser]);

  const hasReadTools = toolCalls?.some(tc =>
    !tc.isError && ['search_notes', 'search_all', 'read_note', 'list_tasks', 'list_iocs', 'list_timeline_events', 'analyze_graph'].includes(tc.name)
  );

  // Parse meeting speaker from **icon Name:** prefix
  const meetingSpeaker = useMemo(() => {
    if (isUser || !displayContent) return null;
    const match = displayContent.match(/^\*\*(.{0,4})\s*([^:*]+):\*\*\s*/);
    if (!match) return null;
    return { icon: match[1].trim(), name: match[2].trim(), contentWithout: displayContent.replace(/^\*\*(.{0,4})\s*[^:*]+:\*\*\s*/, '') };
  }, [isUser, displayContent]);

  return (
    <div className={cn('group/msg flex w-full mb-3', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'relative max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-purple/20 text-text-primary rounded-br-sm'
            : 'bg-bg-raised text-text-primary rounded-bl-sm border border-border-subtle'
        )}
      >
        {/* Message actions (branch, rewind) */}
        {messageIndex !== undefined && !isStreaming && (onBranchFromHere || onRewindToHere) && (
          <div className="absolute -top-2 right-2 opacity-0 group-hover/msg:opacity-100 flex items-center gap-0.5 rounded bg-bg-raised border border-border-subtle shadow-sm z-10">
            {onBranchFromHere && (
              <button
                onClick={() => onBranchFromHere(messageIndex)}
                className="p-1 text-text-muted hover:text-purple transition-colors"
                title={t('message.branchTitle')}
              >
                <GitBranch size={12} />
              </button>
            )}
            {onRewindToHere && (
              <button
                onClick={() => onRewindToHere(messageIndex)}
                className="p-1 text-text-muted hover:text-amber-400 transition-colors"
                title={t('message.rewindTitle')}
              >
                <RotateCcw size={12} />
              </button>
            )}
            {hasCheckpoint && onRestoreCheckpoint && messageId && (
              <button
                onClick={() => onRestoreCheckpoint(messageId)}
                className="p-1 text-text-muted hover:text-red-400 transition-colors"
                title={t('message.undoTitle')}
              >
                <RotateCcw size={12} className="scale-x-[-1]" />
              </button>
            )}
            {onRegenerate && isLastAssistant && !isStreaming && (
              <button
                onClick={onRegenerate}
                className="p-1 text-text-muted hover:text-accent-blue transition-colors"
                title={isError ? t('message.retryTitle', 'Retry') : t('message.regenerateTitle', 'Regenerate')}
              >
                <RefreshCw size={12} />
              </button>
            )}
          </div>
        )}
        {isUser ? (
          <>
            {attachments && attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attachments.map((att, i) => (
                  <img
                    key={i}
                    src={`data:${att.mimeType};base64,${att.data}`}
                    alt={att.name || t('message.attachmentAlt', { index: i + 1 })}
                    className="max-w-[200px] max-h-[150px] rounded-lg border border-border-subtle object-cover"
                  />
                ))}
              </div>
            )}
            <p className="whitespace-pre-wrap">{content}</p>
          </>
        ) : (
          <>
            {/* Tool calls rendered before/between text */}
            {toolCalls && toolCalls.length > 0 && (
              <div className="mb-2">
                {toolCalls.map((tc) => (
                  <ToolCallBlock key={tc.id} tc={tc} />
                ))}
              </div>
            )}
            {meetingSpeaker && (
              <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 border-b border-border-subtle">
                <span className="text-sm">{meetingSpeaker.icon || '🤖'}</span>
                <span className="text-xs font-semibold text-accent-blue">{meetingSpeaker.name}</span>
              </div>
            )}
            {displayContent && (
              <div
                className="markdown-preview text-sm"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(processEntityLinks(renderMarkdown(meetingSpeaker ? meetingSpeaker.contentWithout : displayContent), onEntityClick)) }}
                onClick={(e) => {
                  const target = (e.target as HTMLElement).closest('.tc-entity-link') as HTMLElement;
                  if (target && onEntityClick) {
                    e.preventDefault();
                    onEntityClick(target.dataset.entityType || '', target.dataset.entityId || '');
                  }
                }}
              />
            )}
            {/* Sources footer */}
            {hasReadTools && toolCalls && (
              <SourcesFooter toolCalls={toolCalls} onEntityClick={onEntityClick} sourcesLabel={t('message.sources')} />
            )}
            {/* Suggestion chips */}
            <SuggestionChips suggestions={suggestions} onSuggestionClick={onSuggestionClick} />
          </>
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-purple/60 rounded-sm animate-pulse ms-0.5 align-text-bottom" />
        )}
        {/* Token count badge */}
        {tokenCount && !isStreaming && (
          <div className="mt-1.5 text-[9px] text-text-muted font-mono opacity-60" title={t('message.tokenCountTitle', { input: tokenCount.input.toLocaleString(), output: tokenCount.output.toLocaleString() })}>
            {t('message.tokenCount', { count: formatTokens(tokenCount.input + tokenCount.output) })}
          </div>
        )}
      </div>
    </div>
  );
});
