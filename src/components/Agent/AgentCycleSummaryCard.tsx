/**
 * Renders a single AgentCycleSummary as a compact card, for inline display
 * in the agent's audit ChatThread. Shows cost, tokens, outcome, top tools,
 * entities touched, and the "why this cycle" rationale.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, AlertTriangle, Check, Clock, Ban, CircleAlert } from 'lucide-react';
import type { AgentCycleSummary, AgentCycleOutcome } from '../../types';
import { cn } from '../../lib/utils';
import { formatUSD } from '../../lib/model-pricing';

const OUTCOME_META: Record<AgentCycleOutcome, { labelKey: string; color: string; Icon: typeof Check }> = {
  success:      { labelKey: 'cycleSummary.outcomeSuccess',      color: 'text-accent-green',  Icon: Check        },
  timeout:      { labelKey: 'cycleSummary.outcomeTimeout',      color: 'text-accent-amber',  Icon: Clock        },
  error:        { labelKey: 'cycleSummary.outcomeError',        color: 'text-red-400',       Icon: AlertTriangle },
  policyDenied: { labelKey: 'cycleSummary.outcomePolicyDenied', color: 'text-accent-amber',  Icon: Ban          },
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

interface AgentCycleSummaryCardProps {
  summary: AgentCycleSummary;
  defaultExpanded?: boolean;
}

export function AgentCycleSummaryCard({ summary, defaultExpanded = false }: AgentCycleSummaryCardProps) {
  const { t } = useTranslation('agent');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const meta = OUTCOME_META[summary.outcome];
  const Icon = meta.Icon;
  const histogramEntries = Object.entries(summary.toolHistogram).sort((a, b) => b[1] - a[1]);
  const errorEntries = Object.entries(summary.errorHistogram).sort((a, b) => b[1] - a[1]);
  const totalTokens = summary.tokens.input + summary.tokens.output;
  const totalErrors = errorEntries.reduce((s, [, c]) => s + c, 0);

  return (
    <div className="my-2 border border-border-subtle rounded-lg bg-surface text-xs overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-raised text-left"
        aria-expanded={expanded}
        aria-label={t(expanded ? 'cycleSummary.collapse' : 'cycleSummary.expand')}
      >
        {expanded ? <ChevronDown size={14} className="shrink-0 text-text-muted" /> : <ChevronRight size={14} className="shrink-0 text-text-muted" />}
        <Icon size={14} className={cn('shrink-0', meta.color)} />
        <span className={cn('font-medium shrink-0', meta.color)}>{t(meta.labelKey)}</span>
        <span className="text-text-muted shrink-0">·</span>
        <span className="text-text-secondary truncate flex-1" title={summary.whyThisCycle}>{summary.whyThisCycle}</span>
        <span className="text-text-muted shrink-0 flex gap-2 ml-2">
          <span>{formatDuration(summary.durationMs)}</span>
          {totalTokens > 0 && <span>{formatTokens(totalTokens)} tok</span>}
          {summary.costUSD > 0 && <span>{formatUSD(summary.costUSD)}</span>}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border-subtle space-y-2">
          {/* Bullets */}
          {summary.whatIDid.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">{t('cycleSummary.whatIDid')}</div>
              <ul className="space-y-0.5">
                {summary.whatIDid.map((b, i) => (
                  <li key={i} className="text-text-secondary flex gap-1.5"><span className="text-text-muted">·</span>{b}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Tool histogram */}
          {histogramEntries.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">{t('cycleSummary.toolCalls', { executed: summary.toolCalls.executed, proposed: summary.toolCalls.proposed })}</div>
              <div className="flex flex-wrap gap-1">
                {histogramEntries.map(([name, count]) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary"
                    title={summary.errorHistogram[name] ? t('cycleSummary.errorsTitle', { count: summary.errorHistogram[name] }) : undefined}
                  >
                    {name}
                    {count > 1 && <span className="text-text-muted">×{count}</span>}
                    {summary.errorHistogram[name] && <CircleAlert size={10} className="text-red-400" />}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Entities touched */}
          {summary.entitiesTouched.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">{t('cycleSummary.entitiesTouched')}</div>
              <div className="flex flex-wrap gap-1">
                {summary.entitiesTouched.slice(0, 12).map((ent, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary">
                    <span className="text-text-muted">{ent.type}</span>
                    {ent.label && <span className="truncate max-w-[180px]">{ent.label}</span>}
                  </span>
                ))}
                {summary.entitiesTouched.length > 12 && (
                  <span className="text-text-muted">{t('cycleSummary.moreCount', { count: summary.entitiesTouched.length - 12 })}</span>
                )}
              </div>
            </div>
          )}

          {/* Telemetry footer */}
          <div className="flex flex-wrap gap-3 text-[10px] text-text-muted pt-1 border-t border-border-subtle">
            <span>{summary.provider}/{summary.model}</span>
            <span>{t('cycleSummary.turns', { count: summary.turns })}</span>
            {summary.tokens.input > 0 && (
              <span>{t('cycleSummary.tokensInOut', { in: formatTokens(summary.tokens.input), out: formatTokens(summary.tokens.output) })}</span>
            )}
            {totalErrors > 0 && (
              <span className="text-red-400">{t('cycleSummary.toolErrors', { count: totalErrors })}</span>
            )}
            {summary.error && (
              <span className="text-red-400 truncate max-w-[360px]" title={summary.error}>{summary.error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
