import { useEffect, useCallback } from 'react'
import styles from './AboutModal.module.css'

interface AboutModalProps {
  open: boolean
  onClose: () => void
}

export function AboutModal({ open, onClose }: AboutModalProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="About QUAR Artist">
        <img src="/logo.svg" alt="QUAR Artist" className={styles.logo} />
        <h2 className={styles.name}>QUAR Artist</h2>
        <span className={styles.version}>v0.8.0 (Sprint 8)</span>
        <p className={styles.description}>
          Professional-grade digital illustration and painting for the web.
          Part of the QUAR Suite. Open-source under the MIT license.
        </p>
        <div className={styles.links}>
          <a
            className={styles.link}
            href="https://github.com/FunwayHQ/quar-artist"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            className={styles.link}
            href="https://github.com/FunwayHQ/quar-artist/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report Bug
          </a>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
