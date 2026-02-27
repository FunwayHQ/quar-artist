import { useState, useEffect, useRef, useCallback } from 'react'

const DEFAULT_TIMEOUT_MS = 3000

/**
 * Track mouse/pointer inactivity and return a `faded` flag.
 * Resets on mousemove or pointerdown within the container.
 */
export function useAutoHide(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const [faded, setFaded] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetTimer = useCallback(() => {
    setFaded(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setFaded(true), timeoutMs)
  }, [timeoutMs])

  useEffect(() => {
    resetTimer()
    document.addEventListener('mousemove', resetTimer)
    document.addEventListener('pointerdown', resetTimer)
    return () => {
      document.removeEventListener('mousemove', resetTimer)
      document.removeEventListener('pointerdown', resetTimer)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [resetTimer])

  return faded
}
