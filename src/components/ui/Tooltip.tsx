import { useState, useRef, useCallback, type ReactNode } from 'react'
import styles from './Tooltip.module.css'

interface TooltipProps {
  content: string
  shortcut?: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
}

const SHOW_DELAY_MS = 500

export function Tooltip({ content, shortcut, position = 'bottom', children }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setVisible(false)
  }, [])

  return (
    <div
      className={styles.wrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && (
        <div className={styles.tooltip} data-position={position} role="tooltip">
          {content}
          {shortcut && <kbd className={styles.kbd}>{shortcut}</kbd>}
        </div>
      )}
    </div>
  )
}
