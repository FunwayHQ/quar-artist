import { useState, useRef, useCallback } from 'react'
import { DropdownMenu, type MenuItem } from './DropdownMenu.tsx'
import type { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import type { FilterType } from '@app-types/filter.ts'
import styles from './TitleBar.module.css'

interface TitleBarProps {
  onOpenFilter?: (filterType: FilterType) => void
  onUndo?: () => void
  onRedo?: () => void
  manager?: CanvasManager | null
}

type MenuName = 'file' | 'edit' | 'adjustments' | 'selection' | 'help'

export function TitleBar({ onOpenFilter, onUndo, onRedo, manager }: TitleBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null)
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  const toggleMenu = (name: MenuName) => {
    setOpenMenu((prev) => (prev === name ? null : name))
  }

  const getMenuItems = (name: MenuName): MenuItem[] => {
    switch (name) {
      case 'file':
        return [
          { label: 'New', shortcut: 'Ctrl+N', action: () => {} },
          { separator: true, label: '' },
          { label: 'Export...', shortcut: 'Ctrl+E', action: () => {} },
          { label: 'Save', shortcut: 'Ctrl+S', action: () => {} },
        ]
      case 'edit':
        return [
          { label: 'Undo', shortcut: 'Ctrl+Z', action: onUndo },
          { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: onRedo },
        ]
      case 'adjustments':
        return [
          { label: 'Gaussian Blur...', action: () => onOpenFilter?.('gaussianBlur') },
          { label: 'Sharpen...', action: () => onOpenFilter?.('sharpen') },
          { separator: true, label: '' },
          { label: 'HSB Adjustment...', action: () => onOpenFilter?.('hsbAdjustment') },
          { label: 'Curves...', shortcut: 'Ctrl+M', action: () => onOpenFilter?.('curves') },
        ]
      case 'selection':
        return [
          { label: 'Select All', shortcut: 'Ctrl+A', action: () => manager?.selectAll() },
          { label: 'Deselect', shortcut: 'Ctrl+D', action: () => manager?.deselectAll() },
          { label: 'Invert', shortcut: 'Ctrl+Shift+I', action: () => manager?.invertSelection() },
        ]
      case 'help':
        return [
          { label: 'Keyboard Shortcuts', action: () => {} },
          { separator: true, label: '' },
          { label: 'About QUAR Artist', action: () => {} },
        ]
    }
  }

  const menus: { name: MenuName; label: string }[] = [
    { name: 'file', label: 'File' },
    { name: 'edit', label: 'Edit' },
    { name: 'adjustments', label: 'Adjustments' },
    { name: 'selection', label: 'Selection' },
    { name: 'help', label: 'Help' },
  ]

  return (
    <header className={`glass ${styles.titleBar}`}>
      <div className={styles.brand}>
        <img src="/logo.svg" alt="QUAR Artist" className={styles.logo} />
      </div>
      <nav className={styles.menu}>
        {menus.map(({ name, label }) => (
          <button
            key={name}
            ref={(el) => { buttonRefs.current[name] = el }}
            className={styles.menuItem}
            data-active={openMenu === name}
            onClick={() => toggleMenu(name)}
            onMouseEnter={() => {
              if (openMenu && openMenu !== name) setOpenMenu(name)
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={styles.projectName}>Untitled Project</div>
      {openMenu && (
        <DropdownMenu
          items={getMenuItems(openMenu)}
          onClose={closeMenu}
          anchorEl={buttonRefs.current[openMenu] ?? null}
        />
      )}
    </header>
  )
}
