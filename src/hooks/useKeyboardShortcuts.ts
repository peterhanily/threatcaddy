import { useEffect, useRef } from 'react';
import type { ViewMode } from '../types';

interface ShortcutHandlers {
  onNewNote?: () => void;
  onNewTask?: () => void;
  onSearch?: () => void;
  onSave?: () => void;
  onTogglePreview?: () => void;
  onEscape?: () => void;
  onSwitchView?: (view: ViewMode) => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const h = handlersRef.current;

      // Skip shortcuts when typing in inputs (except Ctrl+S save and Escape)
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement)?.isContentEditable;
      if (isEditable && !(ctrl && e.key === 's') && !(ctrl && e.key === 'e') && e.key !== 'Escape') return;

      if (ctrl && e.key === 'n') {
        e.preventDefault();
        h.onNewNote?.();
      }

      if (ctrl && !e.shiftKey && e.key === 'k') {
        e.preventDefault();
        h.onSearch?.();
      }

      if (ctrl && e.key === 's') {
        e.preventDefault();
        h.onSave?.();
      }

      if (ctrl && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        h.onNewTask?.();
      }

      if (ctrl && (e.key === '`' || e.key === 'e')) {
        e.preventDefault();
        h.onTogglePreview?.();
      }

      const viewKeys: Record<string, ViewMode> = { '1': 'notes', '2': 'tasks', '3': 'timeline', '4': 'whiteboard' };
      if (ctrl && viewKeys[e.key]) {
        e.preventDefault();
        h.onSwitchView?.(viewKeys[e.key]);
      }

      if (e.key === 'Escape') {
        h.onEscape?.();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
