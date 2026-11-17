import styles from './LoadingOverlay.module.css'

interface LoadingOverlayProps {
  label?: string
  /** How far it has got, from 0 to 1, when that is known: shown as a bar. */
  progress?: number
}

export function LoadingOverlay({ label = 'Initializing engine...', progress }: LoadingOverlayProps) {
  const percent = progress === undefined ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100)
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.spinner} />
      <span className={styles.label}>{label}</span>
      {percent !== null && (
        <div className={styles.progress}>
          <div
            className={styles.track}
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className={styles.fill} style={{ width: `${percent}%` }} />
          </div>
          <span className={styles.percent}>{percent}%</span>
        </div>
      )}
    </div>
  )
}
