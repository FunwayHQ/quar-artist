import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[QUAR] ErrorBoundary caught:', error, info.componentStack)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          gap: '1rem',
          color: '#e5e5e5',
          fontFamily: 'DM Sans, sans-serif',
        }}>
          <h2 style={{ margin: 0, color: '#F59E0B' }}>Something went wrong</h2>
          <p style={{ margin: 0, opacity: 0.7, fontSize: '0.875rem' }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={this.handleRetry}
              type="button"
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid rgba(245, 158, 11, 0.5)',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#F59E0B',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Retry
            </button>
            <button
              onClick={this.handleReload}
              type="button"
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#e5e5e5',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
