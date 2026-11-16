import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  /** Cover the whole window (for the boundary around the entire app). */
  fullScreen?: boolean
  /**
   * Save the open work, for a crash that takes the canvas with it. Called
   * while the canvas is still there, before React tears it down. Resolves
   * true when nothing was left unsaved.
   */
  onCrash?: () => Promise<boolean>
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  /** How saving the work after the crash went, with `onCrash`. */
  rescue: 'saving' | 'saved' | 'failed' | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, rescue: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[QUAR] ErrorBoundary caught:', error, info.componentStack)
    const { onCrash } = this.props
    if (!onCrash) return
    // Effects clean up after this: the canvas is still there to read from.
    let saving: Promise<boolean>
    try {
      saving = onCrash()
    } catch (err) {
      saving = Promise.reject(err)
    }
    this.setState({ rescue: 'saving' })
    saving.then(
      (ok) => this.setState({ rescue: ok ? 'saved' : 'failed' }),
      (err: unknown) => {
        console.error('[QUAR] Saving after the crash failed:', err)
        this.setState({ rescue: 'failed' })
      },
    )
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, rescue: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div role="alert" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          gap: '1rem',
          color: '#e5e5e5',
          fontFamily: 'DM Sans, sans-serif',
          ...(this.props.fullScreen && {
            position: 'fixed',
            inset: 0,
            zIndex: 'var(--z-loading)',
            background: 'var(--color-bg-primary)',
          }),
        }}>
          <h2 style={{ margin: 0, color: '#F59E0B' }}>Something went wrong</h2>
          <p style={{ margin: 0, opacity: 0.7, fontSize: '0.875rem' }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          {this.state.rescue && (
            <p style={{ margin: 0, fontSize: '0.875rem' }} data-testid="crash-save">
              {this.state.rescue === 'saving'
                ? 'Saving your work…'
                : this.state.rescue === 'saved'
                  ? 'Your work is saved.'
                  : "Your latest changes couldn't be saved."}
            </p>
          )}
          {/* Not while saving: reloading then would lose what it saves. */}
          {this.state.rescue !== 'saving' && (
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
          )}
        </div>
      )
    }

    return this.props.children
  }
}
