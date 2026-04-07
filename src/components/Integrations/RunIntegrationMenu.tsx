import { useState, useRef, useEffect } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { IntegrationExecutor } from '../../lib/integration-executor';
import type { ExecutionOptions } from '../../lib/integration-executor';
import { IntegrationResultModal } from './IntegrationResultModal';
import { db } from '../../db';
import type { IntegrationRun, InstalledIntegration, IntegrationTemplate } from '../../types/integration-types';
import type { StandaloneIOC } from '../../types';
import { currentLocale } from '../../lib/utils';

interface RunIntegrationMenuProps {
  ioc: { id: string; value: string; type: string; confidence: string };
  investigation?: { id: string; name: string };
  matching: Array<{ installation: InstalledIntegration; template: IntegrationTemplate }>;
  addRun: (run: IntegrationRun) => Promise<void>;
  onComplete?: (run: IntegrationRun) => void;
  onOpenSettings?: () => void;
}

export function RunIntegrationMenu({ ioc, investigation, matching, addRun, onComplete, onOpenSettings }: RunIntegrationMenuProps) {
  const { addToast } = useToast();
  const { connected, serverUrl, getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [resultRun, setResultRun] = useState<IntegrationRun | null>(null);
  const [showResults, setShowResults] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

      let pendingNoteId: string | null = null;
      const executor = new IntegrationExecutor();
      const execOptions: ExecutionOptions | undefined =
        connected && serverUrl
          ? { useServerProxy: { serverUrl, getAccessToken } }
          : undefined;
      const run = await executor.run(
        match.template,
        match.installation,
        { ioc, investigation },
        {
          onCreateEntity: async (type, fields) => {
            const id = nanoid();
            const now = Date.now();
            switch (type) {
              case 'note': {
                // Format note body: flattened enrichment list + raw JSON code block
                const transformResults = fields._transformResults as Record<string, Record<string, unknown>> | undefined;
                const rawResponses = fields._rawResponses as Record<string, unknown> | undefined;

                const bodyParts: string[] = [];

                // Flattened key-value list from transform results
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

                // Raw response JSON code block
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

                const noteContent = bodyParts.length > 0
                  ? bodyParts.join('\n')
                  : (fields.body as string) || (fields.content as string) || '';

                // Add timestamp to title
                const timestamp = new Date().toLocaleString(currentLocale(), {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                  timeZone: 'UTC',
                }) + ' UTC';
                const noteTitle = `${(fields.title as string) || 'Integration Note'} — ${timestamp}`;

                await db.notes.add({
                  id,
                  title: noteTitle,
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
                // Defer navigation until after run completes
                pendingNoteId = id;
                break;
              }
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
          onUpdateEntity: async (type, id, fields) => {
            if (type === 'ioc') {
              const existing = await db.standaloneIOCs.get(id);
              if (!existing) return;
              const updates: Partial<StandaloneIOC> = { updatedAt: Date.now() };
              // Copy simple scalar fields
              if (fields.iocStatus !== undefined) updates.iocStatus = fields.iocStatus as string;
              if (fields.confidence !== undefined) updates.confidence = fields.confidence as StandaloneIOC['confidence'];
              // Merge enrichment as timestamped snapshots
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
            }
          },
          onNotify: (message) => {
            addToast('info', message);
          },
        },
        undefined,
        execOptions,
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

      // Signal App to reload hooks and navigate to the created note
      if (pendingNoteId && run.status === 'success') {
        window.dispatchEvent(new CustomEvent('integration-entity-created', {
          detail: { noteId: pendingNoteId },
        }));
      }
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
        className={`p-1 rounded hover:bg-gray-700 transition-colors disabled:opacity-50 ${
          matching.length > 0
            ? 'text-amber-500/70 hover:text-amber-400'
            : 'text-gray-600 hover:text-gray-400'
        }`}
        title={matching.length > 0 ? 'Run Integration' : 'No integrations installed — set up in Settings > Integrations'}
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
          {matching.length === 0 ? (
            <button
              onClick={() => { setOpen(false); onOpenSettings?.(); }}
              className="w-full text-left px-3 py-3 text-xs text-gray-400 hover:bg-gray-700 transition-colors"
            >
              <p>No integrations for this IOC type.</p>
              <p className="text-amber-500/80 mt-1">Set up integrations →</p>
            </button>
          ) : (
            matching.map(({ installation, template }) => (
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
            ))
          )}
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
