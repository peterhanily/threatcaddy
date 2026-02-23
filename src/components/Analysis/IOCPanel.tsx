import { useState, useRef, useEffect } from 'react';
import { X, RefreshCw, ChevronDown, ChevronRight, Shield, Download } from 'lucide-react';
import type { IOCTarget, IOCEntry, IOCType, IOCAnalysis } from '../../types';
import { IOC_TYPE_LABELS } from '../../types';
import { useIOCAnalysis } from '../../hooks/useIOCAnalysis';
import { IOCItem } from './IOCItem';
import { cn } from '../../lib/utils';
import { formatIOCsJSON, formatIOCsCSV, slugify } from '../../lib/ioc-export';
import { downloadFile } from '../../lib/export';

interface IOCPanelProps {
  item: IOCTarget;
  onUpdate: (id: string, updates: { iocAnalysis?: IOCAnalysis; iocTypes?: IOCType[] }) => void;
  onClose: () => void;
}

export function IOCPanel({ item, onUpdate, onClose }: IOCPanelProps) {
  const {
    analysis,
    analyzing,
    analyze,
    updateIOC,
    updateSummary,
    dismissIOC,
    restoreIOC,
    iocCount,
    activeIOCs,
    dismissedIOCs,
  } = useIOCAnalysis({ item, onUpdate });

  const [collapsedTypes, setCollapsedTypes] = useState<Set<IOCType>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

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

  const handleExport = (format: 'json' | 'csv') => {
    setShowExportMenu(false);
    if (!analysis || activeIOCs.length === 0) return;
    const entries = [{ clipTitle: item.title, sourceUrl: item.sourceUrl, iocs: analysis.iocs }];
    const slug = slugify(item.title) || 'item';
    if (format === 'json') {
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
    <div className="w-80 shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden">
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
              <div className="absolute right-0 top-full mt-1 w-32 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10">
                <button onClick={() => handleExport('json')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 rounded-t-lg">Export JSON</button>
                <button onClick={() => handleExport('csv')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 rounded-b-lg">Export CSV</button>
              </div>
            )}
          </div>
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
                    <button
                      onClick={() => toggleType(type)}
                      className="flex items-center gap-2 w-full text-left py-1"
                    >
                      {isCollapsed ? <ChevronRight size={12} className="text-gray-500" /> : <ChevronDown size={12} className="text-gray-500" />}
                      <span className="text-xs font-medium" style={{ color }}>{label}</span>
                      <span className="text-[10px] text-gray-500">({iocs.length})</span>
                    </button>
                    {!isCollapsed && (
                      <div className="space-y-1 ml-4 mt-1">
                        {iocs.map((ioc) => (
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
    </div>
  );
}
