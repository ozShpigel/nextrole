import { Component } from 'react';
import { Button } from '@/components/ui/button';

export function ErrorBanner({ error, onRetry }) {
  return (
    <div className="flex items-start gap-4 p-[1rem_1.25rem] mb-8 bg-red-50 border border-red-500/18 rounded-lg animate-in fade-in duration-200 max-[640px]:flex-col max-[640px]:items-stretch">
      <div className="shrink-0 w-9 h-9 rounded-full bg-red-500/12 border border-red-500/20 text-red-500 flex items-center justify-center font-serif font-bold text-[1.2rem]">!</div>
      <div className="flex-1 min-w-0">
        <div className="text-red-500 text-[0.92rem] font-semibold mb-[0.2rem] font-serif">Loading Error</div>
        <div className="text-muted-foreground text-[0.82rem] font-mono break-words">{error}</div>
      </div>
      <div className="shrink-0">
        <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="bg-card border border-border rounded-lg shadow-sm text-center p-8">
          <p className="text-red-500 mb-2">Something went wrong</p>
          <p className="text-muted-foreground text-[0.84rem]">{this.state.error.message}</p>
          <button
            className="mt-4 px-3 py-1.5 text-[0.82rem] font-medium bg-muted border border-border rounded-lg text-muted-foreground hover:border-border hover:text-foreground transition-all"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
