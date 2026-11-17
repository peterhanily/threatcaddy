import { useEffect, useId, useRef, useState } from 'react';
import { Check, Shield, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db';
import { isShareableFolder } from '../../lib/ai-scope';
import { AGENT_CONTROL_TOOLS } from '../../lib/caddy-agent-policy';
import type { ApprovalItem } from '../../lib/chat-tool-executor';
import type { AskReason } from '../../lib/tool-reach';

const TITLE_KEYS: Record<AskReason, string> = {
  write: 'approval.title.write',
  egress: 'approval.title.egress',
  'cross-read': 'approval.title.crossRead',
  'cross-write': 'approval.title.crossWrite',
  'agent-control': 'approval.title.agentControl',
  harvested: 'approval.title.harvested',
  policy: 'approval.title.write',
};
/** Tools that change agents; the other never-for-agents tools are described by what they write. */
const AGENT_TOOLS: ReadonlySet<string> = new Set(['deploy_agent', 'stop_agent', 'run_agent_cycle', ...AGENT_CONTROL_TOOLS]);

interface Resolved { homeName?: string; targets: Array<{ name: string; shareable: boolean }>; iocValue?: string }
/** How long a card that has just appeared keeps Approve disabled. The second click of a double
 * click on the previous card lands on this one's Approve before the analyst has read it. */
const APPROVE_DELAY_MS = 500;

/** One queued chat approval. It leads with what the call reaches; the raw input is under Details.
 * No button is focused, so Enter cannot approve; Escape rejects. */
export function ChatApprovalCard({ item, index, total, onApprove, onReject }: {
  item: ApprovalItem;
  index: number;
  total: number;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation('chat');
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState<Resolved>({ targets: [] });
  const [approvable, setApprovable] = useState<ApprovalItem | null>(null);
  const { toolUse, reach, reason, readForeignThisRequest } = item;

  useEffect(() => {
    const timer = setTimeout(() => setApprovable(item), APPROVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [item]);

  // Take focus only when nothing has it, so the composer keeps the analyst's typing.
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    cardRef.current?.focus();
  }, [item]);
  useEffect(() => {
    let current = true;
    (async () => {
      const home = reach.homeFolderId ? await db.folders.get(reach.homeFolderId) : undefined;
      const targets = await Promise.all(reach.targetFolderIds.map(async id => ({
        name: (await db.folders.get(id))?.name ?? id, shareable: await isShareableFolder(id) })));
      const iocId = toolUse.name === 'enrich_ioc' ? String(toolUse.input.iocId || '') : '';
      const iocValue = iocId ? (await db.standaloneIOCs.get(iocId))?.value ?? iocId : undefined;
      if (current) setResolved({ homeName: home?.name, targets, iocValue });
    })().catch(() => { /* The card still shows the reach and the raw input. */ });
    return () => { current = false; };
  }, [reach, toolUse]);

  const changesAgents = !!reach.agentControl && AGENT_TOOLS.has(toolUse.name);
  const titleReason: AskReason = reason === 'agent-control' && !changesAgents ? (reach.crossWrite ? 'cross-write' : 'write') : reason;
  const summary: string[] = [];
  if (reach.egress === 'open-fetch' || reach.egress === 'trusted-fetch') summary.push(t('approval.opensPage', { host: reach.destinations[0] }));
  else if (reach.egress === 'vendor') {
    const value = resolved.iocValue ?? '';
    summary.push(reach.destinations.length ? t('approval.lookup', { value, vendors: reach.destinations.join(', ') }) : t('approval.lookupNone', { value }));
  } else if (reach.egress === 'configured') summary.push(t('approval.sendsTo', { destination: reach.destinations.join(', ') }));
  if (changesAgents) summary.push(t('approval.agentChange'));
  if (reach.crossRead && reach.targetFolderIds.length === 0) summary.push(t('approval.readsOthers'));
  for (const target of resolved.targets) summary.push(t(target.shareable ? 'approval.targetSynced' : 'approval.targetLocal', { name: target.name }));
  if (reach.flags.includes('unfiled-sink')) summary.push(t('approval.unfiled'));
  if (reach.crossRead && reach.homeShareable && resolved.homeName) summary.push(t('approval.conversationSyncs', { name: resolved.homeName }));

  const flags: string[] = [];
  if (reach.flags.includes('untrusted-host')) flags.push(t('approval.flag.untrustedHost'));
  if (reach.flags.includes('url-carries-data')) flags.push(t('approval.flag.urlCarriesData'));
  if (reach.flags.includes('host-is-ioc')) flags.push(t('approval.flag.hostIsIoc'));
  if (reach.harvested) flags.push(t('approval.flag.harvested'));
  if (readForeignThisRequest) flags.push(t('approval.flag.readForeign'));

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={titleId}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onReject(); } }}
      className="mx-auto max-w-md my-3 rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
    >
      <div className="px-4 py-2.5 border-b border-amber-500/20 flex items-center gap-2">
        <Shield size={14} className="text-amber-400 shrink-0" />
        <span id={titleId} className="text-xs font-medium text-amber-400">{t(TITLE_KEYS[titleReason])}</span>
        {total > 1 && <span className="ms-auto shrink-0 text-[10px] text-text-muted">{t('approval.position', { index, total })}</span>}
      </div>
      <div className="px-4 py-2.5 space-y-1.5">
        <div className="text-xs">
          <span className="font-mono font-medium text-purple">{toolUse.name}</span>
        </div>
        {summary.length > 0 && (
          <ul className="space-y-0.5 text-xs text-text-primary">
            {summary.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
        {flags.length > 0 && (
          <ul className="space-y-0.5 text-[11px] text-amber-300">
            {flags.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
        <details className="text-[10px]">
          <summary className="cursor-pointer text-text-muted">{t('approval.details')}</summary>
          <pre className="mt-1 font-mono text-text-secondary bg-bg-deep rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
            {JSON.stringify(toolUse.input, null, 2)}
          </pre>
        </details>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onApprove}
            disabled={approvable !== item}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
          >
            <Check size={12} /> {t('view.approve')}
          </button>
          <button
            type="button"
            onClick={onReject}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
          >
            <X size={12} /> {t('view.reject')}
          </button>
        </div>
      </div>
    </div>
  );
}
