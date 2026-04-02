import { Check, X, Clock, AlertTriangle, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { AgentAction } from '../../types';
import { cn, formatDate } from '../../lib/utils';
import { getToolActionClass } from '../../lib/caddy-agent-policy';

interface AgentActionCardProps {
  action: AgentAction;
  onApprove?: (action: AgentAction) => void;
  onReject?: (action: AgentAction) => void;
  onViewReasoning?: (threadId: string) => void;
}

const ACTION_CLASS_LABELS: Record<string, { label: string; color: string }> = {
  read: { label: 'Read', color: 'text-accent-blue' },
  enrich: { label: 'Enrich', color: 'text-accent-green' },
  create: { label: 'Create', color: 'text-accent-amber' },
  modify: { label: 'Modify', color: 'text-orange-400' },
};

const STATUS_CONFIG: Record<string, { icon: typeof Check; label: string; color: string; bg: string }> = {
  pending: { icon: Clock, label: 'Pending', color: 'text-accent-amber', bg: 'bg-accent-amber/10' },
  approved: { icon: Check, label: 'Approved', color: 'text-accent-green', bg: 'bg-accent-green/10' },
  executed: { icon: Check, label: 'Executed', color: 'text-accent-green', bg: 'bg-accent-green/10' },
  rejected: { icon: X, label: 'Rejected', color: 'text-text-muted', bg: 'bg-surface-raised' },
  failed: { icon: AlertTriangle, label: 'Failed', color: 'text-red-400', bg: 'bg-red-400/10' },
};

export function AgentActionCard({ action, onApprove, onReject, onViewReasoning }: AgentActionCardProps) {
  const [expanded, setExpanded] = useState(false);

  const actionClass = getToolActionClass(action.toolName);
  const classInfo = ACTION_CLASS_LABELS[actionClass] || ACTION_CLASS_LABELS.read;
  const statusInfo = STATUS_CONFIG[action.status] || STATUS_CONFIG.pending;
  const StatusIcon = statusInfo.icon;
  const isPending = action.status === 'pending';

  return (
    <div className={cn(
      'border border-border-subtle rounded-lg p-3 transition-colors',
      isPending ? 'bg-surface-raised border-accent-amber/30' : 'bg-surface',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${action.toolName} action details`}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <code className="text-xs font-mono text-text-primary bg-surface-raised px-1.5 py-0.5 rounded">
            {action.toolName}
          </code>
          <span className={cn('text-[10px] font-medium uppercase', classInfo.color)}>
            {classInfo.label}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded', statusInfo.bg, statusInfo.color)}>
            <StatusIcon size={10} />
            {statusInfo.label}
          </span>
        </div>
      </div>

      {/* Rationale preview */}
      <p className="text-xs text-text-muted mt-1.5 line-clamp-2 pl-6">
        {action.rationale.substring(0, 200)}
      </p>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pl-6 space-y-2">
          <div>
            <span className="text-[10px] text-text-muted uppercase tracking-wide">Input</span>
            <pre className="text-xs text-text-secondary bg-surface-raised rounded p-2 mt-0.5 overflow-auto max-h-32">
              {JSON.stringify(action.toolInput, null, 2)}
            </pre>
          </div>

          {action.resultSummary && (
            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Result</span>
              <pre className="text-xs text-text-secondary bg-surface-raised rounded p-2 mt-0.5 overflow-auto max-h-32">
                {action.resultSummary}
              </pre>
            </div>
          )}

          {action.severity && action.severity !== 'info' && (
            <div className="flex items-center gap-1 text-xs">
              {action.severity === 'critical' ? (
                <AlertTriangle size={12} className="text-red-400" />
              ) : (
                <Info size={12} className="text-accent-amber" />
              )}
              <span className={action.severity === 'critical' ? 'text-red-400' : 'text-accent-amber'}>
                {action.severity}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 text-[10px] text-text-muted">
            <span>{formatDate(action.createdAt)}</span>
            {onViewReasoning && (
              <button
                onClick={() => onViewReasoning(action.threadId)}
                className="text-accent-blue hover:underline"
              >
                View reasoning
              </button>
            )}
          </div>
        </div>
      )}

      {/* Action buttons for pending items */}
      {isPending && (onApprove || onReject) && (
        <div className="flex items-center gap-2 mt-2 pl-6">
          {onApprove && (
            <button
              onClick={() => onApprove(action)}
              className="flex items-center gap-1 text-xs text-accent-green hover:bg-accent-green/10 px-2 py-1 rounded transition-colors"
              aria-label={`Approve ${action.toolName} action`}
            >
              <Check size={12} />
              Approve
            </button>
          )}
          {onReject && (
            <button
              onClick={() => onReject(action)}
              className="flex items-center gap-1 text-xs text-text-muted hover:bg-surface-raised px-2 py-1 rounded transition-colors"
              aria-label={`Reject ${action.toolName} action`}
            >
              <X size={12} />
              Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
}
