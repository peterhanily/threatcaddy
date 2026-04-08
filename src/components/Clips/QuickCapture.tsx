import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Modal } from '../Common/Modal';
import type { Note, Folder, NoteTemplate } from '../../types';

interface QuickCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (data: Partial<Note>) => void | Promise<void>;
  folders?: Folder[];
  defaultFolderId?: string;
  templates?: NoteTemplate[];
}

export function QuickCapture({ open, onClose, onCapture, folders = [], defaultFolderId, templates = [] }: QuickCaptureProps) {
  const { t } = useTranslation('common');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [folderId, setFolderId] = useState(defaultFolderId || '');
  const [saving, setSaving] = useState(false);
  const titleTouchedByUser = useRef(false);

  // Keep folderId in sync when the active investigation changes
  useEffect(() => {
    setFolderId(defaultFolderId || '');
  }, [defaultFolderId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onCapture({
        title: title.trim() || 'Untitled',
        content: content.trim(),
        sourceUrl: sourceUrl.trim() || undefined,
        sourceTitle: title.trim() || undefined,
        folderId: folderId || undefined,
      });
      setTitle('');
      setContent('');
      setSourceUrl('');
      setFolderId(defaultFolderId || '');
      titleTouchedByUser.current = false;
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (tpl: NoteTemplate) => {
    setContent(tpl.content);
    if (!titleTouchedByUser.current) {
      setTitle(tpl.name);
    }
  };

  const templatesByCategory = useMemo(() => {
    const map: Record<string, NoteTemplate[]> = {};
    for (const tpl of templates) {
      (map[tpl.category] ??= []).push(tpl);
    }
    return map;
  }, [templates]);

  const categoryOrder = useMemo(() => {
    // Stable ordering: known categories first, then custom/user ones
    const known = ['General', 'Investigation', 'Incident Response', 'Cloud', 'Custom'];
    const cats = Object.keys(templatesByCategory);
    const ordered: string[] = [];
    for (const k of known) {
      if (cats.includes(k)) ordered.push(k);
    }
    for (const c of cats) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    return ordered;
  }, [templatesByCategory]);

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';

  return (
    <Modal open={open} onClose={onClose} title={t('quickCapture.title')} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Templates */}
        {categoryOrder.map((cat) => (
          <div key={cat}>
            <label className="block text-xs font-medium text-gray-400 mb-2">{cat}</label>
            <div className="flex gap-2 flex-wrap">
              {(templatesByCategory[cat] || []).map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs border border-gray-700 transition-colors"
                >
                  {tpl.icon && <span>{tpl.icon}</span>}
                  {tpl.name}
                  {tpl.source === 'user' && <span className="text-[9px] text-accent/60 ml-0.5">{t('quickCapture.customBadge')}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">{t('quickCapture.titleLabel')}</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => { titleTouchedByUser.current = true; setTitle(e.target.value); }}
            className={inputClass}
            placeholder={t('quickCapture.titlePlaceholder')}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">{t('quickCapture.contentLabel')}</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className={`${inputClass} h-40 resize-none note-editor`}
            placeholder={t('quickCapture.contentPlaceholder')}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">{t('quickCapture.sourceUrlLabel')}</label>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className={inputClass}
            placeholder={t('quickCapture.sourceUrlPlaceholder')}
          />
        </div>

        {folders.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">{t('quickCapture.investigationLabel')}</label>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('quickCapture.noInvestigation')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? t('quickCapture.saving') : t('quickCapture.createNote')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
