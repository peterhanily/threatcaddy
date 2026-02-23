import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-gray-400">
          <AlertTriangle size={48} className="mb-4 text-red-400" />
          <h2 className="text-lg font-semibold text-gray-200 mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-500 mb-4 max-w-md text-center">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <RotateCcw size={16} />
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
