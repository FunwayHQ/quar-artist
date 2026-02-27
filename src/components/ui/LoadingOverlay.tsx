import styles from './LoadingOverlay.module.css'

export function LoadingOverlay() {
  return (
    <div className={styles.overlay}>
      <div className={styles.spinner} />
      <span className={styles.label}>Initializing engine...</span>
    </div>
  )
}
