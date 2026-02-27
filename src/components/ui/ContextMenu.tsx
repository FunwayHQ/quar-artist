import { useEffect, useRef, useState, useCallback } from 'react'
import styles from './ContextMenu.module.css'

export interface ContextMenuItem {
  label: string
  shortcut?: string
  action?: () => void
  disabled?: boolean
  separator?: boolean
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  x: number
  y: number
  onClose: () => void
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [focusIndex, setFocusIndex] = useState(-1)

  // Clamp position to viewport
  const [position, setPosition] = useState({ x, y })
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    setPosition({
      x: x + rect.width > vw ? vw - rect.width - 4 : x,
      y: y + rect.height > vh ? vh - rect.height - 4 : y,
    })
  }, [x, y])

  // Keyboard navigation
  useEffect(() => {
    const actionItems = items.filter((i) => !i.separator && !i.disabled)
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusIndex((prev) => {
          const next = prev + 1
          return next >= actionItems.length ? 0 : next
        })
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIndex((prev) => {
          const next = prev - 1
          return next < 0 ? actionItems.length - 1 : next
        })
      }
      if (e.key === 'Enter') {
        if (focusIndex >= 0 && focusIndex < actionItems.length) {
          actionItems[focusIndex].action?.()
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [items, focusIndex, onClose])

  const handleItemClick = useCallback(
    (item: ContextMenuItem) => {
      if (item.disabled) return
      item.action?.()
      onClose()
    },
    [onClose],
  )

  let actionIndex = -1

  return (
    <>
      <div className={styles.overlay} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        ref={menuRef}
        className={styles.menu}
        style={{ left: position.x, top: position.y }}
        role="menu"
      >
        {items.map((item, i) => {
          if (item.separator) {
            return <div key={i} className={styles.separator} />
          }
          if (!item.disabled) actionIndex++
          const isFocused = !item.disabled && actionIndex === focusIndex
          return (
            <button
              key={i}
              className={styles.item}
              role="menuitem"
              data-focused={isFocused || undefined}
              data-disabled={item.disabled || undefined}
              onClick={() => handleItemClick(item)}
            >
              <span>{item.label}</span>
              {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
            </button>
          )
        })}
      </div>
    </>
  )
}
