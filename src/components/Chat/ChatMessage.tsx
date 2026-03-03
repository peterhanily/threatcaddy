import { useState, useMemo } from 'react';
import { ChevronRight, FileText, ListChecks, Shield, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { renderMarkdown } from '../../lib/markdown';
import type { ToolCallRecord } from '../../types';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  toolCalls?: ToolCallRecord[];
  onEntityClick?: (type: string, id: string) => void;
  onSuggestionClick?: (text: string) => void;
  isLastAssistant?: boolean;
}

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(input)) {
    if (val === undefined || val === null) continue;
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    parts.push(`${key}: ${str.length > 60 ? str.slice(0, 60) + '...' : str}`);
  }
  return parts.join(', ') || '(no input)';
}

function ToolCallBlock({ tc }: { tc: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);

  let resultPreview = '';
  try {
    const parsed = JSON.parse(tc.result);
    if (parsed.error) {
      resultPreview = `Error: ${parsed.error}`;
    } else if (parsed.count !== undefined) {
      resultPreview = `${parsed.count} result${parsed.count !== 1 ? 's' : ''}`;
    } else if (parsed.success) {
      resultPreview = `Created: ${parsed.title || parsed.value || parsed.id}`;
    } else if (parsed.title) {
      resultPreview = parsed.title;
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
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left hover:bg-bg-hover/50 rounded-lg transition-colors"
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 text-text-muted transition-transform', expanded && 'rotate-90')}
        />
        <span className="font-mono font-medium text-purple">{tc.name}</span>
        <span className="text-text-muted truncate flex-1">{summarizeInput(tc.input)}</span>
        <span className={cn(
          'shrink-0 ml-1',
          tc.isError ? 'text-red-400' : 'text-emerald-400'
        )}>
          {resultPreview}
        </span>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2 border-t border-border-subtle mt-0.5 pt-1.5">
          <div className="mb-1">
            <span className="text-text-muted">Input:</span>
            <pre className="mt-0.5 p-1.5 rounded bg-bg-deep text-[10px] font-mono overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(tc.input, null, 2)}
            </pre>
          </div>
          <div>
            <span className="text-text-muted">Result:</span>
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

function processEntityLinks(html: string, onEntityClick?: (type: string, id: string) => void): string {
  if (!onEntityClick) return html;
  // Replace [type:id:label] with styled spans
  return html.replace(/\[(note|task|ioc|event):([^\]]+)\]/g, (_match, type: string, rest: string) => {
    const parts = rest.split(':');
    let id: string, label: string;
    const iconMap: Record<string, string> = { note: '📄', task: '☑️', ioc: '🛡️', event: '🕐' };
    const colorMap: Record<string, string> = { note: '#3b82f6', task: '#22c55e', ioc: '#f59e0b', event: '#8b5cf6' };
    if (type === 'ioc') {
      id = `${parts[0]}:${parts.slice(1).join(':')}`;
      label = parts.slice(1).join(':');
    } else {
      id = parts[0];
      label = parts.slice(1).join(':') || id;
    }
    const color = colorMap[type] || '#6b7280';
    return `<span class="tc-entity-link" data-entity-type="${type}" data-entity-id="${id}" style="color:${color};cursor:pointer;border-bottom:1px dashed ${color};font-weight:500">${iconMap[type] || ''} ${label}</span>`;
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

function SourcesFooter({ toolCalls, onEntityClick }: { toolCalls: ToolCallRecord[]; onEntityClick?: (type: string, id: string) => void }) {
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
      <div className="text-[10px] text-text-muted mb-1 font-medium uppercase tracking-wider">Sources</div>
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

export function ChatMessageBubble({ role, content, isStreaming, toolCalls, onEntityClick, onSuggestionClick, isLastAssistant }: ChatMessageProps) {
  const isUser = role === 'user';

  const suggestions = useMemo(() => {
    if (isUser || isStreaming || !isLastAssistant) return [];
    return parseSuggestions(content);
  }, [content, isUser, isStreaming, isLastAssistant]);

  const displayContent = useMemo(() => {
    if (isUser) return content;
    return stripSuggestions(content);
  }, [content, isUser]);

  const hasReadTools = toolCalls?.some(tc =>
    !tc.isError && ['search_notes', 'search_all', 'read_note', 'list_tasks', 'list_iocs', 'list_timeline_events', 'analyze_graph'].includes(tc.name)
  );

  return (
    <div className={cn('flex w-full mb-3', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-purple/20 text-text-primary rounded-br-sm'
            : 'bg-bg-raised text-text-primary rounded-bl-sm border border-border-subtle'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
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
            {displayContent && (
              <div
                className="markdown-preview text-sm"
                dangerouslySetInnerHTML={{ __html: processEntityLinks(renderMarkdown(displayContent), onEntityClick) }}
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
              <SourcesFooter toolCalls={toolCalls} onEntityClick={onEntityClick} />
            )}
            {/* Suggestion chips */}
            <SuggestionChips suggestions={suggestions} onSuggestionClick={onSuggestionClick} />
          </>
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-purple/60 rounded-sm animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}
