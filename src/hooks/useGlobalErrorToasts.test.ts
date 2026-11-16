import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGlobalErrorToasts } from './useGlobalErrorToasts.ts'
import { useUIStore } from '@stores/uiStore.ts'

function unhandledRejection(reason: unknown) {
  const event = new Event('unhandledrejection')
  Object.defineProperty(event, 'reason', { value: reason })
  window.dispatchEvent(event)
}

function uncaughtError(error: Error) {
  window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }))
}

const toasts = () => useUIStore.getState().toasts.map(({ message, type }) => ({ message, type }))

describe('useGlobalErrorToasts', () => {
  beforeEach(() => {
    useUIStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows an error toast for an unhandled promise rejection', () => {
    renderHook(() => useGlobalErrorToasts())
    unhandledRejection(new Error('Storage is full'))
    expect(toasts()).toEqual([{ message: 'Something went wrong: Storage is full', type: 'error' }])
  })

  it('shows an error toast for an exception thrown outside React', () => {
    renderHook(() => useGlobalErrorToasts())
    uncaughtError(new TypeError('layer is undefined'))
    expect(toasts()).toEqual([{ message: 'Something went wrong: layer is undefined', type: 'error' }])
  })

  it('describes rejections that are not errors', () => {
    renderHook(() => useGlobalErrorToasts())
    unhandledRejection('quota exceeded')
    unhandledRejection(undefined)
    expect(toasts().map((t) => t.message)).toEqual([
      'Something went wrong: quota exceeded',
      'Something went wrong: Unknown error',
    ])
  })

  it('shows a repeating error once every few seconds', () => {
    vi.useFakeTimers()
    renderHook(() => useGlobalErrorToasts())
    for (let i = 0; i < 10; i++) unhandledRejection(new Error('frame failed'))
    expect(toasts()).toHaveLength(1)

    vi.advanceTimersByTime(5000)
    unhandledRejection(new Error('frame failed'))
    expect(toasts()).toHaveLength(2)
  })

  it('stops listening when unmounted', () => {
    const { unmount } = renderHook(() => useGlobalErrorToasts())
    unmount()
    unhandledRejection(new Error('late'))
    expect(toasts()).toEqual([])
  })
})
