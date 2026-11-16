import { createContext, useContext, useInsertionEffect, useLayoutEffect, useRef, useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useScreenshare } from '../../hooks/ScreenshareContext';
import { useModalFocusExemptRegionShown } from '../../hooks/useModalFocusExemption';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  extraWide?: boolean;
  /** Retain a hidden editor without its focus trap or scroll lock. */
  suspended?: boolean;
}

const ModalSuspensionContext = createContext(false);
const stack: HTMLElement[] = [];
let priorOverflow = '';
let priorFocus: HTMLElement | null = null;
let focusRevision = 0;
function availableForFocus(element: HTMLElement): boolean {
  if (!element.isConnected || element.matches(':disabled')) return false;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (parent.hidden || parent.hasAttribute('inert') || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])')].filter(element => element.tabIndex >= 0 && availableForFocus(element));
}

function updateStack() {
  stack.forEach((element, index) => { element.style.zIndex = String(10000 + index); });
}

export function Modal({ open, onClose, title, children, wide, extraWide, suspended: requestedSuspension = false }: ModalProps) {
  const { t } = useTranslation('common');
  const { maxLevel } = useScreenshare();
  const inheritedSuspension = useContext(ModalSuspensionContext);
  const suspended = maxLevel !== null || requestedSuspension || inheritedSuspension;
  const exemptRegionShown = useModalFocusExemptRegionShown();
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Stable ref for onClose so the keydown listener doesn't churn
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; });

  // React applies a child's autoFocus before this component's layout effect.
  // Insertion effects run earlier in the same commit, while the opener still
  // has focus. The dialog's own content is never recorded as its opener, and
  // neither is <body>, where a browser leaves focus while screen sharing hides it.
  const openerRef = useRef<Element | null>(null);
  // Focus inside the dialog when its effect was last torn down, so a
  // StrictMode remount or the end of screen sharing returns there.
  const resumeRef = useRef<Element | null>(null);
  useInsertionEffect(() => {
    if (!open) { openerRef.current = null; return; }
    const active = document.activeElement;
    if (!suspended && active && active !== document.body && !overlayRef.current?.contains(active)) openerRef.current = active;
  }, [open, suspended]);

  // Install the stack, focus trap and Escape handler before the dialog paints.
  // A visible lazy-loaded dialog must already accept its first keyboard action.
  useLayoutEffect(() => {
    const el = overlayRef.current;
    if (!open || suspended || !el) return;
    focusRevision++;
    const previousFocus = openerRef.current as HTMLElement;
    if (!stack.length) {
      priorOverflow = document.body.style.overflow;
      priorFocus = previousFocus;
      document.body.style.overflow = 'hidden';
    }
    // Child effects can run first when dialogs open in the same React commit.
    const descendant = stack.findIndex(item => el.contains(item));
    if (descendant < 0) stack.push(el); else stack.splice(descendant, 0, el);
    updateStack();
    const isTop = () => stack.at(-1) === el;
    const focusFirst = () => (focusable(el)[0] ?? el).focus();
    // The workspace-lock warning must stay usable over an open form; it is not
    // part of this dialog, so Escape there must not close (and discard) the form.
    const exempt = (target: EventTarget | null) => target instanceof Element && !!target.closest('[data-modal-focus-exempt]');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      const active = document.activeElement;
      const inWarning = exempt(event.target) || exempt(active);
      if (event.key === 'Escape' && !inWarning) { event.preventDefault(); event.stopImmediatePropagation(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable(el);
      const first = items[0] ?? el;
      const last = items.at(-1) ?? el;
      // Tab continues from this dialog's edges into the warning and back, so a
      // keyboard user can reach it without leaving the form.
      const warning = [...document.querySelectorAll<HTMLElement>('[data-modal-focus-exempt]')].flatMap(focusable);
      let next: HTMLElement | undefined;
      if (inWarning) {
        if (active === (event.shiftKey ? warning[0] : warning.at(-1))) next = event.shiftKey ? last : first;
      } else if (!el.contains(active)) next = event.shiftKey ? last : first;
      else if (active === (event.shiftKey ? first : last)) next = (event.shiftKey ? warning.at(-1) : warning[0]) ?? (event.shiftKey ? last : first);
      if (next) { event.preventDefault(); next.focus(); }
    };
    const handleFocus = (event: FocusEvent) => { if (isTop() && !el.contains(event.target as Node) && !exempt(event.target)) focusFirst(); };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocus);
    // Keep focus a child already placed in the dialog (autoFocus).
    const resume = resumeRef.current;
    resumeRef.current = null;
    if (isTop() && !el.contains(document.activeElement)) {
      if (resume instanceof HTMLElement && el.contains(resume) && availableForFocus(resume)) resume.focus();
      else focusFirst();
    }
    return () => {
      const revision = ++focusRevision;
      const wasTop = isTop();
      resumeRef.current = el.contains(document.activeElement) ? document.activeElement : null;
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocus);
      const index = stack.indexOf(el);
      if (index >= 0) stack.splice(index, 1);
      updateStack();
      if (!stack.length) {
        document.body.style.overflow = priorOverflow;
        // A confirmed discard can remove the parent before the topmost child.
        // Keep the original opener until the entire stack has closed.
        const opener = priorFocus;
        priorFocus = null;
        if (opener && availableForFocus(opener)) opener.focus();
        else if (opener) {
          // Layout cleanup precedes the rest of React's DOM mutations. The
          // opener may still be disabled until this closing commit finishes.
          // Recheck afterward without stealing a newer modal or user focus.
          queueMicrotask(() => {
            if (stack.length || focusRevision !== revision || !availableForFocus(opener)) return;
            const active = document.activeElement;
            if (active && active !== document.body && active !== opener && active.isConnected) return;
            opener.focus();
          });
        }
      } else if (wasTop) {
        const next = stack.at(-1);
        if (previousFocus && availableForFocus(previousFocus) && next?.contains(previousFocus)) previousFocus.focus();
        else if (next) (focusable(next)[0] ?? next).focus();
      }
    };
  }, [open, suspended]);

  if (!open) return null;

  return (
    <ModalSuspensionContext.Provider value={suspended}>
    <div
      ref={overlayRef}
      // Keep child forms mounted so a privacy toggle cannot discard edits.
      // Inline display beats utility classes; inert also prevents interactions
      // while the dialog is absent from the accessibility tree.
      hidden={suspended}
      inert={suspended}
      aria-hidden={suspended || undefined}
      style={suspended ? { display: 'none' } : undefined}
      tabIndex={-1}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === overlayRef.current && stack.at(-1) === overlayRef.current) onClose(); }}
      role="dialog"
      // The workspace-lock warning sits outside every dialog. While it is shown,
      // aria-modal would hide it from screen readers; the focus trap above still
      // bridges Tab to it.
      aria-modal={!exemptRegionShown}
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
    </ModalSuspensionContext.Provider>
  );
}
