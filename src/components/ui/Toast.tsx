import { useEffect, memo } from 'react'
import { X } from 'lucide-react'
import type { Toast as ToastData, ToastCloseReason } from '@stores/uiStore.ts'
import styles from './Toast.module.css'

interface ToastProps {
  toast: ToastData
  onDismiss: (id: string, reason: ToastCloseReason) => void
}

const AUTO_DISMISS_MS = 3000

export const Toast = memo(function Toast({ toast, onDismiss }: ToastProps) {
  const duration = toast.durationMs ?? AUTO_DISMISS_MS
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id, 'timeout'), duration)
    return () => clearTimeout(timer)
  }, [toast.id, duration, onDismiss])

  return (
    <div className={styles.toast} data-type={toast.type} role="status">
      <span className={styles.message}>{toast.message}</span>
      {toast.action && (
        <button
          className={styles.action}
          type="button"
          onClick={() => {
            toast.action?.run()
            onDismiss(toast.id, 'action')
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        className={styles.dismiss}
        onClick={() => onDismiss(toast.id, 'dismiss')}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
})
