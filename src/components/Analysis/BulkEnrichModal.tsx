import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Zap, Loader2, X, CheckCircle2, AlertTriangle, XCircle, Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { useAuth } from '../../contexts/AuthContext';
import { IntegrationExecutor } from '../../lib/integration-executor';
import type { ExecutionOptions } from '../../lib/integration-executor';
import { db } from '../../db';
import type { IntegrationRun, InstalledIntegration, IntegrationTemplate } from '../../types/integration-types';
import type { StandaloneIOC } from '../../types';
import { currentLocale } from '../../lib/utils';

interface BulkEnrichModalProps {
  open: boolean;
  onClose: () => void;
  iocs: StandaloneIOC[];
  getInstallationsForIOCType: (type: string) => Array<{ installation: InstalledIntegration; template: IntegrationTemplate }>;
  addRun: (run: IntegrationRun) => Promise<void>;
  investigation?: { id: string; name: string };
  onCompleted?: (stats: { success: number; error: number; skipped: number }) => void;
}

interface IOCEnrichPlan {
  ioc: StandaloneIOC;
  integrations: Array<{ installation: InstalledIntegration; template: IntegrationTemplate }>;
}

type EnrichStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

interface IOCResult {
  iocId: string;
  status: EnrichStatus;
  integrationResults: Array<{ templateName: string; status: 'success' | 'error'; error?: string }>;
}

// ── Domain-grouped throttling (Phase 2a) ────────────────────────────
// Tracks last request time per domain so integrations sharing a provider
// (e.g. VT IP + VT Domain) don't double-hit the same API.
const domainLastRequest = new Map<string, number>();

function domainDelay(template: IntegrationTemplate): number {
  const domain = template.requiredDomains?.[0];
  if (!domain) return 1000;
  const rph = template.rateLimit?.maxPerHour ?? 60;
  const minGap = Math.ceil(3_600_000 / (rph * 0.8));
  const last = domainLastRequest.get(domain) ?? 0;
  const elapsed = Date.now() - last;
  return Math.max(0, minGap - elapsed);
}

function markDomainUsed(template: IntegrationTemplate): void {
  const domain = template.requiredDomains?.[0];
  if (domain) domainLastRequest.set(domain, Date.now());
}

// ── Signal-aware sleep for pause loops (Phase 3a) ───────────────────
function sleepUntilUnpaused(
  abortSignal: AbortSignal,
  pauseRef: React.RefObject<boolean>,
): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (abortSignal.aborted || !pauseRef.current) { resolve(); return; }
      setTimeout(check, 200);
    };
    check();
  });
}

export function BulkEnrichModal({
  open,
  onClose,
  iocs,
  getInstallationsForIOCType,
  addRun,
  investigation,
  onCompleted,
}: BulkEnrichModalProps) {
  const { t } = useTranslation('analysis');
  const { connected, serverUrl, getAccessToken } = useAuth();

  // Phase: 'configure' → 'running' → 'done'
  const [phase, setPhase] = useState<'configure' | 'running' | 'done'>('configure');
  const [skipAlreadyEnriched, setSkipAlreadyEnriched] = useState(true);
  const [createNotes, setCreateNotes] = useState(false);
  const [results, setResults] = useState<IOCResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pauseRef = useRef(false);
  const cancelledRef = useRef(false);

  // Keep pauseRef in sync
  useEffect(() => { pauseRef.current = paused; }, [paused]);

  // Abort on unmount to prevent async loop from continuing (Phase 3b)
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Build the plan: which IOCs have matching integrations
  const plan = useMemo<IOCEnrichPlan[]>(() => {
    return iocs.map((ioc) => ({
      ioc,
      integrations: getInstallationsForIOCType(ioc.type),
    }));
  }, [iocs, getInstallationsForIOCType]);

  const enrichableCount = useMemo(
    () => plan.filter((p) => p.integrations.length > 0).length,
    [plan],
  );

  const skippableCount = useMemo(
    () =>
      plan.filter(
        (p) =>
          p.integrations.length > 0 &&
          p.ioc.enrichment &&
          Object.keys(p.ioc.enrichment).length > 0,
      ).length,
    [plan],
  );

  const effectivePlan = useMemo(() => {
    return plan.filter((p) => {
      if (p.integrations.length === 0) return false;
      if (skipAlreadyEnriched && p.ioc.enrichment && Object.keys(p.ioc.enrichment).length > 0)
        return false;
      return true;
    });
  }, [plan, skipAlreadyEnriched]);

  // Total integration runs for progress
  const totalRuns = useMemo(
    () => effectivePlan.reduce((sum, p) => sum + p.integrations.length, 0),
    [effectivePlan],
  );

  // Aggregate result stats
  const stats = useMemo(() => {
    let success = 0;
    let error = 0;
    let skipped = 0;
    for (const r of results) {
      if (r.status === 'success') success++;
      else if (r.status === 'error') error++;
      else if (r.status === 'skipped') skipped++;
    }
    return { success, error, skipped };
  }, [results]);

  const completedRuns = useMemo(
    () =>
      results.reduce((sum, r) => sum + r.integrationResults.length, 0),
    [results],
  );

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setPhase('configure');
      setResults([]);
      setCurrentIndex(0);
      setPaused(false);
      setSkipAlreadyEnriched(true);
      setCreateNotes(false);
      cancelledRef.current = false;
    }
  }, [open]);

  const handleStart = useCallback(async () => {
    setPhase('running');
    setResults([]);
    setCurrentIndex(0);

    const controller = new AbortController();
    abortRef.current = controller;
    const executor = new IntegrationExecutor();
    const execOptions: ExecutionOptions | undefined =
      connected && serverUrl
        ? { useServerProxy: { serverUrl, getAccessToken } }
        : undefined;
    const newResults: IOCResult[] = [];

    // Phase 1a: top-level try/finally so any unhandled error transitions to 'done'
    try {
      for (let i = 0; i < effectivePlan.length; i++) {
        if (cancelledRef.current || controller.signal.aborted) break;

        // Pause (Phase 3a: signal-aware sleep)
        await sleepUntilUnpaused(controller.signal, pauseRef);
        if (controller.signal.aborted) break;

        setCurrentIndex(i);
        const { ioc, integrations } = effectivePlan[i];

        const iocResult: IOCResult = {
          iocId: ioc.id,
          status: 'running',
          integrationResults: [],
        };

        let anyError = false;

        for (const { installation, template } of integrations) {
          if (controller.signal.aborted) break;

          // Pause (Phase 3a)
          await sleepUntilUnpaused(controller.signal, pauseRef);
          if (controller.signal.aborted) break;

          // Phase 2a: domain-grouped throttle — wait if needed before hitting this provider
          const delay = domainDelay(template);
          if (delay > 0 && !controller.signal.aborted) {
            await new Promise((r) => setTimeout(r, delay));
          }
          if (controller.signal.aborted) break;

          try {
            const run = await executor.run(
              template,
              installation,
              {
                ioc: { id: ioc.id, value: ioc.value, type: ioc.type, confidence: ioc.confidence },
                investigation,
              },
              {
                onCreateEntity: createNotes
                  ? async (type, fields) => {
                      const id = nanoid();
                      const now = Date.now();
                      // Phase 1b: try/catch so DB failures don't crash the batch
                      try {
                        if (type === 'note') {
                          const transformResults = fields._transformResults as Record<string, Record<string, unknown>> | undefined;
                          const rawResponses = fields._rawResponses as Record<string, unknown> | undefined;
                          const bodyParts: string[] = [];
                          if (transformResults) {
                            for (const [, stepData] of Object.entries(transformResults)) {
                              if (stepData && typeof stepData === 'object') {
                                for (const [key, val] of Object.entries(stepData)) {
                                  const display = val === null || val === undefined ? '--'
                                    : typeof val === 'object' ? JSON.stringify(val)
                                    : String(val);
                                  bodyParts.push(`- **${key}:** ${display}`);
                                }
                              }
                            }
                          }
                          if (rawResponses) {
                            const responseValues = Object.values(rawResponses).filter(Boolean);
                            if (responseValues.length > 0) {
                              const jsonData = responseValues.length === 1 ? responseValues[0] : rawResponses;
                              bodyParts.push('');
                              bodyParts.push('### Raw Response');
                              bodyParts.push('```json');
                              bodyParts.push(JSON.stringify(jsonData, null, 2));
                              bodyParts.push('```');
                            }
                          }
                          const noteContent = bodyParts.length > 0 ? bodyParts.join('\n') : (fields.body as string) || (fields.content as string) || '';
                          const timestamp = new Date().toLocaleString(currentLocale(), {
                            month: 'short', day: 'numeric', year: 'numeric',
                            hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
                          }) + ' UTC';
                          await db.notes.add({
                            id,
                            title: `${(fields.title as string) || 'Integration Note'} — ${timestamp}`,
                            content: noteContent,
                            folderId: (fields.folderId as string) || investigation?.id,
                            tags: (fields.tags as string[]) || [],
                            iocTypes: [],
                            pinned: false,
                            archived: false,
                            trashed: false,
                            createdAt: now,
                            updatedAt: now,
                          });
                        }
                      } catch (dbErr) {
                        console.error('[BulkEnrich] onCreateEntity DB error:', dbErr);
                      }
                      return id;
                    }
                  : undefined,
                onUpdateEntity: async (type, id, fields) => {
                  // Phase 1b: try/catch for DB failures
                  try {
                    if (type === 'ioc') {
                      // Phase 1c: transactional read-modify-write
                      await db.transaction('rw', db.standaloneIOCs, async () => {
                        const existing = await db.standaloneIOCs.get(id);
                        if (!existing) return;
                        const updates: Partial<StandaloneIOC> = { updatedAt: Date.now() };
                        if (fields.iocStatus !== undefined) updates.iocStatus = fields.iocStatus as string;
                        if (fields.confidence !== undefined) updates.confidence = fields.confidence as StandaloneIOC['confidence'];
                        if (fields.enrichment) {
                          const existingEnrichment = existing.enrichment || {};
                          const newEnrichment = fields.enrichment as Record<string, Record<string, unknown>>;
                          const merged: Record<string, Array<Record<string, unknown>>> = { ...existingEnrichment };
                          for (const [provider, data] of Object.entries(newEnrichment)) {
                            merged[provider] = [{ ...data, ts: Date.now() }, ...(merged[provider] || [])].slice(0, 20);
                          }
                          updates.enrichment = merged;
                        }
                        await db.standaloneIOCs.update(id, updates);
                      });
                    }
                  } catch (dbErr) {
                    console.error('[BulkEnrich] onUpdateEntity DB error:', dbErr);
                  }
                },
                onNotify: () => {},
              },
              controller.signal,
              execOptions,
            );

            // Phase 2a: mark domain as used after the request completes
            markDomainUsed(template);

            await addRun(run);

            if (run.status === 'success') {
              iocResult.integrationResults.push({ templateName: template.name, status: 'success' });
            } else {
              iocResult.integrationResults.push({
                templateName: template.name,
                status: 'error',
                error: run.error || run.status,
              });
              anyError = true;
            }
          } catch (err) {
            iocResult.integrationResults.push({
              templateName: template.name,
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
            });
            anyError = true;
          }
        }

        iocResult.status = controller.signal.aborted
          ? 'pending'
          : anyError
            ? 'error'
            : 'success';

        newResults.push(iocResult);
        setResults([...newResults]);
      }
    } catch (fatalErr) {
      // Phase 1a: surface unexpected errors in results
      console.error('[BulkEnrich] Fatal error in run loop:', fatalErr);
    } finally {
      abortRef.current = null;
      setPhase('done');

      // Phase 4a/4b: compute final stats and notify parent
      const finalStats = { success: 0, error: 0, skipped: 0 };
      for (const r of newResults) {
        if (r.status === 'success') finalStats.success++;
        else if (r.status === 'error') finalStats.error++;
        else if (r.status === 'skipped') finalStats.skipped++;
      }
      onCompleted?.(finalStats);
    }
  }, [effectivePlan, addRun, investigation, createNotes, onCompleted, connected, serverUrl, getAccessToken]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    setPhase('done');
  }, []);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
            <Zap size={16} className="text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-100">{t('bulkEnrich.title')}</h2>
            <p className="text-[11px] text-gray-500">{t('bulkEnrich.selectedCount', { count: iocs.length })}</p>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === 'configure' && (
            <div className="flex flex-col gap-4">
              {/* Summary */}
              <div className="bg-gray-800/50 rounded-lg p-3.5 text-xs space-y-1.5">
                <div className="flex justify-between text-gray-300">
                  <span>{t('bulkEnrich.matchingIntegrations')}</span>
                  <span className="font-medium text-gray-100">{enrichableCount} / {iocs.length}</span>
                </div>
                {skippableCount > 0 && (
                  <div className="flex justify-between text-gray-400">
                    <span>{t('bulkEnrich.alreadyEnriched')}</span>
                    <span>{skippableCount}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-300">
                  <span>{t('bulkEnrich.totalRuns')}</span>
                  <span className="font-medium text-gray-100">{totalRuns}</span>
                </div>
                {iocs.length - enrichableCount > 0 && (
                  <p className="text-[10px] text-gray-500 pt-1">
                    {t('bulkEnrich.noMatchHint', { count: iocs.length - enrichableCount })}
                  </p>
                )}
              </div>

              {/* Options */}
              {skippableCount > 0 && (
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={skipAlreadyEnriched}
                    onChange={(e) => setSkipAlreadyEnriched(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                  />
                  <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors">
                    {t('bulkEnrich.skipAlreadyEnriched')}
                    <span className="text-gray-500 ml-1">({skippableCount})</span>
                  </span>
                </label>
              )}

              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={createNotes}
                  onChange={(e) => setCreateNotes(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                />
                <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors">
                  {t('bulkEnrich.createNotes')}
                  <span className="text-gray-500 ml-1">{t('bulkEnrich.createNotesHint')}</span>
                </span>
              </label>

              {enrichableCount === 0 && (
                <div className="text-center py-4">
                  <p className="text-xs text-gray-500">{t('bulkEnrich.noIntegrations')}</p>
                  <p className="text-[10px] text-gray-600 mt-1">{t('bulkEnrich.installHint')}</p>
                </div>
              )}
            </div>
          )}

          {phase === 'running' && (
            <div className="flex flex-col gap-4">
              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                  <span>
                    {t('bulkEnrich.progressLabel', { state: paused ? t('bulkEnrich.paused') : t('bulkEnrich.enriching'), current: currentIndex + 1, total: effectivePlan.length })}
                  </span>
                  <span className="tabular-nums">{t('bulkEnrich.runsProgress', { completed: completedRuns, total: totalRuns })}</span>
                </div>
                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${totalRuns > 0 ? (completedRuns / totalRuns) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Current IOC */}
              {effectivePlan[currentIndex] && (
                <div className="bg-gray-800/50 rounded-lg p-3 text-xs">
                  <span className="text-gray-500">{t('bulkEnrich.currentLabel')}</span>
                  <span className="text-gray-200 font-mono">{effectivePlan[currentIndex].ioc.value}</span>
                </div>
              )}

              {/* Running results feed (last 5) */}
              {results.length > 0 && (
                <div className="flex flex-col gap-1">
                  {results.slice(-5).map((r) => {
                    const ioc = iocs.find((i) => i.id === r.iocId);
                    return (
                      <div key={r.iocId} className="flex items-center gap-2 text-xs py-1">
                        {r.status === 'success' ? (
                          <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                        ) : r.status === 'error' ? (
                          <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                        ) : (
                          <Loader2 size={12} className="text-gray-500 animate-spin shrink-0" />
                        )}
                        <span className="text-gray-400 font-mono truncate max-w-[200px]">
                          {ioc?.value || r.iocId}
                        </span>
                        <span className="text-gray-600 ml-auto shrink-0">
                          {r.integrationResults.filter((ir) => ir.status === 'success').length}/
                          {r.integrationResults.length}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div className="flex flex-col gap-4">
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-500/10 rounded-lg p-3 text-center">
                  <CheckCircle2 size={18} className="text-green-500 mx-auto mb-1" />
                  <div className="text-lg font-semibold text-green-400 tabular-nums">{stats.success}</div>
                  <div className="text-[10px] text-gray-500">{t('bulkEnrich.enrichedLabel')}</div>
                </div>
                <div className="bg-amber-500/10 rounded-lg p-3 text-center">
                  <AlertTriangle size={18} className="text-amber-500 mx-auto mb-1" />
                  <div className="text-lg font-semibold text-amber-400 tabular-nums">{stats.error}</div>
                  <div className="text-[10px] text-gray-500">{t('bulkEnrich.errorsLabel')}</div>
                </div>
                <div className="bg-gray-500/10 rounded-lg p-3 text-center">
                  <XCircle size={18} className="text-gray-500 mx-auto mb-1" />
                  <div className="text-lg font-semibold text-gray-400 tabular-nums">
                    {effectivePlan.length - results.length}
                  </div>
                  <div className="text-[10px] text-gray-500">{t('bulkEnrich.cancelledLabel')}</div>
                </div>
              </div>

              {/* Error details (collapsed) */}
              {stats.error > 0 && (
                <details className="text-xs">
                  <summary className="text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
                    {t('bulkEnrich.viewErrors', { count: stats.error })}
                  </summary>
                  <div className="mt-2 flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                    {results
                      .filter((r) => r.status === 'error')
                      .map((r) => {
                        const ioc = iocs.find((i) => i.id === r.iocId);
                        return (
                          <div key={r.iocId} className="bg-red-900/10 rounded px-2.5 py-1.5">
                            <span className="text-gray-300 font-mono">{ioc?.value || r.iocId}</span>
                            {r.integrationResults
                              .filter((ir) => ir.status === 'error')
                              .map((ir, idx) => (
                                <p key={idx} className="text-red-400/80 mt-0.5">
                                  {ir.templateName}: {ir.error}
                                </p>
                              ))}
                          </div>
                        );
                      })}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-800 shrink-0">
          {phase === 'configure' && (
            <>
              <button
                onClick={handleClose}
                className="px-3.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={handleStart}
                disabled={effectivePlan.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Zap size={12} />
                {t('bulkEnrich.enrichButton', { count: effectivePlan.length })}
              </button>
            </>
          )}

          {phase === 'running' && (
            <>
              <button
                onClick={() => setPaused((p) => !p)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs text-gray-300 hover:bg-gray-800 transition-colors"
              >
                {paused ? <Play size={12} /> : <Pause size={12} />}
                {paused ? t('bulkEnrich.resume') : t('bulkEnrich.pause')}
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-900/20 transition-colors"
              >
                <X size={12} />
                {t('bulkEnrich.stop')}
              </button>
            </>
          )}

          {phase === 'done' && (
            <button
              onClick={handleClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
            >
              {t('common:done')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
