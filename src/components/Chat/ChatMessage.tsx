import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { renderMarkdown } from '../../lib/markdown';
import type { ToolCallRecord } from '../../types';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  toolCalls?: ToolCallRecord[];
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

export function ChatMessageBubble({ role, content, isStreaming, toolCalls }: ChatMessageProps) {
  const isUser = role === 'user';

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
            {content && (
              <div
                className="markdown-preview text-sm"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
              />
            )}
          </>
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-purple/60 rounded-sm animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}
