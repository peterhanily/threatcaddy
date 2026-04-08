import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  extraWide?: boolean;
}

export function Modal({ open, onClose, title, children, wide, extraWide }: ModalProps) {
  const { t } = useTranslation('common');
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = `modal-title-${title.replace(/\s+/g, '-').toLowerCase()}`;

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Stable ref for onClose so the keydown listener doesn't churn
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Focus trap
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { onCloseRef.current(); return; }
    if (e.key !== 'Tab') return;
    const el = overlayRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [contenteditable], [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      // Restore focus to the element that triggered the modal
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      return;
    }
    // Capture the currently-focused element before modal steals focus
    previousFocusRef.current = document.activeElement as HTMLElement;
    document.addEventListener('keydown', handleKeyDown);
    // Focus first focusable element only when modal opens
    const el = overlayRef.current;
    if (el) {
      const first = el.querySelector<HTMLElement>('input, select, textarea, button, [href], [contenteditable]');
      first?.focus();
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className={`bg-gray-900 dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-full ${extraWide ? 'max-w-5xl' : wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 id={titleId} className="text-lg font-semibold text-gray-100">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors" aria-label={t('close')}>
            <X size={20} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
