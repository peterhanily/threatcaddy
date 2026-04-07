import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ChevronDown, FileText, FilePlus, ListChecks, Clock, PenTool, Shield, Database, FolderOpen } from 'lucide-react';

interface CreateDropdownProps {
  onQuickNote: () => void;
  onNewNote: () => void;
  onNewTask: () => void;
  onNewTimelineEvent: () => void;
  onNewWhiteboard: () => void;
  onNewIOC?: () => void;
  onOpenFile?: () => void;
  onImportData?: () => void;
}

export function CreateDropdown({ onQuickNote, onNewNote, onNewTask, onNewTimelineEvent, onNewWhiteboard, onNewIOC, onOpenFile, onImportData }: CreateDropdownProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) setHighlightIdx(-1);
  }, [open]);

  const items = [
    { icon: FilePlus, label: t('createDropdown.quickNote'), action: onQuickNote },
    { icon: FileText, label: t('createDropdown.noteTemplates'), action: onNewNote },
    { icon: ListChecks, label: t('createDropdown.task'), action: onNewTask },
    { icon: Clock, label: t('createDropdown.timelineEvent'), action: onNewTimelineEvent },
    { icon: PenTool, label: t('createDropdown.whiteboard'), action: onNewWhiteboard },
    ...(onNewIOC ? [{ icon: Shield, label: t('createDropdown.ioc'), action: onNewIOC }] : []),
    ...(onOpenFile ? [{ icon: FolderOpen, label: t('createDropdown.openFile'), action: onOpenFile }] : []),
    ...(onImportData ? [{ icon: Database, label: t('createDropdown.importData'), action: onImportData }] : []),
  ];

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((prev) => (prev + 1) % items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (highlightIdx >= 0) {
          items[highlightIdx].action();
          setOpen(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }, [open, highlightIdx, items]);

  return (
    <div className="relative" ref={ref}>
      <button
        data-tour="new-note"
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-sm font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-200"
        title={t('createDropdown.createNew')}
        aria-label={t('createDropdown.createNew')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={16} />
        <span className="hidden sm:inline">{t('createDropdown.new')}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div ref={menuRef} role="menu" className="absolute right-0 top-full mt-1 w-44 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50 py-1" onKeyDown={handleKeyDown}>
          {items.map((item, idx) => (
            <button
              key={item.label}
              role="menuitem"
              aria-label={t('createDropdown.createItem', { item: item.label })}
              onClick={() => { item.action(); setOpen(false); }}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={`w-full flex items-center gap-2 px-3 py-2 sm:py-1.5 text-xs text-gray-300 min-h-[44px] sm:min-h-0 ${idx === highlightIdx ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
