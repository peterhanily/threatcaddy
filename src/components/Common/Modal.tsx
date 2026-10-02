import { useEffect, useRef, useId, type ReactNode } from 'react';
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

const stack: HTMLElement[] = [];
let priorOverflow = '';
function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])')].filter(element => {
    if (element.matches(':disabled') || element.tabIndex < 0) return false;
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.hasAttribute('inert') || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  });
}

function updateStack() {
  stack.forEach((element, index) => { element.style.zIndex = String(10000 + index); });
}

export function Modal({ open, onClose, title, children, wide, extraWide }: ModalProps) {
  const { t } = useTranslation('common');
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Stable ref for onClose so the keydown listener doesn't churn
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const el = overlayRef.current;
    if (!open || !el) return;
    const previousFocus = document.activeElement as HTMLElement;
    if (!stack.length) { priorOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    // Child effects can run first when dialogs open in the same React commit.
    const descendant = stack.findIndex(item => el.contains(item));
    if (descendant < 0) stack.push(el); else stack.splice(descendant, 0, el);
    updateStack();
    const isTop = () => stack.at(-1) === el;
    const focusFirst = () => (focusable(el)[0] ?? el).focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable(el);
      const first = items[0] ?? el;
      const last = items.at(-1) ?? el;
      if (!el.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const handleFocus = (event: FocusEvent) => { if (isTop() && !el.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocus);
    if (isTop()) focusFirst();
    return () => {
      const wasTop = isTop();
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocus);
      const index = stack.indexOf(el);
      if (index >= 0) stack.splice(index, 1);
      updateStack();
      if (!stack.length) document.body.style.overflow = priorOverflow;
      if (wasTop) {
        const next = stack.at(-1);
        if (previousFocus?.isConnected && (!next || next.contains(previousFocus))) previousFocus.focus();
        else if (next) (focusable(next)[0] ?? next).focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === overlayRef.current && stack.at(-1) === overlayRef.current) onClose(); }}
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
