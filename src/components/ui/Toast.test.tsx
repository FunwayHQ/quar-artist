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
    expect(onDismiss).toHaveBeenCalledWith('t1', 'timeout')
  })

  it('stays up for its own duration when it has one', () => {
    const onDismiss = vi.fn()
    render(
      <Toast
        toast={{ id: 't1', message: 'Deleted', type: 'info', durationMs: 8000 }}
        onDismiss={onDismiss}
      />,
    )

    act(() => { vi.advanceTimersByTime(7999) })
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onDismiss).toHaveBeenCalledWith('t1', 'timeout')
  })

  it('runs its action from a button, then closes', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const run = vi.fn()
    render(
      <Toast
        toast={{ id: 't1', message: 'Deleted', type: 'info', action: { label: 'Undo', run } }}
        onDismiss={onDismiss}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledWith('t1', 'action')
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
    expect(onDismiss).toHaveBeenCalledWith('t1', 'dismiss')
  })
})

describe('toast store', () => {
  beforeEach(() => {
    useUIStore.setState({ toasts: [] })
  })

  it('tells the toast why it closed, once', () => {
    const onClose = vi.fn()
    useUIStore.getState().addToast('Deleted', 'info', { onClose })
    const { id } = useUIStore.getState().toasts[0]

    useUIStore.getState().dismissToast(id, 'timeout')
    useUIStore.getState().dismissToast(id, 'dismiss')

    expect(useUIStore.getState().toasts).toHaveLength(0)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('timeout')
  })

  it('counts a plain dismiss as the user closing it', () => {
    const onClose = vi.fn()
    useUIStore.getState().addToast('Saved', 'success', { onClose })
    useUIStore.getState().dismissToast(useUIStore.getState().toasts[0].id)
    expect(onClose).toHaveBeenCalledWith('dismiss')
  })

  it('keeps the action and duration on the toast', () => {
    const run = () => {}
    useUIStore.getState().addToast('Deleted', 'info', { action: { label: 'Undo', run }, durationMs: 8000 })
    expect(useUIStore.getState().toasts[0]).toMatchObject({
      message: 'Deleted',
      type: 'info',
      durationMs: 8000,
      action: { label: 'Undo', run },
    })
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

  it('closes a toast through the store when its action runs', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const onClose = vi.fn()
    useUIStore.getState().addToast('Deleted', 'info', { action: { label: 'Undo', run }, onClose })
    render(<ToastContainer />)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('action')
    expect(screen.queryByText('Deleted')).toBeNull()
  })

  it('renders toasts from store', () => {
    useUIStore.getState().addToast('Hello', 'info')
    useUIStore.getState().addToast('World', 'success')
    render(<ToastContainer />)
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText('World')).toBeTruthy()
  })
})
