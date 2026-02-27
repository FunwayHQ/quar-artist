import { useEffect, useRef, useState } from 'react'
import styles from './DropdownMenu.module.css'

export interface MenuItem {
  label: string
  shortcut?: string
  action?: () => void
  disabled?: boolean
  separator?: boolean
}

interface DropdownMenuProps {
  items: MenuItem[]
  onClose: () => void
  anchorEl: HTMLElement | null
}

export function DropdownMenu({ items, onClose, anchorEl }: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(-1)

  // Position below the anchor element
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect()
      setPosition({ top: rect.bottom + 2, left: rect.left })
    }
  }, [anchorEl])

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use setTimeout to avoid closing immediately from the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  // Keyboard navigation
  useEffect(() => {
    const actionableItems = items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => !item.separator && !item.disabled)

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const currentIdx = actionableItems.findIndex(({ i }) => i === activeIndex)
        const nextIdx = (currentIdx + 1) % actionableItems.length
        setActiveIndex(actionableItems[nextIdx].i)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const currentIdx = actionableItems.findIndex(({ i }) => i === activeIndex)
        const nextIdx = currentIdx <= 0 ? actionableItems.length - 1 : currentIdx - 1
        setActiveIndex(actionableItems[nextIdx].i)
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (activeIndex >= 0) {
          const item = items[activeIndex]
          if (item && !item.disabled && !item.separator && item.action) {
            item.action()
            onClose()
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [items, activeIndex, onClose])

  return (
    <div
      ref={menuRef}
      className={`glass ${styles.menu}`}
      style={{ top: position.top, left: position.left }}
      role="menu"
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className={styles.separator} role="separator" />
        }

        return (
          <button
            key={i}
            className={styles.item}
            role="menuitem"
            data-active={i === activeIndex}
            disabled={item.disabled}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(-1)}
            onClick={() => {
              if (item.action) {
                item.action()
                onClose()
              }
            }}
            type="button"
          >
            <span className={styles.label}>{item.label}</span>
            {item.shortcut && (
              <span className={styles.shortcut}>{item.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
