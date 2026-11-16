import { useEffect } from 'react'
import { useUIStore } from '@stores/uiStore.ts'

/** A message that repeats within this window (an error in a render loop, say) is shown once. */
const REPEAT_WINDOW_MS = 5000
const MAX_MESSAGE_LENGTH = 160

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name
  if (typeof reason === 'string' && reason) return reason
  return 'Unknown error'
}

/**
 * Shows an error toast for errors nothing else caught: unhandled promise
 * rejections, and exceptions thrown from event handlers or timers. Errors
 * thrown while React renders go to the error boundaries instead.
 */
export function useGlobalErrorToasts() {
  useEffect(() => {
    const lastShown = new Map<string, number>()
    const report = (reason: unknown) => {
      const message = errorMessage(reason).slice(0, MAX_MESSAGE_LENGTH)
      const now = Date.now()
      const last = lastShown.get(message)
      if (last !== undefined && now - last < REPEAT_WINDOW_MS) return
      lastShown.set(message, now)
      useUIStore.getState().addToast(`Something went wrong: ${message}`, 'error')
    }
    const onRejection = (event: PromiseRejectionEvent) => report(event.reason)
    const onError = (event: ErrorEvent) => report(event.error ?? event.message)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [])
}
