import { useState } from 'react';
import { Plus, Trash2, Edit3, ChevronDown, ChevronRight, BookOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import type { PlaybookTemplate, PlaybookStep, Priority } from '../../types';
import { Modal } from '../Common/Modal';
import { ConfirmDialog } from '../Common/ConfirmDialog';


interface PlaybookManagerProps {
  playbooks: PlaybookTemplate[];
  userPlaybooks: PlaybookTemplate[];
  onCreatePlaybook: (data: Partial<PlaybookTemplate> & { name: string; steps: PlaybookStep[] }) => Promise<PlaybookTemplate>;
  onUpdatePlaybook: (id: string, updates: Partial<PlaybookTemplate>) => Promise<void>;
  onDeletePlaybook: (id: string) => Promise<void>;
}

const EMPTY_STEP: PlaybookStep = { order: 0, entityType: 'task', title: '', content: '', phase: '' };

export function PlaybookManager({
  playbooks,
  userPlaybooks,
  onCreatePlaybook,
  onUpdatePlaybook,
  onDeletePlaybook,
}: PlaybookManagerProps) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<PlaybookTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIcon, setFormIcon] = useState('');
  const [formType, setFormType] = useState('custom');
  const [formClsLevel, setFormClsLevel] = useState('');
  const [formDefaultTags, setFormDefaultTags] = useState('');
  const [formSteps, setFormSteps] = useState<PlaybookStep[]>([]);

  const builtinPlaybooks = playbooks.filter((p) => p.source === 'builtin');

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormIcon('');
    setFormType('custom');
    setFormClsLevel('');
    setFormDefaultTags('');
    setFormSteps([]);
  };

  const openCreate = () => {
    resetForm();
    setCreating(true);
    setEditing(null);
  };

  const openEdit = (pb: PlaybookTemplate) => {
    setFormName(pb.name);
    setFormDescription(pb.description || '');
    setFormIcon(pb.icon || '');
    setFormType(pb.investigationType);
    setFormClsLevel(pb.defaultClsLevel || '');
    setFormDefaultTags(pb.defaultTags?.join(', ') || '');
    setFormSteps([...pb.steps]);
    setEditing(pb);
    setCreating(false);
  };

  const addStep = () => {
    setFormSteps((prev) => [...prev, { ...EMPTY_STEP, order: prev.length + 1 }]);
  };

  const updateStep = (idx: number, updates: Partial<PlaybookStep>) => {
    setFormSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...updates } : s)));
  };

  const removeStep = (idx: number) => {
    setFormSteps((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  };

  const handleSave = async () => {
    if (!formName.trim() || formSteps.length === 0) return;
    const steps = formSteps.map((s, i) => ({ ...s, order: i + 1, title: s.title.trim(), content: s.content.trim(), phase: s.phase?.trim() || undefined, tags: s.tags }));
    const defaultTags = formDefaultTags.split(',').map((t) => t.trim()).filter(Boolean);

    try {
      if (editing) {
        await onUpdatePlaybook(editing.id, {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          icon: formIcon.trim() || undefined,
          investigationType: formType.trim() || 'custom',
          defaultClsLevel: formClsLevel.trim() || undefined,
          defaultTags: defaultTags.length > 0 ? defaultTags : undefined,
          steps,
        });
        setEditing(null);
        addToast('success', t('templates.playbookUpdatedToast', { name: formName.trim() }));
      } else {
        await onCreatePlaybook({
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          icon: formIcon.trim() || undefined,
          investigationType: formType.trim() || 'custom',
          defaultClsLevel: formClsLevel.trim() || undefined,
          defaultTags: defaultTags.length > 0 ? defaultTags : undefined,
          steps,
        });
        setCreating(false);
        addToast('success', t('templates.playbookCreatedToast', { name: formName.trim() }));
      }
      resetForm();
    } catch {
      addToast('error', t('templates.playbookSaveFailed'));
    }
  };

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-gray-100 transition-colors"
        >
          <BookOpen size={16} />
          {t('templates.playbooks')}
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="text-xs text-gray-500">{t('templates.summary', { custom: userPlaybooks.length, builtin: builtinPlaybooks.length })}</span>
      </div>

      {expanded && (
        <div className="space-y-3 pl-1">
          <p className="text-xs text-gray-500">
            {t('templates.playbooksDesc')}
          </p>

          {/* User playbooks */}
          {userPlaybooks.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-gray-400">{t('templates.yourPlaybooks')}</h4>
              {userPlaybooks.map((pb) => (
                <div key={pb.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-800/50 border border-gray-700/50">
                  <div className="flex items-center gap-2 min-w-0">
                    {pb.icon && <span className="text-sm">{pb.icon}</span>}
                    <div className="min-w-0">
                      <div className="text-sm text-gray-200 truncate">{pb.name}</div>
                      <div className="text-[10px] text-gray-500">{t('templates.steps', { count: pb.steps.length })}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(pb)} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300" title={tc('edit')}>
                      <Edit3 size={13} />
                    </button>
                    <button onClick={() => setDeleteConfirmId(pb.id)} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400" title={tc('delete')}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Built-in playbooks (read-only) */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-gray-400">{t('templates.builtinPlaybooks')}</h4>
            {builtinPlaybooks.map((pb) => (
              <div key={pb.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-800/30 border border-gray-700/30">
                {pb.icon && <span className="text-sm">{pb.icon}</span>}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-400 truncate">{pb.name}</div>
                  <div className="text-[10px] text-gray-500">{t('templates.steps', { count: pb.steps.length })}</div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 text-xs font-medium transition-colors"
          >
            <Plus size={14} />
            {t('templates.newPlaybook')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={async () => {
          if (deleteConfirmId) {
            const pb = userPlaybooks.find(p => p.id === deleteConfirmId);
            await onDeletePlaybook(deleteConfirmId);
            addToast('success', t('templates.playbookDeletedToast', { name: pb?.name }));
          }
          setDeleteConfirmId(null);
        }}
        title={t('templates.deletePlaybook')}
        message={t('templates.deletePlaybookMessage')}
        confirmLabel={t('templates.deletePlaybookConfirm')}
        danger
      />

      {/* Create/Edit modal */}
      <Modal open={creating || editing !== null} onClose={() => { setCreating(false); setEditing(null); resetForm(); }} title={editing ? t('templates.editPlaybook') : t('templates.createPlaybook')} wide>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="pb-name" className="block text-xs font-medium text-gray-400 mb-1">{t('templates.playbookName')}</label>
              <input id="pb-name" type="text" maxLength={200} value={formName} onChange={(e) => setFormName(e.target.value)} className={inputClass} placeholder={t('templates.playbookNamePlaceholder')} />
            </div>
            <div className="w-20">
              <label htmlFor="pb-icon" className="block text-xs font-medium text-gray-400 mb-1">{t('templates.playbookIcon')}</label>
              <input id="pb-icon" value={formIcon} onChange={(e) => setFormIcon(e.target.value)} className={inputClass} placeholder={t('templates.playbookIconPlaceholder')} />
            </div>
          </div>

          <div>
            <label htmlFor="pb-description" className="block text-xs font-medium text-gray-400 mb-1">{t('templates.playbookDescription')}</label>
            <input id="pb-description" type="text" maxLength={500} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className={inputClass} placeholder={t('templates.playbookDescPlaceholder')} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="pb-type" className="block text-xs font-medium text-gray-400 mb-1">{t('templates.investigationType')}</label>
              <input id="pb-type" type="text" maxLength={200} value={formType} onChange={(e) => setFormType(e.target.value)} className={inputClass} placeholder={t('templates.investigationTypePlaceholder')} />
            </div>
            <div className="flex-1">
              <label htmlFor="pb-cls" className="block text-xs font-medium text-gray-400 mb-1">{t('templates.defaultClassification')}</label>
              <select id="pb-cls" value={formClsLevel} onChange={(e) => setFormClsLevel(e.target.value)} className={inputClass}>
                <option value="">{tc('none')}</option>
                <option value="TLP:CLEAR">TLP:CLEAR</option>
                <option value="TLP:GREEN">TLP:GREEN</option>
                <option value="TLP:AMBER">TLP:AMBER</option>
                <option value="TLP:AMBER+STRICT">TLP:AMBER+STRICT</option>
                <option value="TLP:RED">TLP:RED</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="pb-tags" className="block text-xs font-medium text-gray-400 mb-1">{t('templates.defaultTags')}</label>
            <input id="pb-tags" value={formDefaultTags} onChange={(e) => setFormDefaultTags(e.target.value)} className={inputClass} placeholder={t('templates.defaultTagsPlaceholder')} />
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400">{t('templates.stepsLabel', { count: formSteps.length })}</label>
              <button onClick={addStep} className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs">
                <Plus size={12} /> {t('templates.addStep')}
              </button>
            </div>

            {formSteps.map((step, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/50 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-4">{idx + 1}</span>
                  <select
                    value={step.entityType}
                    onChange={(e) => updateStep(idx, { entityType: e.target.value as 'task' | 'note' })}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                    aria-label={`Step ${idx + 1} type`}
                  >
                    <option value="task">{t('templates.stepType.task')}</option>
                    <option value="note">{t('templates.stepType.note')}</option>
                  </select>
                  <input
                    value={step.title}
                    onChange={(e) => updateStep(idx, { title: e.target.value })}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                    placeholder={t('templates.stepTitlePlaceholder')}
                    aria-label={`Step ${idx + 1} title`}
                  />
                  <button onClick={() => removeStep(idx)} aria-label={tc('remove')} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400">
                    <X size={12} />
                  </button>
                </div>
                <div className="flex gap-2 pl-6">
                  <input
                    value={step.phase || ''}
                    onChange={(e) => updateStep(idx, { phase: e.target.value })}
                    className="w-32 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                    placeholder={t('templates.stepPhasePlaceholder')}
                    aria-label={`Step ${idx + 1} phase`}
                  />
                  {step.entityType === 'task' && (
                    <select
                      value={step.priority || 'none'}
                      onChange={(e) => updateStep(idx, { priority: e.target.value as Priority })}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                      aria-label={`Step ${idx + 1} priority`}
                    >
                      <option value="none">{t('templates.noPriority')}</option>
                      <option value="low">{t('templates.priorityLow')}</option>
                      <option value="medium">{t('templates.priorityMedium')}</option>
                      <option value="high">{t('templates.priorityHigh')}</option>
                    </select>
                  )}
                </div>
                <textarea
                  value={step.content}
                  onChange={(e) => updateStep(idx, { content: e.target.value })}
                  className="w-full pl-6 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent h-16 resize-y"
                  placeholder={step.entityType === 'task' ? t('templates.taskDescPlaceholder') : t('templates.noteContentPlaceholder')}
                  aria-label={`Step ${idx + 1} content`}
                />
              </div>
            ))}

            {formSteps.length === 0 && (
              <p className="text-xs text-gray-600 italic py-3 text-center">{t('templates.noSteps')}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-gray-900 py-3">
            <button onClick={() => { setCreating(false); setEditing(null); resetForm(); }} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm">{tc('cancel')}</button>
            <button onClick={handleSave} disabled={!formName.trim() || formSteps.length === 0} className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-50">{editing ? tc('save') : tc('create')}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
