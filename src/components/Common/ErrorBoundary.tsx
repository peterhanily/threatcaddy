import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCcw, Copy, Check } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Optional label to identify this boundary region in logs */
  region?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
  reloading: boolean;
}

// After an update the new service worker removes the old build's chunks, so a view this tab had not
// loaded yet fails to import. A boundary catches that failure, so public/chunk-reload-guard.js never
// sees it. Both use the guard's message patterns and its sessionStorage claim: the guard's boot claim
// ('1') blocks until it releases it, and a view claim blocks only while the same build runs, so each
// build reloads at most once and a later update in the same tab can still reload.
const CHUNK_RELOAD_KEY = 'tc_chunk_reload';
const GUARD_BOOT_CLAIM = '1';
// The page stays if the reload does not happen (a "Leave site?" prompt answered with Stay).
const RELOAD_FALLBACK_MS = 3_000;
const CHUNK_FAILURE_PATTERNS = [
  'ChunkLoadError',
  'Loading chunk',
  'dynamically imported module',
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Failed to load module script',
];

function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_FAILURE_PATTERNS.some(pattern => message.includes(pattern));
}

/** Names the running build by its hashed entry script, as the guard does. */
function viewReloadClaim(): string {
  return `view:${document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? ''}`;
}

/** Takes this build's one chunk reload; false when it is used or session storage is unavailable. */
function claimChunkReload(): boolean {
  try {
    const claim = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    const viewClaim = viewReloadClaim();
    if (claim === GUARD_BOOT_CLAIM || claim === viewClaim) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, viewClaim);
    return true;
  } catch {
    return false;
  }
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null, copied: false, reloading: false };
  private copyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private reloadFallbackId: ReturnType<typeof setTimeout> | null = null;

  componentWillUnmount() {
    if (this.copyTimeoutId !== null) clearTimeout(this.copyTimeoutId);
    if (this.reloadFallbackId !== null) clearTimeout(this.reloadFallbackId);
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const region = this.props.region ?? 'unknown';
    const componentStack = errorInfo.componentStack ?? null;

    this.setState({ componentStack });

    // Structured console error for easier debugging
    console.error('[ErrorBoundary]', {
      region,
      message: error.message,
      stack: error.stack,
      componentStack,
      url: window.location.href,
      timestamp: new Date().toISOString(),
    });

    // Offline, the reload cannot fetch the new page; the claim stays free for later.
    if (isChunkLoadFailure(error) && navigator.onLine !== false && claimChunkReload()) {
      this.setState({ reloading: true });
      // Cache-busting, as the guard does, so the browser fetches the new page.
      const url = new URL(window.location.href);
      url.searchParams.set('_r', Date.now().toString());
      window.location.replace(url.toString());
      this.reloadFallbackId = setTimeout(() => this.setState({ reloading: false }), RELOAD_FALLBACK_MS);
    }
  }

  private getErrorDetails(): string {
    const { error, componentStack } = this.state;
    const lines = [
      `Error: ${error?.message ?? 'Unknown error'}`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      `User-Agent: ${navigator.userAgent}`,
    ];
    if (error?.stack) {
      lines.push('', '--- Stack Trace ---', error.stack);
    }
    if (componentStack) {
      lines.push('', '--- Component Stack ---', componentStack);
    }
    return lines.join('\n');
  }

  private handleCopy = async () => {
    if (this.copyTimeoutId !== null) clearTimeout(this.copyTimeoutId);
    try {
      await navigator.clipboard.writeText(this.getErrorDetails());
      this.setState({ copied: true });
      this.copyTimeoutId = setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Fallback: select a textarea (clipboard API may not be available in all contexts)
      const ta = document.createElement('textarea');
      ta.value = this.getErrorDetails();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.setState({ copied: true });
      this.copyTimeoutId = setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  private handleReload = () => {
    this.setState({ hasError: false, error: null, componentStack: null, copied: false });
  };

  render() {
    if (this.state.reloading) return <ReloadingNotice />;
    if (this.state.hasError) {
      return (
        <ErrorFallback
          errorMessage={this.state.error?.message}
          copied={this.state.copied}
          onReload={this.handleReload}
          onCopy={this.handleCopy}
        />
      );
    }
    return this.props.children;
  }
}

function ReloadingNotice() {
  const { t } = useTranslation('common');
  return <div role="status" className="flex flex-1 items-center justify-center h-full p-8 text-gray-500">{t('loading')}</div>;
}

interface ErrorFallbackProps {
  errorMessage?: string;
  copied: boolean;
  onReload: () => void;
  onCopy: () => void;
}

function ErrorFallback({ errorMessage, copied, onReload, onCopy }: ErrorFallbackProps) {
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-gray-400">
      <AlertTriangle size={48} className="mb-4 text-red-400" />
      <h2 className="text-lg font-semibold text-gray-200 mb-2">{t('error.generic')}</h2>
      <p className="text-sm text-gray-500 mb-2 max-w-md text-center">
        {errorMessage || t('error.unexpectedDetail')}
      </p>
      <p className="text-sm text-gray-500 mb-6 max-w-md text-center">
        {t('error.reloadHint')}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={onReload}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          <RotateCcw size={16} />
          {t('reload')}
        </button>
        <button
          onClick={onCopy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? t('copied') : t('error.copyDetails')}
        </button>
      </div>
    </div>
  );
}
