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
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--red)', marginBottom: '0.5rem' }}>משהו השתבש</p>
          <p className="text-dim text-sm">{this.state.error.message}</p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: '1rem' }}
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
