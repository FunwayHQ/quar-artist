import styles from './LoadingOverlay.module.css'

export function LoadingOverlay({ label = 'Initializing engine...' }: { label?: string }) {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.spinner} />
      <span className={styles.label}>{label}</span>
    </div>
  )
}
