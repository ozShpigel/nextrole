import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="bg-card border border-border rounded-lg text-center p-8">
          <p className="text-destructive mb-2">Something went wrong</p>
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
