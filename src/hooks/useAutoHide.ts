import { useState, useEffect } from 'react'

const DEFAULT_TIMEOUT_MS = 3000

/**
 * Track mouse/pointer inactivity and return a `faded` flag.
 * Resets on mousemove or pointerdown anywhere in the document.
 */
export function useAutoHide(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const [faded, setFaded] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setFaded(true), timeoutMs)
    }
    const reset = () => {
      setFaded(false)
      schedule()
    }

    schedule() // starts visible
    document.addEventListener('mousemove', reset)
    document.addEventListener('pointerdown', reset)
    return () => {
      document.removeEventListener('mousemove', reset)
      document.removeEventListener('pointerdown', reset)
      clearTimeout(timer)
    }
  }, [timeoutMs])

  return faded
}
