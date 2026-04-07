import { useState } from 'react';
import { Plus, Trash2, Edit3, Copy, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import type { NoteTemplate } from '../../types';
import { Modal } from '../Common/Modal';

interface TemplateManagerProps {
  templates: NoteTemplate[];
  userTemplates: NoteTemplate[];
  categories: string[];
  onCreateTemplate: (data: Partial<NoteTemplate> & { name: string; content: string }) => Promise<NoteTemplate>;
  onUpdateTemplate: (id: string, updates: Partial<NoteTemplate>) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
  onDuplicateBuiltin: (builtinId: string) => Promise<NoteTemplate | null>;
}

export function TemplateManager({
  templates,
  userTemplates,
  categories,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onDuplicateBuiltin,
}: TemplateManagerProps) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<NoteTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('Custom');
  const [formIcon, setFormIcon] = useState('');
  const [formDescription, setFormDescription] = useState('');

  const resetForm = () => {
    setFormName('');
    setFormContent('');
    setFormCategory('Custom');
    setFormIcon('');
    setFormDescription('');
  };

  const openCreate = () => {
    resetForm();
    setCreating(true);
    setEditing(null);
  };

  const openEdit = (tpl: NoteTemplate) => {
    setFormName(tpl.name);
    setFormContent(tpl.content);
    setFormCategory(tpl.category);
    setFormIcon(tpl.icon || '');
    setFormDescription(tpl.description || '');
    setEditing(tpl);
    setCreating(false);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formContent.trim()) return;
    try {
      if (editing) {
        await onUpdateTemplate(editing.id, {
          name: formName.trim(),
          content: formContent.trim(),
          category: formCategory.trim() || 'Custom',
          icon: formIcon.trim() || undefined,
          description: formDescription.trim() || undefined,
        });
        setEditing(null);
        addToast('success', t('templates.savedToast', { name: formName.trim() }));
      } else {
        await onCreateTemplate({
          name: formName.trim(),
          content: formContent.trim(),
          category: formCategory.trim() || 'Custom',
          icon: formIcon.trim() || undefined,
          description: formDescription.trim() || undefined,
        });
        setCreating(false);
        addToast('success', t('templates.createdToast', { name: formName.trim() }));
      }
      resetForm();
    } catch {
      addToast('error', t('templates.saveFailed'));
    }
  };

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';

  const builtinTemplates = templates.filter((t) => t.source === 'builtin');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-gray-100 transition-colors"
        >
          <FileText size={16} />
          {t('templates.noteTemplates')}
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="text-xs text-gray-500">{t('templates.summary', { custom: userTemplates.length, builtin: builtinTemplates.length })}</span>
      </div>

      {expanded && (
        <div className="space-y-3 pl-1">
          <p className="text-xs text-gray-500">
            {t('templates.description')}
          </p>

          {/* User templates */}
          {userTemplates.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-gray-400">{t('templates.yourTemplates')}</h4>
              {userTemplates.map((tpl) => (
                <div key={tpl.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-800/50 border border-gray-700/50">
                  <div className="flex items-center gap-2 min-w-0">
                    {tpl.icon && <span className="text-sm">{tpl.icon}</span>}
                    <div className="min-w-0">
                      <div className="text-sm text-gray-200 truncate">{tpl.name}</div>
                      <div className="text-[10px] text-gray-500">{tpl.category}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(tpl)} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300" title={tc('edit')}>
                      <Edit3 size={13} />
                    </button>
                    <button onClick={async () => { await onDeleteTemplate(tpl.id); addToast('success', t('templates.deletedToast', { name: tpl.name })); }} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400" title={tc('delete')}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Built-in templates (read-only, can duplicate) */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-gray-400">{t('templates.builtinTemplates')}</h4>
            <div className="grid grid-cols-2 gap-1.5">
              {builtinTemplates.map((tpl) => (
                <div key={tpl.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-800/30 border border-gray-700/30">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {tpl.icon && <span className="text-xs">{tpl.icon}</span>}
                    <span className="text-xs text-gray-400 truncate">{tpl.name}</span>
                  </div>
                  <button
                    onClick={() => onDuplicateBuiltin(tpl.id)}
                    className="p-1 rounded hover:bg-gray-700 text-gray-600 hover:text-gray-300 shrink-0"
                    title={t('templates.duplicateAsCustom')}
                  >
                    <Copy size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 text-xs font-medium transition-colors"
          >
            <Plus size={14} />
            {t('templates.newTemplate')}
          </button>
        </div>
      )}

      {/* Create/Edit modal */}
      <Modal open={creating || editing !== null} onClose={() => { setCreating(false); setEditing(null); resetForm(); }} title={editing ? t('templates.editTemplate') : t('templates.createTemplate')} wide>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('templates.name')}</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} className={inputClass} placeholder={t('templates.namePlaceholder')} />
            </div>
            <div className="w-20">
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('templates.icon')}</label>
              <input value={formIcon} onChange={(e) => setFormIcon(e.target.value)} className={inputClass} placeholder={t('templates.iconPlaceholder')} />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('templates.category')}</label>
              <input
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className={inputClass}
                placeholder={t('templates.categoryPlaceholder')}
                list="template-categories"
              />
              <datalist id="template-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('templates.descriptionLabel')}</label>
              <input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className={inputClass} placeholder={t('templates.descriptionPlaceholder')} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">{t('templates.contentLabel')}</label>
            <textarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              className={`${inputClass} h-60 resize-y font-mono text-xs`}
              placeholder="# Template Title&#10;&#10;**Field:**&#10;&#10;## Section&#10;&#10;..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => { setCreating(false); setEditing(null); resetForm(); }} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm">{tc('cancel')}</button>
            <button onClick={handleSave} disabled={!formName.trim() || !formContent.trim()} className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-50">{editing ? tc('save') : tc('create')}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
