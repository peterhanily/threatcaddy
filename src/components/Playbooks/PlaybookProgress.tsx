import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import type { PlaybookExecution, PlaybookExecutionStep } from '../../types';
import { formatDate } from '../../lib/utils';

interface PlaybookProgressProps {
  execution: PlaybookExecution;
  steps: { title: string; content: string; phase?: string }[];
  onToggleStep: (stepIndex: number, completed: boolean, notes?: string) => void;
  onUpdateStepNotes: (stepIndex: number, notes: string) => void;
  compact?: boolean;
}

export function PlaybookProgress({ execution, steps, onToggleStep, onUpdateStepNotes, compact }: PlaybookProgressProps) {
  const { t } = useTranslation('playbooks');
  const [expanded, setExpanded] = useState(!compact);
  const [editingNotes, setEditingNotes] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const completedCount = execution.steps.filter(s => s.completed).length;
  const totalSteps = steps.length;
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  const getStepExecution = (index: number): PlaybookExecutionStep | undefined => {
    return execution.steps.find(s => s.stepIndex === index);
  };

  const handleToggle = (index: number) => {
    const step = getStepExecution(index);
    const isCompleted = step?.completed ?? false;
    onToggleStep(index, !isCompleted);
  };

  const startEditingNotes = (index: number) => {
    const step = getStepExecution(index);
    setNotesDraft(step?.notes || '');
    setEditingNotes(index);
  };

  const saveNotes = (index: number) => {
    onUpdateStepNotes(index, notesDraft);
    setEditingNotes(null);
  };

  return (
    <div className="border border-gray-700/50 rounded-lg bg-gray-800/30 overflow-hidden">
      {/* Header with progress */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-gray-800/50 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-gray-500 shrink-0" /> : <ChevronRight size={14} className="text-gray-500 shrink-0" />}
        <span className="text-xs font-medium text-gray-300 truncate flex-1">
          {execution.templateName}
        </span>
        <span className="text-[10px] text-gray-500 tabular-nums shrink-0">
          {completedCount}/{totalSteps}
        </span>
      </button>

      {/* Progress bar */}
      <div className="h-1 bg-gray-800">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${progressPct}%`,
            backgroundColor: progressPct === 100 ? '#22c55e' : '#6366f1',
          }}
        />
      </div>

      {/* Steps */}
      {expanded && (
        <div className="px-3 py-2 space-y-1">
          {steps.map((step, i) => {
            const execStep = getStepExecution(i);
            const isCompleted = execStep?.completed ?? false;

            return (
              <div key={i} className="group">
                <div className="flex items-start gap-2 py-1">
                  <button
                    onClick={() => handleToggle(i)}
                    className={`w-4 h-4 mt-0.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isCompleted
                        ? 'border-green-500 bg-green-500'
                        : 'border-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {isCompleted && <Check size={10} className="text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs ${isCompleted ? 'text-gray-500 line-through' : 'text-gray-300'}`}>
                        {step.title}
                      </span>
                      {step.phase && (
                        <span className="text-[9px] px-1 py-0 rounded bg-gray-700/50 text-gray-500">
                          {step.phase}
                        </span>
                      )}
                    </div>
                    {!compact && step.content && (
                      <p className="text-[10px] text-gray-600 mt-0.5 line-clamp-1">{step.content}</p>
                    )}
                    {isCompleted && execStep?.completedAt && (
                      <span className="text-[10px] text-gray-600">
                        {formatDate(execStep.completedAt)}
                        {execStep.completedBy && ` by ${execStep.completedBy}`}
                      </span>
                    )}
                    {/* Notes */}
                    {editingNotes === i ? (
                      <div className="mt-1 flex gap-1">
                        <input
                          autoFocus
                          value={notesDraft}
                          onChange={e => setNotesDraft(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveNotes(i); if (e.key === 'Escape') setEditingNotes(null); }}
                          placeholder="Step notes..."
                          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-[10px] text-gray-200 focus:outline-none focus:border-gray-600"
                        />
                        <button onClick={() => saveNotes(i)} className="text-[10px] text-accent hover:text-accent-hover px-1">Save</button>
                      </div>
                    ) : execStep?.notes ? (
                      <button
                        onClick={() => startEditingNotes(i)}
                        className="text-[10px] text-gray-500 hover:text-gray-300 mt-0.5 flex items-center gap-0.5"
                      >
                        <MessageSquare size={9} />
                        {execStep.notes}
                      </button>
                    ) : (
                      <button
                        onClick={() => startEditingNotes(i)}
                        className="text-[10px] text-gray-600 hover:text-gray-400 mt-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                      >
                        {t('progress.addNote')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
