import { useEffect, useRef } from 'react';

interface ShortcutHandlers {
  onNewNote?: () => void;
  onNewTask?: () => void;
  onSearch?: () => void;
  onSave?: () => void;
  onTogglePreview?: () => void;
  onEscape?: () => void;
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

      if (ctrl && e.key === '`') {
        e.preventDefault();
        h.onTogglePreview?.();
      }

      if (e.key === 'Escape') {
        h.onEscape?.();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
