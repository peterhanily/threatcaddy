import { useState, useRef, useEffect } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useIntegrations } from '../../hooks/useIntegrations';
import { useToast } from '../../contexts/ToastContext';
import { IntegrationExecutor } from '../../lib/integration-executor';
import { IntegrationResultModal } from './IntegrationResultModal';
import { db } from '../../db';
import type { IntegrationRun } from '../../types/integration-types';

interface RunIntegrationMenuProps {
  ioc: { id: string; value: string; type: string; confidence: string };
  investigation?: { id: string; name: string };
  onComplete?: (run: IntegrationRun) => void;
}

export function RunIntegrationMenu({ ioc, investigation, onComplete }: RunIntegrationMenuProps) {
  const { getInstallationsForIOCType, addRun } = useIntegrations();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [resultRun, setResultRun] = useState<IntegrationRun | null>(null);
  const [showResults, setShowResults] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const matching = getInstallationsForIOCType(ioc.type);

  // Close menu on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (matching.length === 0) return null;

  const handleRun = async (installationId: string, templateId: string) => {
    setOpen(false);
    setRunning(true);

    try {
      const match = matching.find(
        (m) => m.installation.id === installationId && m.template.id === templateId,
      );
      if (!match) {
        addToast('error', 'Integration not found');
        setRunning(false);
        return;
      }

      const executor = new IntegrationExecutor();
      const run = await executor.run(
        match.template,
        match.installation,
        { ioc, investigation },
        {
          onCreateEntity: async (type, fields) => {
            const id = nanoid();
            const now = Date.now();
            switch (type) {
              case 'note':
                await db.notes.add({
                  id,
                  title: (fields.title as string) || 'Integration Note',
                  content: (fields.content as string) || '',
                  folderId: (fields.folderId as string) || investigation?.id,
                  tags: (fields.tags as string[]) || [],
                  iocTypes: [],
                  pinned: false,
                  archived: false,
                  trashed: false,
                  createdAt: now,
                  updatedAt: now,
                });
                break;
              case 'ioc':
                await db.standaloneIOCs.add({
                  id,
                  type: (fields.type as string) || 'domain',
                  value: (fields.value as string) || '',
                  confidence: (fields.confidence as string) || 'medium',
                  tags: (fields.tags as string[]) || [],
                  folderId: (fields.folderId as string) || investigation?.id,
                  trashed: false,
                  archived: false,
                  createdAt: now,
                  updatedAt: now,
                } as never);
                break;
              case 'task':
                await db.tasks.add({
                  id,
                  title: (fields.title as string) || 'Integration Task',
                  description: (fields.description as string) || '',
                  folderId: (fields.folderId as string) || investigation?.id,
                  status: 'todo',
                  priority: (fields.priority as string) || 'medium',
                  completed: false,
                  order: 0,
                  tags: (fields.tags as string[]) || [],
                  iocTypes: [],
                  trashed: false,
                  archived: false,
                  createdAt: now,
                  updatedAt: now,
                } as never);
                break;
            }
            return id;
          },
          onNotify: (message) => {
            addToast('info', message);
          },
        },
      );

      await addRun(run);

      if (run.status === 'success') {
        addToast('success', `Integration "${match.template.name}" completed successfully`);
      } else {
        addToast('error', `Integration "${match.template.name}" failed: ${run.error || run.status}`);
      }

      setResultRun(run);
      if (run.displayResults) {
        setShowResults(true);
      }

      onComplete?.(run);
    } catch (err) {
      addToast('error', `Integration error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={running}
        className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-amber-400 transition-colors disabled:opacity-50"
        title="Run Integration"
      >
        {running ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Zap size={14} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1">
          <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider font-semibold border-b border-gray-700">
            Run Integration
          </div>
          {matching.map(({ installation, template }) => (
            <button
              key={installation.id}
              onClick={() => handleRun(installation.id, template.id)}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 hover:text-gray-100 transition-colors flex items-center gap-2"
            >
              <div
                className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                style={{ backgroundColor: template.color || '#6b7280' }}
              >
                {template.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate">{template.name}</div>
                <div className="text-[10px] text-gray-500 truncate">{template.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <IntegrationResultModal
        open={showResults}
        onClose={() => setShowResults(false)}
        run={resultRun}
      />
    </div>
  );
}
