import type { ReactNode } from 'react'
import styles from './FilterDialog.module.css'

interface FilterDialogProps {
  title: string
  children: ReactNode
  onApply: () => void
  onCancel: () => void
}

export function FilterDialog({ title, children, onApply, onCancel }: FilterDialogProps) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.content}>
          {children}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onCancel} type="button">Cancel</button>
          <button className={styles.applyBtn} onClick={onApply} type="button">Apply</button>
        </div>
      </div>
    </div>
  )
}
