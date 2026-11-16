import { useUIStore } from '@stores/uiStore.ts'
import { useAutoHide } from '@hooks/useAutoHide.ts'
import styles from './FullscreenHud.module.css'

export function FullscreenHud() {
  const zoom = useUIStore((s) => s.zoom)
  const faded = useAutoHide()

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
