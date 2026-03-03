import { useEffect, memo } from 'react'
import { X } from 'lucide-react'
import type { Toast as ToastData } from '@stores/uiStore.ts'
import styles from './Toast.module.css'

interface ToastProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

const AUTO_DISMISS_MS = 3000

export const Toast = memo(function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div className={styles.toast} data-type={toast.type} role="status">
      <span className={styles.message}>{toast.message}</span>
      <button
        className={styles.dismiss}
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
})
