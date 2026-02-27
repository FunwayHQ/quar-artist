import { useCallback } from 'react'
import { useUIStore } from '@stores/uiStore.ts'
import { Toast } from './Toast.tsx'
import styles from './ToastContainer.module.css'

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts)
  const dismissToast = useUIStore((s) => s.dismissToast)

  const handleDismiss = useCallback(
    (id: string) => dismissToast(id),
    [dismissToast],
  )

  if (toasts.length === 0) return null

  return (
    <div className={styles.container} aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={handleDismiss} />
      ))}
    </div>
  )
}
