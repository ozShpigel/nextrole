import { Component } from 'react';

export default class ErrorBoundary extends Component {
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
        <div className="bg-bg-card border border-border rounded-lg shadow-sm text-center p-8">
          <p className="text-red mb-2">משהו השתבש</p>
          <p className="text-text-dim text-[0.84rem]">{this.state.error.message}</p>
          <button
            className="mt-4 px-3 py-1.5 text-[0.82rem] font-medium bg-bg-surface border border-border rounded-lg text-text-secondary hover:border-border-hover hover:text-text-primary transition-all"
            onClick={() => this.setState({ error: null })}
          >
            נסה שוב
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
