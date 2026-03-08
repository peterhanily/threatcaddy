import { useState } from 'react';
import { Check, AlertCircle, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { Modal } from '../Common/Modal';
import type { IntegrationRun } from '../../types/integration-types';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

interface IntegrationResultModalProps {
  open: boolean;
  onClose: () => void;
  run: IntegrationRun | null;
}

export function IntegrationResultModal({ open, onClose, run }: IntegrationResultModalProps) {
  const [showLog, setShowLog] = useState(false);

  if (!run) return null;

  const statusColor =
    run.status === 'success'
      ? 'text-green-400'
      : run.status === 'error' || run.status === 'timeout' || run.status === 'cancelled'
        ? 'text-red-400'
        : 'text-yellow-400';

  const statusIcon =
    run.status === 'success' ? (
      <Check size={16} className="text-green-400" />
    ) : run.status === 'error' || run.status === 'timeout' || run.status === 'cancelled' ? (
      <AlertCircle size={16} className="text-red-400" />
    ) : (
      <Clock size={16} className="text-yellow-400 animate-pulse" />
    );

  const displayResults = run.displayResults as Record<string, unknown> | undefined;

  return (
    <Modal open={open} onClose={onClose} title="Integration Results" wide>
      <div className="space-y-4">
        {/* Summary */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            {statusIcon}
            <span className={`text-sm font-medium capitalize ${statusColor}`}>{run.status}</span>
            <span className="text-xs text-gray-500 ml-auto">
              {formatDuration(run.durationMs)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500">API Calls</div>
              <div className="text-gray-200 font-medium">{run.apiCallsMade}</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500">Created</div>
              <div className="text-gray-200 font-medium">{run.entitiesCreated}</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500">Updated</div>
              <div className="text-gray-200 font-medium">{run.entitiesUpdated}</div>
            </div>
          </div>

          {run.error && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded p-2">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{run.error}</span>
            </div>
          )}
        </div>

        {/* Display results */}
        {displayResults && Object.keys(displayResults).length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Results
            </h4>
            <div className="space-y-2">
              {Object.entries(displayResults).map(([key, value]) => (
                <div key={key} className="text-xs">
                  <span className="text-gray-500 font-medium">{key}:</span>{' '}
                  {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? (
                    <span className="text-gray-200">{String(value)}</span>
                  ) : (
                    <pre className="mt-1 bg-gray-900 border border-gray-700 rounded p-2 text-[10px] text-gray-400 overflow-x-auto max-h-40 overflow-y-auto font-mono">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step log */}
        {run.log.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
            <button
              onClick={() => setShowLog((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors w-full"
            >
              {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Step Log ({run.log.length} entries)
            </button>

            {showLog && (
              <div className="space-y-0.5 max-h-60 overflow-y-auto">
                {run.log.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-[10px] font-mono"
                  >
                    <span className="text-gray-600 shrink-0 w-14 text-right">
                      {entry.durationMs != null ? formatDuration(entry.durationMs) : ''}
                    </span>
                    <span
                      className={
                        entry.type === 'step-error'
                          ? 'text-red-400'
                          : entry.type === 'step-complete'
                            ? 'text-green-400'
                            : entry.type === 'entity-created'
                              ? 'text-blue-400'
                              : 'text-gray-400'
                      }
                    >
                      [{entry.type}]
                    </span>
                    <span className="text-gray-300">{entry.stepLabel}</span>
                    {entry.detail && (
                      <span className="text-gray-600 truncate">{entry.detail}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input/Output summary */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-gray-800 border border-gray-700 rounded p-2">
            <div className="text-gray-500 mb-1">Input</div>
            <div className="text-gray-300">{run.inputSummary || 'None'}</div>
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded p-2">
            <div className="text-gray-500 mb-1">Output</div>
            <div className="text-gray-300">{run.outputSummary || 'None'}</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
