import { useState, type ReactNode } from 'react';
import { X, Download } from 'lucide-react';

interface AppLayoutProps {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}

export function AppLayout({ header, sidebar, children }: AppLayoutProps) {
  const [dismissed, setDismissed] = useState(false);

  const [daysSinceBuild] = useState(() =>
    typeof __BUILD_TIME__ === 'number'
      ? Math.floor((Date.now() - __BUILD_TIME__) / 86_400_000)
      : undefined
  );

  const showBanner =
    typeof __STANDALONE__ !== 'undefined' &&
    __STANDALONE__ &&
    daysSinceBuild !== undefined &&
    !dismissed;

  const daysText =
    daysSinceBuild === 0
      ? 'today'
      : daysSinceBuild === 1
        ? '1 day ago'
        : `${daysSinceBuild} days ago`;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {header}
      {showBanner && (
        <div className="flex items-center justify-between gap-2 bg-amber-100 dark:bg-amber-900/40 border-b border-amber-300 dark:border-amber-700 px-4 py-1.5 text-sm text-amber-900 dark:text-amber-200">
          <span className="flex items-center gap-1.5">
            <Download className="size-3.5 shrink-0" />
            Built {daysText} —{' '}
            <a
              href="https://threatcaddy.com/threatcaddy-standalone.html"
              download
              className="underline font-medium hover:text-amber-700 dark:hover:text-amber-100"
            >
              Download latest version
            </a>
          </span>
          <button
            onClick={() => setDismissed(true)}
            className="p-0.5 rounded hover:bg-amber-200 dark:hover:bg-amber-800"
            aria-label="Dismiss update banner"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:block shrink-0">
          {sidebar}
        </div>
        {children}
      </div>
    </div>
  );
}
