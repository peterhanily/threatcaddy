import { useState, useRef, useEffect } from 'react';
import { X, RefreshCw, ChevronDown, ChevronRight, Shield, Download, Upload, XCircle, Tag, Check } from 'lucide-react';
import type { IOCTarget, IOCEntry, IOCType, IOCAnalysis } from '../../types';
import { IOC_TYPE_LABELS } from '../../types';
import { useIOCAnalysis } from '../../hooks/useIOCAnalysis';
import { IOCItem } from './IOCItem';
import type { ThreatIntelConfigProps } from './IOCItem';
import { AttributionComboInput } from './AttributionComboInput';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { cn, formatDate } from '../../lib/utils';
import { formatIOCsJSON, formatIOCsCSV, formatIOCsFlatJSON, formatIOCsFlatCSV, slugify } from '../../lib/ioc-export';
import type { IOCExportEntry, ThreatIntelExportConfig } from '../../lib/ioc-export';
import { formatIOCsSTIX } from '../../lib/stix-export';
import { downloadFile } from '../../lib/export';

interface IOCPanelProps {
  item: IOCTarget;
  onUpdate: (id: string, updates: { iocAnalysis?: IOCAnalysis; iocTypes?: IOCType[] }) => void;
  onClose: () => void;
  attributionActors?: string[];
  threatIntelConfig?: ThreatIntelConfigProps;
  tiExportConfig?: ThreatIntelExportConfig;
  onPushIOCs?: (entries: IOCExportEntry[], slug: string, typeSlug?: string) => Promise<boolean>;
  ociPushing?: boolean;
  ociWritePARConfigured?: boolean;
  lastPushedAt?: number;
  onPushComplete?: () => void;
  style?: React.CSSProperties;
}

export function IOCPanel({ item, onUpdate, onClose, attributionActors, threatIntelConfig, tiExportConfig, onPushIOCs, ociPushing, ociWritePARConfigured, lastPushedAt, onPushComplete, style }: IOCPanelProps) {
  const {
    analysis,
    analyzing,
    analyze,
    updateIOC,
    updateSummary,
    dismissIOC,
    restoreIOC,
    dismissByType,
    updateByType,
    iocCount,
    activeIOCs,
    dismissedIOCs,
  } = useIOCAnalysis({ item, onUpdate });

  const [collapsedTypes, setCollapsedTypes] = useState<Set<IOCType>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [attributionForType, setAttributionForType] = useState<IOCType | null>(null);
  const [attributionInput, setAttributionInput] = useState('');
  const [exportForType, setExportForType] = useState<IOCType | null>(null);
  const [pushMessage, setPushMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmPushAll, setConfirmPushAll] = useState(false);
  const [confirmPushCategory, setConfirmPushCategory] = useState<IOCType | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const categoryExportRef = useRef<HTMLDivElement>(null);
  const pushMsgTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  useEffect(() => {
    if (!exportForType) return;
    const handler = (e: MouseEvent) => {
      if (categoryExportRef.current && !categoryExportRef.current.contains(e.target as Node)) {
        setExportForType(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportForType]);

  useEffect(() => {
    return () => clearTimeout(pushMsgTimeoutRef.current);
  }, []);

  const showPushMessage = (type: 'success' | 'error', text: string) => {
    setPushMessage({ type, text });
    clearTimeout(pushMsgTimeoutRef.current);
    if (type === 'success') {
      pushMsgTimeoutRef.current = setTimeout(() => setPushMessage(null), 5000);
    }
  };

  const doPushAll = async () => {
    if (!onPushIOCs || !analysis) return;
    const entries = [{ clipTitle: item.title, sourceUrl: item.sourceUrl, iocs: analysis.iocs, entityClsLevel: item.clsLevel }];
    const slug = slugify(item.title) || 'item';
    const ok = await onPushIOCs(entries, slug);
    if (ok) {
      showPushMessage('success', 'Pushed to OCI');
      onPushComplete?.();
    } else {
      showPushMessage('error', 'Push failed');
    }
  };

  const doPushCategory = async (type: IOCType) => {
    if (!onPushIOCs || !analysis) return;
    const typeIOCs = analysis.iocs.filter((ioc) => ioc.type === type && !ioc.dismissed);
    if (typeIOCs.length === 0) return;
    const entries = [{ clipTitle: item.title, sourceUrl: item.sourceUrl, iocs: typeIOCs, entityClsLevel: item.clsLevel }];
    const slug = slugify(item.title) || 'item';
    const typeSlug = type.replace(/[^a-z0-9]/g, '-');
    const ok = await onPushIOCs(entries, slug, typeSlug);
    if (ok) {
      showPushMessage('success', 'Pushed to OCI');
      onPushComplete?.();
    } else {
      showPushMessage('error', 'Push failed');
    }
  };

  const handlePushAll = () => {
    if (!ociWritePARConfigured || !onPushIOCs) return;
    if (lastPushedAt) {
      setConfirmPushAll(true);
    } else {
      doPushAll();
    }
  };

  const handlePushCategory = (type: IOCType) => {
    if (!ociWritePARConfigured || !onPushIOCs) return;
    if (lastPushedAt) {
      setConfirmPushCategory(type);
    } else {
      doPushCategory(type);
    }
  };

  const handleCategoryExport = (type: IOCType, format: 'json' | 'csv' | 'flat-json' | 'flat-csv' | 'stix') => {
    setExportForType(null);
    if (!analysis) return;
    const typeIOCs = analysis.iocs.filter((ioc) => ioc.type === type && !ioc.dismissed);
    if (typeIOCs.length === 0) return;
    const entries = [{ clipTitle: item.title, sourceUrl: item.sourceUrl, iocs: typeIOCs, entityClsLevel: item.clsLevel }];
    const slug = slugify(item.title) || 'item';
    const typeSlug = type.replace(/[^a-z0-9]/g, '-');
    if (format === 'stix') {
      downloadFile(formatIOCsSTIX(entries, tiExportConfig), `iocs-${slug}-${typeSlug}-stix.json`, 'application/json');
    } else if (format === 'flat-json') {
      downloadFile(formatIOCsFlatJSON(entries, tiExportConfig), `iocs-${slug}-${typeSlug}-flat.json`, 'application/json');
    } else if (format === 'flat-csv') {
      downloadFile(formatIOCsFlatCSV(entries, tiExportConfig), `iocs-${slug}-${typeSlug}-flat.csv`, 'text/csv');
    } else if (format === 'json') {
      downloadFile(formatIOCsJSON(entries), `iocs-${slug}-${typeSlug}.json`, 'application/json');
    } else {
      downloadFile(formatIOCsCSV(entries), `iocs-${slug}-${typeSlug}.csv`, 'text/csv');
    }
  };

  const handleBulkAttribution = (type: IOCType) => {
    if (!attributionInput.trim()) return;
    updateByType(type, { attribution: attributionInput.trim() });
    setAttributionForType(null);
    setAttributionInput('');
  };

  const handleExport = (format: 'json' | 'csv' | 'flat-json' | 'flat-csv' | 'stix') => {
    setShowExportMenu(false);
    if (!analysis || activeIOCs.length === 0) return;
    const entries = [{ clipTitle: item.title, sourceUrl: item.sourceUrl, iocs: analysis.iocs, entityClsLevel: item.clsLevel }];
    const slug = slugify(item.title) || 'item';
    if (format === 'stix') {
      downloadFile(formatIOCsSTIX(entries, tiExportConfig), `iocs-${slug}-stix.json`, 'application/json');
    } else if (format === 'flat-json') {
      downloadFile(formatIOCsFlatJSON(entries, tiExportConfig), `iocs-${slug}-flat.json`, 'application/json');
    } else if (format === 'flat-csv') {
      downloadFile(formatIOCsFlatCSV(entries, tiExportConfig), `iocs-${slug}-flat.csv`, 'text/csv');
    } else if (format === 'json') {
      downloadFile(formatIOCsJSON(entries), `iocs-${slug}.json`, 'application/json');
    } else {
      downloadFile(formatIOCsCSV(entries), `iocs-${slug}.csv`, 'text/csv');
    }
  };

  const toggleType = (type: IOCType) => {
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Group active IOCs by type
  const grouped = new Map<IOCType, IOCEntry[]>();
  for (const ioc of activeIOCs) {
    const list = grouped.get(ioc.type) || [];
    list.push(ioc);
    grouped.set(ioc.type, list);
  }

  return (
    <div className="shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden" style={style || { width: '20rem' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <Shield size={16} className="text-accent" />
        <span className="text-sm font-medium text-gray-200 flex-1">IOC Analysis</span>
        {iocCount > 0 && (
          <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">{iocCount}</span>
        )}
        <button
          onClick={analyze}
          disabled={analyzing}
          className={cn('p-1 rounded text-gray-500 hover:text-gray-300', analyzing && 'animate-spin')}
          title="Re-analyze"
          aria-label="Re-analyze IOCs"
        >
          <RefreshCw size={14} />
        </button>
        {analysis && activeIOCs.length > 0 && (
          <>
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="p-1 rounded text-gray-500 hover:text-gray-300"
                title="Download IOCs"
                aria-label="Download IOCs"
              >
                <Download size={14} />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10">
                  <button onClick={() => handleExport('flat-json')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 rounded-t-lg">Export JSON (flat)</button>
                  <button onClick={() => handleExport('flat-csv')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Export CSV (flat)</button>
                  <button onClick={() => handleExport('json')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Export JSON (grouped)</button>
                  <button onClick={() => handleExport('csv')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Export CSV (grouped)</button>
                  <button onClick={() => handleExport('stix')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 rounded-b-lg">Export STIX 2.1</button>
                </div>
              )}
            </div>
            <button
              onClick={handlePushAll}
              disabled={!ociWritePARConfigured || ociPushing}
              className="p-1 rounded text-gray-500 hover:text-gray-300 disabled:opacity-50"
              title={ociWritePARConfigured ? 'Push IOCs to OCI' : 'Configure write PAR in Settings to push IOCs'}
              aria-label="Push IOCs to OCI"
            >
              <Upload size={14} />
            </button>
          </>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-500 hover:text-gray-300"
          title="Close panel"
          aria-label="Close IOC panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Push notification */}
      {pushMessage && (
        <div className={cn(
          'px-3 py-1.5 text-xs shrink-0',
          pushMessage.type === 'success' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
        )}>
          {pushMessage.text}
        </div>
      )}

      {/* Last pushed indicator */}
      {lastPushedAt && !pushMessage && (
        <div className="px-3 py-1 text-[10px] text-gray-500 shrink-0">
          Last pushed {formatDate(lastPushedAt)}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {!analysis ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-600">
            <Shield size={32} className="mb-2" />
            <p className="text-sm">No analysis yet</p>
            <button
              onClick={analyze}
              className="mt-2 text-xs text-accent hover:text-accent-hover"
            >
              Analyze now
            </button>
          </div>
        ) : (
          <>
            {/* Analysis summary */}
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">Analysis Summary</label>
              <textarea
                value={analysis.analysisSummary || ''}
                onChange={(e) => updateSummary(e.target.value)}
                className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-2 mt-1 focus:outline-none focus:ring-1 focus:ring-gray-600 resize-none"
                rows={2}
                placeholder="Add analysis notes..."
              />
            </div>

            {/* Grouped IOCs */}
            {activeIOCs.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">No IOCs found</p>
            ) : (
              [...grouped.entries()].map(([type, iocs]) => {
                const { label, color } = IOC_TYPE_LABELS[type];
                const isCollapsed = collapsedTypes.has(type);

                return (
                  <div key={type}>
                    <div className="flex items-center gap-1 py-1">
                      <button
                        onClick={() => toggleType(type)}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        {isCollapsed ? <ChevronRight size={12} className="text-gray-500" /> : <ChevronDown size={12} className="text-gray-500" />}
                        <span className="text-xs font-medium" style={{ color }}>{label}</span>
                        <span className="text-[10px] text-gray-500">({iocs.length})</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); dismissByType(type); }}
                        className="p-0.5 rounded text-gray-600 hover:text-red-400"
                        title="Dismiss all"
                        aria-label={`Dismiss all ${label}`}
                      >
                        <XCircle size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (attributionForType === type) {
                            setAttributionForType(null);
                            setAttributionInput('');
                          } else {
                            setAttributionForType(type);
                            setAttributionInput('');
                          }
                        }}
                        className={cn('p-0.5 rounded', attributionForType === type ? 'text-accent' : 'text-gray-600 hover:text-gray-300')}
                        title="Set attribution"
                        aria-label={`Set attribution for all ${label}`}
                      >
                        <Tag size={12} />
                      </button>
                      <div className="relative" ref={exportForType === type ? categoryExportRef : undefined}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExportForType(exportForType === type ? null : type);
                          }}
                          className={cn('p-0.5 rounded', exportForType === type ? 'text-accent' : 'text-gray-600 hover:text-gray-300')}
                          title="Download category"
                          aria-label={`Download ${label} IOCs`}
                        >
                          <Download size={12} />
                        </button>
                        {exportForType === type && (
                          <div className="absolute right-0 top-full mt-1 w-36 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10">
                            <button onClick={() => handleCategoryExport(type, 'flat-json')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 rounded-t-lg">JSON (flat)</button>
                            <button onClick={() => handleCategoryExport(type, 'flat-csv')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">CSV (flat)</button>
                            <button onClick={() => handleCategoryExport(type, 'json')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">JSON (grouped)</button>
                            <button onClick={() => handleCategoryExport(type, 'csv')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">CSV (grouped)</button>
                            <button onClick={() => handleCategoryExport(type, 'stix')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">STIX 2.1</button>
                            <button
                              onClick={() => {
                                setExportForType(null);
                                handlePushCategory(type);
                              }}
                              disabled={!ociWritePARConfigured || ociPushing}
                              className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 rounded-b-lg disabled:opacity-50', ociWritePARConfigured ? 'text-accent' : 'text-gray-500')}
                            >
                              Push to OCI (flat)
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {attributionForType === type && (
                      <div className="flex items-end gap-1 ml-4 mb-1">
                        <div className="flex-1">
                          <AttributionComboInput
                            value={attributionInput}
                            onChange={setAttributionInput}
                            actors={attributionActors ?? []}
                            placeholder="Actor name..."
                          />
                        </div>
                        <button
                          onClick={() => handleBulkAttribution(type)}
                          disabled={!attributionInput.trim()}
                          className="p-1 rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40"
                          title="Apply attribution"
                          aria-label="Apply attribution to all"
                        >
                          <Check size={12} />
                        </button>
                      </div>
                    )}
                    {!isCollapsed && (
                      <div className="space-y-1 ml-4 mt-1">
                        {iocs.map((ioc) => (
                          <IOCItem
                            key={ioc.id}
                            ioc={ioc}
                            onUpdate={updateIOC}
                            onDismiss={dismissIOC}
                            onRestore={restoreIOC}
                            attributionActors={attributionActors}
                            threatIntelConfig={threatIntelConfig}
                            allIOCs={analysis?.iocs}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Dismissed IOCs */}
            {dismissedIOCs.length > 0 && (
              <div>
                <button
                  onClick={() => setShowDismissed(!showDismissed)}
                  className="flex items-center gap-2 w-full text-left py-1"
                >
                  {showDismissed ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
                  <span className="text-xs font-medium text-gray-500">Dismissed</span>
                  <span className="text-[10px] text-gray-600">({dismissedIOCs.length})</span>
                </button>
                {showDismissed && (
                  <div className="space-y-1 ml-4 mt-1">
                    {dismissedIOCs.map((ioc) => (
                      <IOCItem
                        key={ioc.id}
                        ioc={ioc}
                        onUpdate={updateIOC}
                        onDismiss={dismissIOC}
                        onRestore={restoreIOC}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirm dialogs for duplicate push */}
      <ConfirmDialog
        open={confirmPushAll}
        onClose={() => setConfirmPushAll(false)}
        onConfirm={() => doPushAll()}
        title="Push IOCs Again?"
        message={`IOCs from this report were already pushed ${lastPushedAt ? formatDate(lastPushedAt) : ''}. Push again?`}
        confirmLabel="Push Again"
      />
      <ConfirmDialog
        open={confirmPushCategory !== null}
        onClose={() => setConfirmPushCategory(null)}
        onConfirm={() => { if (confirmPushCategory) doPushCategory(confirmPushCategory); }}
        title="Push IOCs Again?"
        message={`IOCs from this report were already pushed ${lastPushedAt ? formatDate(lastPushedAt) : ''}. Push this category again?`}
        confirmLabel="Push Again"
      />
    </div>
  );
}
