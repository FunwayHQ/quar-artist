import { MoreHorizontal } from 'lucide-react'
import styles from './TitleBar.module.css'

export function TitleBar() {
  return (
    <header className={`glass ${styles.titleBar}`}>
      <div className={styles.brand}>
        <img src="/logo.svg" alt="QUAR Artist" className={styles.logo} />
      </div>
      <div className={styles.actions}>
        <button className={styles.iconButton} aria-label="Menu">
          <MoreHorizontal size={14} />
        </button>
      </div>
    </header>
  )
}
