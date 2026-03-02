import { useState, useEffect, useRef } from 'react';
import { Modal } from '../Common/Modal';
import { CLIP_TEMPLATES } from './ClipTemplates';
import type { TemplateCategory } from './ClipTemplates';
import type { Note, Folder } from '../../types';

interface QuickCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (data: Partial<Note>) => void;
  folders?: Folder[];
  defaultFolderId?: string;
}

export function QuickCapture({ open, onClose, onCapture, folders = [], defaultFolderId }: QuickCaptureProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [folderId, setFolderId] = useState(defaultFolderId || '');
  const titleTouchedByUser = useRef(false);

  // Keep folderId in sync when the active investigation changes
  useEffect(() => {
    setFolderId(defaultFolderId || '');
  }, [defaultFolderId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCapture({
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
  };

  const applyTemplate = (templateName: string, templateContent: string) => {
    setContent(templateContent);
    if (!titleTouchedByUser.current) {
      setTitle(templateName);
    }
  };

  const templatesByCategory = CLIP_TEMPLATES.reduce((acc, tpl) => {
    (acc[tpl.category] ??= []).push(tpl);
    return acc;
  }, {} as Record<TemplateCategory, typeof CLIP_TEMPLATES>);

  const categoryOrder: TemplateCategory[] = ['General', 'Investigation', 'Cloud'];

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';

  return (
    <Modal open={open} onClose={onClose} title="Create Note" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Templates */}
        {categoryOrder.map((cat) => (
          <div key={cat}>
            <label className="block text-xs font-medium text-gray-400 mb-2">{cat}</label>
            <div className="flex gap-2 flex-wrap">
              {(templatesByCategory[cat] || []).map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => applyTemplate(tpl.name, tpl.content)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs border border-gray-700 transition-colors"
                >
                  <span>{tpl.icon}</span>
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Title</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => { titleTouchedByUser.current = true; setTitle(e.target.value); }}
            className={inputClass}
            placeholder="Note title..."
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Content (markdown)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className={`${inputClass} h-40 resize-none note-editor`}
            placeholder="Write or paste content..."
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Source URL (optional)</label>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className={inputClass}
            placeholder="https://..."
          />
        </div>

        {folders.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Investigation</label>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className={inputClass}
            >
              <option value="">No investigation</option>
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
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          >
            Create Note
          </button>
        </div>
      </form>
    </Modal>
  );
}
