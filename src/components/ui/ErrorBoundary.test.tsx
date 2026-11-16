import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary.tsx'

let failing = true

function Painting() {
  if (failing) throw new Error('render failed')
  return <p>painting</p>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    failing = true
    // React logs caught render errors; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('replaces a crashed tree with the error and recovery buttons', () => {
    render(
      <ErrorBoundary>
        <Painting />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('render failed')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument()
  })

  it('covers the whole window when it wraps the app', () => {
    render(
      <ErrorBoundary fullScreen>
        <Painting />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert').style.position).toBe('fixed')
  })

  it('renders the children again on Retry', () => {
    render(
      <ErrorBoundary>
        <Painting />
      </ErrorBoundary>,
    )
    failing = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('painting')).toBeInTheDocument()
  })
})
