import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToast, type ToastType } from '../../contexts/ToastContext';
import { cn } from '../../lib/utils';

const ICON_MAP: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const STYLE_MAP: Record<ToastType, string> = {
  success: 'bg-green-50 border-green-300 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200',
  error: 'bg-red-50 border-red-300 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200',
  info: 'bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200',
  warning: 'bg-yellow-50 border-yellow-300 text-yellow-800 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-200',
};

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = ICON_MAP[toast.type];
        return (
          <div
            key={toast.id}
            className={cn(
              'flex items-start gap-2.5 px-3 py-2.5 rounded-lg border shadow-lg text-sm',
              STYLE_MAP[toast.type]
            )}
            role="alert"
          >
            <Icon size={16} className="shrink-0 mt-0.5" />
            <span className="flex-1 min-w-0">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
