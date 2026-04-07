import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickLink } from '../../types';
import { Modal } from '../Common/Modal';

const PRESET_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f97316',
  '#8b5cf6', '#eab308', '#ec4899', '#06b6d4',
];

interface QuickLinkFormProps {
  link?: QuickLink;
  onSave: (data: Partial<QuickLink>) => void;
  onCancel: () => void;
}

export function QuickLinkForm({ link, onSave, onCancel }: QuickLinkFormProps) {
  const { t } = useTranslation('dashboard');
  const [title, setTitle] = useState(link?.title || '');
  const [url, setUrl] = useState(link?.url || '');
  const [description, setDescription] = useState(link?.description || '');
  const [color, setColor] = useState(link?.color || PRESET_COLORS[0]);
  const [icon, setIcon] = useState(link?.icon || '');
  const [urlError, setUrlError] = useState('');

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const labelClass = 'text-sm text-gray-400';

  const validateUrl = (value: string): boolean => {
    if (!value.trim()) return false;
    try {
      const withProtocol = value.match(/^https?:\/\//) ? value : `https://${value}`;
      new URL(withProtocol);
      return true;
    } catch {
      return false;
    }
  };

  const handleSave = () => {
    if (!title.trim()) return;
    if (!validateUrl(url)) {
      setUrlError(t('quickLinks.invalidUrl'));
      return;
    }
    const normalizedUrl = url.match(/^https?:\/\//) ? url : `https://${url}`;
    onSave({
      title: title.trim(),
      url: normalizedUrl,
      description: description.trim() || undefined,
      color,
      icon: icon.trim() || undefined,
    });
  };

  return (
    <Modal open onClose={onCancel} title={link ? t('quickLinks.editLink') : t('quickLinks.addLinkTitle')}>
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Title *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            placeholder="e.g. VirusTotal"
            className={inputClass}
            autoFocus
          />
        </div>

        <div>
          <label className={labelClass}>URL *</label>
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            placeholder="e.g. virustotal.com"
            className={inputClass}
          />
          {urlError && <p className="text-xs text-red-400 mt-1">{urlError}</p>}
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            placeholder="Short description"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Icon (emoji)</label>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="e.g. \uD83D\uDD0D"
            className={`${inputClass} w-20`}
            maxLength={4}
          />
        </div>

        <div>
          <label className={labelClass}>Color</label>
          <div className="flex gap-2 mt-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? '#fff' : 'transparent',
                }}
                aria-label={`Select color ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || !url.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {link ? 'Save' : 'Add Link'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
