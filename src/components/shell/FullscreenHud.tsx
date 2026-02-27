import { useState, useEffect, useRef } from 'react'
import { useUIStore } from '@stores/uiStore.ts'
import type { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import styles from './FullscreenHud.module.css'

interface FullscreenHudProps {
  manager: CanvasManager | null
}

const FADE_DELAY_MS = 3000

export function FullscreenHud({ manager }: FullscreenHudProps) {
  const zoom = useUIStore((s) => s.zoom)
  const [faded, setFaded] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const resetFade = () => {
      setFaded(false)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setFaded(true), FADE_DELAY_MS)
    }

    resetFade()
    document.addEventListener('mousemove', resetFade)
    document.addEventListener('pointerdown', resetFade)

    return () => {
      document.removeEventListener('mousemove', resetFade)
      document.removeEventListener('pointerdown', resetFade)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div className={styles.hud} data-faded={faded}>
      <span className={styles.zoom}>{Math.round(zoom * 100)}%</span>
      <button
        className={styles.exitBtn}
        onClick={() => useUIStore.getState().toggleFullscreen()}
      >
        Exit Fullscreen
      </button>
    </div>
  )
}
