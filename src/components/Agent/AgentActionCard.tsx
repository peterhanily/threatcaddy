import { Check, X, Clock, AlertTriangle, Info, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SETTINGS, type AgentAction } from '../../types';
import { db } from '../../db';
import { cn, formatDate } from '../../lib/utils';
import { getToolActionClass } from '../../lib/caddy-agent-policy';
import { classifyToolCall } from '../../lib/tool-reach';

interface AgentActionCardProps {
  action: AgentAction;
  onApprove?: (action: AgentAction) => void;
  onEditApprove?: (action: AgentAction, modifiedInput: Record<string, unknown>) => void;
  onReject?: (action: AgentAction) => void;
  onViewReasoning?: (threadId: string) => void;
}

const ACTION_CLASS_LABELS: Record<string, { labelKey: string; color: string }> = {
  read: { labelKey: 'action.classRead', color: 'text-accent-blue' },
  enrich: { labelKey: 'action.classEnrich', color: 'text-accent-green' },
  fetch: { labelKey: 'action.classFetch', color: 'text-purple' },
  create: { labelKey: 'action.classCreate', color: 'text-accent-amber' },
  modify: { labelKey: 'action.classModify', color: 'text-orange-400' },
  delegate: { labelKey: 'action.classDelegate', color: 'text-text-secondary' },
};

const STATUS_CONFIG: Record<string, { icon: typeof Check; labelKey: string; color: string; bg: string }> = {
  pending: { icon: Clock, labelKey: 'action.statusPending', color: 'text-accent-amber', bg: 'bg-accent-amber/10' },
  approved: { icon: Check, labelKey: 'action.statusApproved', color: 'text-accent-green', bg: 'bg-accent-green/10' },
  executed: { icon: Check, labelKey: 'action.statusExecuted', color: 'text-accent-green', bg: 'bg-accent-green/10' },
  rejected: { icon: X, labelKey: 'action.statusRejected', color: 'text-text-muted', bg: 'bg-surface-raised' },
  failed: { icon: AlertTriangle, labelKey: 'action.statusFailed', color: 'text-red-400', bg: 'bg-red-400/10' },
};

/** The host a web fetch or agent-host skill sends to. */
function destinationHost(action: AgentAction): string | undefined {
  if (action.toolName === 'fetch_url') {
    try { return new URL(String(action.toolInput.url)).hostname; } catch { return String(action.toolInput.url ?? '').slice(0, 200); }
  }
  if (action.toolName.startsWith('host:')) return action.toolName.split(':')[1];
}

/** Bidi controls in a stored value could reorder the sentence around it. */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** A failed row stores toolExecutionError's {"error": ...} wrapper (older rows too): show its text. */
function failureReason(summary: string): string {
  try {
    const parsed: unknown = JSON.parse(summary);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') return (parsed as { error: string }).error;
  } catch { /* Not the wrapper: show it as stored. */ }
  return summary;
}

export function AgentActionCard({ action, onApprove, onEditApprove, onReject, onViewReasoning }: AgentActionCardProps) {
  const { t, i18n } = useTranslation('agent');
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editJson, setEditJson] = useState('');
  const [editError, setEditError] = useState('');

  const actionClass = getToolActionClass(action.toolName);
  const classInfo = ACTION_CLASS_LABELS[actionClass] || ACTION_CLASS_LABELS.read;
  const statusInfo = STATUS_CONFIG[action.status] || STATUS_CONFIG.pending;
  const StatusIcon = statusInfo.icon;
  const isPending = action.status === 'pending';
  // Where the action sends data, for actions that leave this device. A pending
  // enrichment names its lookups below, once they are known.
  const destination = action.toolName === 'enrich_ioc' ? undefined
    : action.toolName.startsWith('local:') ? t('action.localAgent')
    : destinationHost(action);

  // Display only, read from the case's IOCs: it never blocks or approves anything.
  const [iocHostActionId, setIocHostActionId] = useState<string>();
  /** The lookups approving a pending enrichment runs, found as the chat card finds them. */
  const [lookup, setLookup] = useState<{ actionId: string; iocId: string; value: string; vendors: string[] }>();
  const { id, toolName, investigationId } = action;
  // Keyed on the URL and IOC id, not the input object: the inbox refresh returns new rows.
  const { url } = action.toolInput;
  const iocId = String(action.toolInput.iocId || '');
  useEffect(() => {
    if (!isPending || (toolName !== 'fetch_url' && toolName !== 'enrich_ioc')) return;
    let current = true;
    if (toolName === 'fetch_url') {
      // A fetch's reach reads only its URL, and no settings.
      classifyToolCall({ type: 'tool_use', id, name: toolName, input: { url } }, { homeFolderId: investigationId, settings: DEFAULT_SETTINGS })
        .then(reach => { if (current) setIocHostActionId(reach.flags.includes('host-is-ioc') ? id : undefined); })
        .catch(() => { /* The card still shows the destination. */ });
    } else {
      (async () => {
        // Builtin lookups take their names from this namespace, which the hosted build loads on demand.
        await i18n.loadNamespaces('integrations');
        // An enrichment's reach reads only the IOC and the enabled integrations, and no settings.
        const reach = await classifyToolCall({ type: 'tool_use', id, name: toolName, input: { iocId } }, { homeFolderId: investigationId, settings: DEFAULT_SETTINGS });
        const ioc = iocId ? await db.standaloneIOCs.get(iocId) : undefined;
        // Approval runs no lookup for an IOC that is gone or filed in another investigation.
        const runs = !!ioc && !ioc.trashed && ioc.folderId === investigationId;
        const value = String(ioc?.value ?? iocId).replace(BIDI_CONTROLS, '');
        if (current) setLookup({ actionId: id, iocId, value, vendors: runs ? reach.destinations : [] });
      })().catch(() => { /* The card keeps its neutral line. */ });
    }
    return () => { current = false; };
    // react-i18next hands a new i18n for each language, so a new language renames the builtin lookups.
  }, [isPending, id, toolName, url, iocId, investigationId, i18n]);
  const hostIsIoc = isPending && toolName === 'fetch_url' && iocHostActionId === id;
  const lookupLine = !isPending || toolName !== 'enrich_ioc' ? undefined
    : lookup?.actionId !== id || lookup.iocId !== iocId ? t('action.lookupChecking')
    : lookup.vendors.length ? t('action.lookupDestinations', { value: lookup.value, vendors: lookup.vendors.join(', ') })
    : t('action.lookupNone', { value: lookup.value });

  return (
    <div className={cn(
      'border border-border-subtle rounded-lg p-3 transition-colors',
      isPending ? 'bg-surface-raised border-accent-amber/30' : 'bg-surface',
    )}>
      {/* Header: on a narrow card the status wraps under the tool name, which is never cut */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? t('action.collapseAction', { toolName: action.toolName }) : t('action.expandAction', { toolName: action.toolName })}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <code className="min-w-0 break-all text-xs font-mono text-text-primary bg-surface-raised px-1.5 py-0.5 rounded">
            {action.toolName}
          </code>
          <span className={cn('shrink-0 text-[10px] font-medium uppercase', classInfo.color)}>
            {t(classInfo.labelKey)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ms-auto">
          <span className={cn('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded', statusInfo.bg, statusInfo.color)}>
            <StatusIcon size={10} />
            {t(statusInfo.labelKey)}
          </span>
        </div>
      </div>

      {destination && (
        <p className="text-xs text-text-secondary mt-1 ps-6 break-all">{t('action.destination', { destination })}</p>
      )}
      {lookupLine && <p className="text-xs text-text-secondary mt-1 ps-6 break-words">{lookupLine}</p>}
      {hostIsIoc && (
        <p className="flex items-center gap-1 text-xs text-accent-amber mt-1 ps-6">
          <AlertTriangle size={12} className="shrink-0" />
          {t('action.hostIsIoc')}
        </p>
      )}

      {/* Rationale preview: model text, not a system statement */}
      <p className="text-xs text-text-muted mt-1.5 line-clamp-2 ps-6">
        <span className="font-medium">{t('action.aiReason')}</span> {action.rationale.substring(0, 200)}
      </p>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 ps-6 space-y-2">
          <div>
            <span className="text-[10px] text-text-muted uppercase tracking-wide">{t('action.input')}</span>
            <pre dir="ltr" className="text-xs text-text-secondary bg-surface-raised rounded p-2 mt-0.5 overflow-auto max-h-32">
              {JSON.stringify(action.toolInput, null, 2)}
            </pre>
          </div>

          {action.resultSummary && (
            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-wide">{t('action.result')}</span>
              {action.status === 'failed' ? (
                <p dir="auto" className="text-xs text-text-secondary bg-surface-raised rounded p-2 mt-0.5 overflow-auto max-h-32 whitespace-pre-wrap break-words">
                  {failureReason(action.resultSummary)}
                </p>
              ) : (
                <pre dir="ltr" className="text-xs text-text-secondary bg-surface-raised rounded p-2 mt-0.5 overflow-auto max-h-32">
                  {action.resultSummary}
                </pre>
              )}
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
                {t(action.severity === 'critical' ? 'action.severityCritical' : 'action.severityWarning')}
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
                {t('action.viewReasoning')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Edit mode for modifying tool input before approve */}
      {editing && isPending && (
        <div className="mt-2 ps-6 space-y-1.5">
          <textarea
            maxLength={10000}
            value={editJson}
            onChange={e => { setEditJson(e.target.value); setEditError(''); }}
            rows={4}
            className="w-full text-xs font-mono bg-surface-raised border border-border-subtle rounded p-2 text-text-primary resize-none focus:outline-none focus:border-accent-blue/50"
          />
          {editError && <p className="text-[10px] text-red-400">{editError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => {
                try {
                  const parsed = JSON.parse(editJson);
                  onEditApprove?.(action, parsed);
                  setEditing(false);
                } catch { setEditError(t('action.invalidJSON')); }
              }}
              className="text-[10px] text-accent-green hover:bg-accent-green/10 px-2 py-0.5 rounded"
            >{t('action.executeWithEdits')}</button>
            <button onClick={() => setEditing(false)} className="text-[10px] text-text-muted hover:bg-surface-raised px-2 py-0.5 rounded">{t('common:cancel')}</button>
          </div>
        </div>
      )}

      {/* Action buttons for pending items */}
      {isPending && !editing && (onApprove || onReject) && (
        <div className="flex items-center gap-2 mt-2 ps-6">
          {onApprove && (
            <button
              onClick={() => onApprove(action)}
              className="flex items-center gap-1 text-xs text-accent-green hover:bg-accent-green/10 px-2 py-1 rounded transition-colors"
              aria-label={t('action.approveAction', { toolName: action.toolName })}
            >
              <Check size={12} />
              {t('action.approve')}
            </button>
          )}
          {onEditApprove && (
            <button
              onClick={() => { setEditJson(JSON.stringify(action.toolInput, null, 2)); setEditing(true); }}
              className="flex items-center gap-1 text-xs text-accent-blue hover:bg-accent-blue/10 px-2 py-1 rounded transition-colors"
              aria-label={t('action.editAction', { toolName: action.toolName })}
            >
              <Pencil size={12} />
              {t('common:edit')}
            </button>
          )}
          {onReject && (
            <button
              onClick={() => onReject(action)}
              className="flex items-center gap-1 text-xs text-text-muted hover:bg-surface-raised px-2 py-1 rounded transition-colors"
              aria-label={t('action.rejectAction', { toolName: action.toolName })}
            >
              <X size={12} />
              {t('action.reject')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
