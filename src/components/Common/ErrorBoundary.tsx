import React from 'react';
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
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null, copied: false };

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
    try {
      await navigator.clipboard.writeText(this.getErrorDetails());
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Fallback: select a textarea (clipboard API may not be available in all contexts)
      const ta = document.createElement('textarea');
      ta.value = this.getErrorDetails();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  private handleReload = () => {
    this.setState({ hasError: false, error: null, componentStack: null, copied: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-gray-400">
          <AlertTriangle size={48} className="mb-4 text-red-400" />
          <h2 className="text-lg font-semibold text-gray-200 mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-500 mb-2 max-w-md text-center">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <p className="text-sm text-gray-500 mb-6 max-w-md text-center">
            Try reloading this section or refreshing the page. If the problem persists, copy the error details and report the issue.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={this.handleReload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              <RotateCcw size={16} />
              Reload
            </button>
            <button
              onClick={this.handleCopy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
            >
              {this.state.copied ? <Check size={16} /> : <Copy size={16} />}
              {this.state.copied ? 'Copied' : 'Copy error details'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
