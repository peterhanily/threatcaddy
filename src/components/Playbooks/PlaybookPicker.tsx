import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Modal } from '../Common/Modal';
import type { PlaybookTemplate } from '../../types';
import { cn } from '../../lib/utils';

interface PlaybookPickerProps {
  open: boolean;
  onClose: () => void;
  playbooks: PlaybookTemplate[];
  onSelect: (playbookId: string, investigationName: string) => void;
  /** When set, applies playbook to an existing investigation (no name prompt). */
  applyToExisting?: string;
}

export function PlaybookPicker({ open, onClose, playbooks, onSelect, applyToExisting }: PlaybookPickerProps) {
  const [selectedPlaybook, setSelectedPlaybook] = useState<PlaybookTemplate | null>(null);
  const [investigationName, setInvestigationName] = useState('');

  const handleSelect = () => {
    if (!selectedPlaybook) return;
    if (applyToExisting) {
      onSelect(selectedPlaybook.id, applyToExisting);
      setSelectedPlaybook(null);
      onClose();
      return;
    }
    if (!investigationName.trim()) return;
    onSelect(selectedPlaybook.id, investigationName.trim());
    setSelectedPlaybook(null);
    setInvestigationName('');
    onClose();
  };

  const handleClose = () => {
    setSelectedPlaybook(null);
    setInvestigationName('');
    onClose();
  };

  if (selectedPlaybook) {
    const taskSteps = selectedPlaybook.steps.filter((s) => s.entityType === 'task');
    const noteSteps = selectedPlaybook.steps.filter((s) => s.entityType === 'note');
    const phases = [...new Set(selectedPlaybook.steps.map((s) => s.phase).filter(Boolean))];

    return (
      <Modal open={open} onClose={handleClose} title={selectedPlaybook.name} wide>
        <div className="space-y-4">
          {selectedPlaybook.description && (
            <p className="text-sm text-gray-400">{selectedPlaybook.description}</p>
          )}

          <div className="flex gap-4 text-xs text-gray-500">
            <span>{taskSteps.length} tasks</span>
            <span>{noteSteps.length} notes</span>
            {phases.length > 0 && <span>{phases.length} phases</span>}
            {selectedPlaybook.defaultClsLevel && (
              <span className="text-amber-400">{selectedPlaybook.defaultClsLevel}</span>
            )}
          </div>

          {phases.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-400">Phases</label>
              <div className="flex flex-wrap gap-1.5">
                {phases.map((phase) => (
                  <span key={phase} className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 text-xs border border-gray-700">
                    {phase}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            <label className="block text-xs font-medium text-gray-400">Steps</label>
            {selectedPlaybook.steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-300 py-1">
                <span className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] font-medium',
                  step.entityType === 'task' ? 'bg-green-900/30 text-green-400' : 'bg-blue-900/30 text-blue-400',
                )}>
                  {step.entityType}
                </span>
                <span className="truncate">{step.title}</span>
              </div>
            ))}
          </div>

          {!applyToExisting && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Investigation Name</label>
              <input
                autoFocus
                value={investigationName}
                onChange={(e) => setInvestigationName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSelect(); }}
                placeholder="Enter investigation name..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
              />
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setSelectedPlaybook(null)}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleSelect}
              disabled={!applyToExisting && !investigationName.trim()}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {applyToExisting ? 'Run Playbook' : 'Create Investigation'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title={applyToExisting ? 'Run Playbook' : 'Start from Playbook'}>
      <div className="space-y-3">
        <p className="text-xs text-gray-400">
          {applyToExisting
            ? 'Choose a playbook to add its tasks, notes, and templates to this investigation.'
            : 'Choose a playbook to auto-populate your investigation with tasks, notes, and templates.'}
        </p>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {playbooks.map((pb) => {
            const taskCount = pb.steps.filter((s) => s.entityType === 'task').length;
            const noteCount = pb.steps.filter((s) => s.entityType === 'note').length;
            return (
              <button
                key={pb.id}
                onClick={() => setSelectedPlaybook(pb)}
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors text-left"
              >
                {pb.icon && <span className="text-lg">{pb.icon}</span>}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-200">{pb.name}</div>
                  {pb.description && (
                    <div className="text-xs text-gray-500 truncate">{pb.description}</div>
                  )}
                  <div className="flex gap-3 mt-1 text-[10px] text-gray-500">
                    <span>{taskCount} tasks</span>
                    <span>{noteCount} notes</span>
                    {pb.source === 'user' && <span className="text-accent/60">custom</span>}
                  </div>
                </div>
                <ChevronRight size={14} className="text-gray-600 shrink-0" />
              </button>
            );
          })}
        </div>
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
