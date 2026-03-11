import { useState, useEffect, useCallback } from 'react';
import { X, Briefcase, FileBarChart, Share2, Cloud, CloudOff, Archive, Trash2, Printer, BookOpen } from 'lucide-react';
import type { Folder, InvestigationStatus, ClosureResolution, PlaybookStep } from '../../types';
import { NOTE_COLORS, CLOSURE_RESOLUTION_LABELS } from '../../types';
import { TagInput } from '../Common/TagInput';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import type { Tag } from '../../types';
import { cn, formatFullDate } from '../../lib/utils';
import { PlaybookProgress } from '../Playbooks/PlaybookProgress';

interface InvestigationDetailPanelProps {
  folder: Folder;
  onUpdate: (id: string, updates: Partial<Folder>) => void;
  onClose: () => void;
  allTags: Tag[];
  onCreateTag: (name: string) => Promise<Tag>;
  entityCounts: { notes: number; tasks: number; events: number; whiteboards: number };
  effectiveClsLevels: string[];
  onCreateTimeline?: (name: string) => Promise<{ id: string }>;
  onNavigateToTimeline?: (timelineId: string) => void;
  onExport?: (folderId: string) => void;
  onGenerateReport?: (folderId: string) => void;
  onPrintReport?: (folderId: string) => void;
  onShareLink?: (folderId: string) => void;
  serverConnected?: boolean;
  onToggleSync?: (folderId: string, syncEnabled: boolean) => void;
  playbookSteps?: PlaybookStep[];
  onRunPlaybook?: () => void;
  onArchive?: (folderId: string) => void;
  onUnarchive?: (folderId: string) => void;
  onDelete?: (folderId: string) => void;
}

const STATUS_OPTIONS: { value: InvestigationStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
];

export function InvestigationDetailPanel({
  folder,
  onUpdate,
  onClose,
  allTags,
  onCreateTag,
  entityCounts,
  effectiveClsLevels,
  onCreateTimeline,
  onNavigateToTimeline,
  onExport,
  onGenerateReport,
  onPrintReport,
  onShareLink,
  serverConnected,
  onToggleSync,
  playbookSteps,
  onRunPlaybook,
  onArchive,
  onUnarchive,
  onDelete,
}: InvestigationDetailPanelProps) {
  const [name, setName] = useState(folder.name);
  const [description, setDescription] = useState(folder.description || '');
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(folder.name);
    setDescription(folder.description || '');
  }, [folder.id, folder.name, folder.description]);

  const handleNameBlur = () => {
    if (name.trim() && name !== folder.name) {
      onUpdate(folder.id, { name: name.trim() });
    }
  };

  const handleDescriptionBlur = () => {
    if (description !== (folder.description || '')) {
      onUpdate(folder.id, { description: description.trim() || undefined });
    }
  };

  const status = folder.status || 'active';
  const totalEntities = entityCounts.notes + entityCounts.tasks + entityCounts.events + entityCounts.whiteboards;

  const handleCreateTimeline = async () => {
    if (!onCreateTimeline) return;
    const tl = await onCreateTimeline(folder.name);
    onUpdate(folder.id, { timelineId: tl.id });
  };

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-800">
          <Briefcase size={20} style={{ color: folder.color }} />
          <h2 className="text-lg font-semibold text-gray-100 flex-1">Investigation Details</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent h-20 resize-none"
              placeholder="Investigation description..."
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Status</label>
            <div className="flex gap-1">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    if (opt.value === 'closed') {
                      onUpdate(folder.id, { status: opt.value, closedAt: Date.now() });
                    } else {
                      onUpdate(folder.id, { status: opt.value, closureResolution: undefined, closedReason: undefined, closedAt: undefined });
                    }
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    status === opt.value
                      ? opt.value === 'active' ? 'bg-green-600/20 text-green-400 border border-green-600/40'
                        : opt.value === 'closed' ? 'bg-gray-600/20 text-gray-300 border border-gray-600/40'
                        : 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/40'
                      : 'bg-gray-800 text-gray-500 hover:text-gray-300 border border-gray-700'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Closure details (visible when status is closed) */}
            {status === 'closed' && (
              <div className="mt-3 pl-2 border-l-2 border-gray-700 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Resolution</label>
                  <select
                    value={folder.closureResolution || ''}
                    onChange={(e) => onUpdate(folder.id, { closureResolution: (e.target.value || undefined) as ClosureResolution | undefined })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
                  >
                    <option value="">Select resolution...</option>
                    {(Object.entries(CLOSURE_RESOLUTION_LABELS) as [ClosureResolution, string][]).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Closure Notes</label>
                  <textarea
                    value={folder.closedReason || ''}
                    onChange={(e) => onUpdate(folder.id, { closedReason: e.target.value || undefined })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent h-20 resize-none"
                    placeholder="Reason for closing..."
                  />
                </div>
                {folder.closedAt && (
                  <div className="text-xs text-gray-500">
                    Closed {formatFullDate(folder.closedAt)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Classification & PAP */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Classification</label>
              <select
                value={folder.clsLevel || ''}
                onChange={(e) => onUpdate(folder.id, { clsLevel: e.target.value || undefined })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
              >
                <option value="">None</option>
                {effectiveClsLevels.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">PAP Level</label>
              <select
                value={folder.papLevel || ''}
                onChange={(e) => onUpdate(folder.id, { papLevel: e.target.value || undefined })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
              >
                <option value="">None</option>
                <option value="PAP:WHITE">PAP:WHITE</option>
                <option value="PAP:GREEN">PAP:GREEN</option>
                <option value="PAP:AMBER">PAP:AMBER</option>
                <option value="PAP:RED">PAP:RED</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Tags</label>
            <TagInput
              selectedTags={folder.tags || []}
              allTags={allTags}
              onChange={(tags) => onUpdate(folder.id, { tags })}
              onCreateTag={onCreateTag}
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Color</label>
            <div className="flex gap-1.5">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c.value || 'none'}
                  onClick={() => onUpdate(folder.id, { color: c.value || undefined })}
                  className={cn(
                    'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                    folder.color === c.value || (!folder.color && !c.value) ? 'border-white' : 'border-transparent'
                  )}
                  style={{ backgroundColor: c.value || '#374151' }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Entity counts */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Contents ({totalEntities} items)</label>
            <div className="flex gap-3 text-xs text-gray-400">
              <span>{entityCounts.notes} notes</span>
              <span>{entityCounts.tasks} tasks</span>
              <span>{entityCounts.events} events</span>
              <span>{entityCounts.whiteboards} whiteboards</span>
            </div>
          </div>

          {/* Playbook Progress */}
          {folder.playbookExecution && playbookSteps && playbookSteps.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Playbook Progress</label>
              <PlaybookProgress
                execution={folder.playbookExecution}
                steps={playbookSteps.map(s => ({ title: s.title, content: s.content, phase: s.phase }))}
                onToggleStep={(stepIndex, completed) => {
                  const exec = folder.playbookExecution!;
                  const updatedSteps = exec.steps.map(s =>
                    s.stepIndex === stepIndex
                      ? { ...s, completed, completedAt: completed ? Date.now() : undefined }
                      : s
                  );
                  onUpdate(folder.id, {
                    playbookExecution: { ...exec, steps: updatedSteps },
                  });
                }}
                onUpdateStepNotes={(stepIndex, notes) => {
                  const exec = folder.playbookExecution!;
                  const updatedSteps = exec.steps.map(s =>
                    s.stepIndex === stepIndex ? { ...s, notes } : s
                  );
                  onUpdate(folder.id, {
                    playbookExecution: { ...exec, steps: updatedSteps },
                  });
                }}
              />
            </div>
          )}

          {/* Run Playbook */}
          {onRunPlaybook && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Playbook</label>
              <button
                onClick={onRunPlaybook}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 hover:text-gray-100 transition-colors border border-gray-700"
              >
                <BookOpen size={14} className="text-accent" />
                {folder.playbookExecution ? 'Run Another Playbook' : 'Run Playbook'}
              </button>
              {!folder.playbookExecution && (
                <p className="text-[11px] text-gray-500 mt-1">Add tasks, notes, and templates from a playbook</p>
              )}
            </div>
          )}

          {/* Timeline */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Investigation Timeline</label>
            {folder.timelineId ? (
              <button
                onClick={() => { if (folder.timelineId) onNavigateToTimeline?.(folder.timelineId); }}
                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-accent hover:text-accent-hover transition-colors"
              >
                View Timeline
              </button>
            ) : (
              <button
                onClick={handleCreateTimeline}
                disabled={!onCreateTimeline}
                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors disabled:opacity-50"
              >
                Create Investigation Timeline
              </button>
            )}
          </div>

          {/* Cloud Sync */}
          {serverConnected && onToggleSync && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Cloud Sync</label>
              <button
                onClick={() => onToggleSync(folder.id, !!folder.localOnly)}
                className={cn(
                  'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border transition-colors text-left',
                  folder.localOnly
                    ? 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                    : 'bg-purple/5 border-purple/30 hover:border-purple/50'
                )}
              >
                {folder.localOnly ? (
                  <CloudOff size={16} className="shrink-0 text-gray-500" />
                ) : (
                  <Cloud size={16} className="shrink-0 text-purple" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-200">
                    {folder.localOnly ? 'Local only' : 'Synced to server'}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {folder.localOnly
                      ? 'This investigation stays on your device only'
                      : 'Backed up and available for team sharing'}
                  </div>
                </div>
                <div className={cn(
                  'w-8 h-[18px] rounded-full transition-colors relative shrink-0',
                  folder.localOnly ? 'bg-gray-700' : 'bg-purple/60'
                )}>
                  <div className={cn(
                    'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all',
                    folder.localOnly ? 'left-[2px]' : 'left-[14px]'
                  )} />
                </div>
              </button>
            </div>
          )}

          {/* Export, Report & Share */}
          {(onExport || onGenerateReport || onPrintReport || onShareLink) && (
            <div className="flex gap-2 flex-wrap">
              {onExport && (
                <button
                  onClick={() => onExport(folder.id)}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
                >
                  Export Investigation
                </button>
              )}
              {onGenerateReport && (
                <button
                  onClick={() => onGenerateReport(folder.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
                >
                  <FileBarChart size={14} />
                  Generate Report
                </button>
              )}
              {onPrintReport && (
                <button
                  onClick={() => onPrintReport(folder.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
                >
                  <Printer size={14} />
                  Print / Save as PDF
                </button>
              )}
              {onShareLink && (
                <button
                  onClick={() => onShareLink(folder.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
                >
                  <Share2 size={14} />
                  Share Link
                </button>
              )}
            </div>
          )}

          {/* Archive & Delete */}
          {(onArchive || onUnarchive || onDelete) && (
            <div className="flex gap-2 pt-2 border-t border-gray-800">
              {status !== 'archived' && onArchive && (
                <button
                  onClick={() => { onArchive(folder.id); onClose(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-sm text-amber-400 transition-colors"
                >
                  <Archive size={14} />
                  Archive
                </button>
              )}
              {status === 'archived' && onUnarchive && (
                <button
                  onClick={() => { onUnarchive(folder.id); onClose(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-sm text-green-400 transition-colors"
                >
                  <Archive size={14} />
                  Unarchive
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => setShowConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-sm text-red-400 transition-colors ml-auto"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              )}
            </div>
          )}

          {/* Timestamps */}
          <div className="flex gap-4 text-xs text-gray-500 pt-2 border-t border-gray-800">
            <span>Created {formatFullDate(folder.createdAt)}</span>
            {folder.updatedAt && <span>Updated {formatFullDate(folder.updatedAt)}</span>}
          </div>
        </div>
      </div>

      {onDelete && (
        <ConfirmDialog
          open={showConfirmDelete}
          onClose={() => setShowConfirmDelete(false)}
          onConfirm={() => { onDelete(folder.id); onClose(); }}
          title="Delete Investigation"
          message={`Delete "${folder.name}" and all its contents? This cannot be undone.`}
          confirmLabel="Delete Investigation"
          danger
        />
      )}
    </div>
  );
}
