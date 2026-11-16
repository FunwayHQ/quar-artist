import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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
  describe('saving the work after a crash (plan M1.3)', () => {
    it('saves before offering to reload, and says when the work is saved', async () => {
      let done: (ok: boolean) => void = () => {}
      const onCrash = vi.fn(() => new Promise<boolean>((resolve) => (done = resolve)))
      render(
        <ErrorBoundary fullScreen onCrash={onCrash}>
          <Painting />
        </ErrorBoundary>,
      )
      expect(onCrash).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('crash-save')).toHaveTextContent('Saving your work…')
      // Reloading now would lose what it saves.
      expect(screen.queryByRole('button', { name: 'Reload Page' })).toBeNull()

      await act(async () => done(true))
      expect(screen.getByTestId('crash-save')).toHaveTextContent('Your work is saved.')
      expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument()
    })

    it("says so when the latest changes couldn't be saved", async () => {
      render(
        <ErrorBoundary onCrash={() => Promise.reject(new Error('no room'))}>
          <Painting />
        </ErrorBoundary>,
      )
      expect(await screen.findByText("Your latest changes couldn't be saved.")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('starts afresh on Retry', async () => {
      render(
        <ErrorBoundary onCrash={async () => true}>
          <Painting />
        </ErrorBoundary>,
      )
      await screen.findByText('Your work is saved.')
      failing = false
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(screen.getByText('painting')).toBeInTheDocument()
      expect(screen.queryByTestId('crash-save')).toBeNull()
    })
  })
})
