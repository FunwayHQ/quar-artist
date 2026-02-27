import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toast } from './Toast.tsx'
import { ToastContainer } from './ToastContainer.tsx'
import { useUIStore } from '@stores/uiStore.ts'

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders toast message', () => {
    const onDismiss = vi.fn()
    render(
      <Toast
        toast={{ id: 't1', message: 'File exported', type: 'success' }}
        onDismiss={onDismiss}
      />,
    )
    expect(screen.getByText('File exported')).toBeTruthy()
  })

  it('auto-dismisses after 3 seconds', () => {
    const onDismiss = vi.fn()
    render(
      <Toast
        toast={{ id: 't1', message: 'Saved', type: 'info' }}
        onDismiss={onDismiss}
      />,
    )

    expect(onDismiss).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(3000) })
    expect(onDismiss).toHaveBeenCalledWith('t1')
  })

  it('dismisses on X button click', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(
      <Toast
        toast={{ id: 't1', message: 'Test', type: 'error' }}
        onDismiss={onDismiss}
      />,
    )

    await user.click(screen.getByLabelText('Dismiss'))
    expect(onDismiss).toHaveBeenCalledWith('t1')
  })
})

describe('ToastContainer', () => {
  beforeEach(() => {
    // Reset toasts
    useUIStore.setState({ toasts: [] })
  })

  it('renders nothing when no toasts', () => {
    const { container } = render(<ToastContainer />)
    expect(container.innerHTML).toBe('')
  })

  it('renders toasts from store', () => {
    useUIStore.getState().addToast('Hello', 'info')
    useUIStore.getState().addToast('World', 'success')
    render(<ToastContainer />)
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText('World')).toBeTruthy()
  })
})
