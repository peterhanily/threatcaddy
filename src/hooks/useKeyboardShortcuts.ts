import { useEffect } from 'react';

interface ShortcutHandlers {
  onNewNote?: () => void;
  onNewTask?: () => void;
  onSearch?: () => void;
  onSave?: () => void;
  onTogglePreview?: () => void;
  onEscape?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'n') {
        e.preventDefault();
        handlers.onNewNote?.();
      }

      if (ctrl && e.key === 'k') {
        e.preventDefault();
        handlers.onSearch?.();
      }

      if (ctrl && e.key === 's') {
        e.preventDefault();
        handlers.onSave?.();
      }

      if (ctrl && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        handlers.onNewTask?.();
      }

      if (ctrl && e.key === '`') {
        e.preventDefault();
        handlers.onTogglePreview?.();
      }

      if (e.key === 'Escape') {
        handlers.onEscape?.();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}
