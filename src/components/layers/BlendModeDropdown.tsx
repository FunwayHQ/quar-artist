import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { BlendMode } from '../../types/layer.ts'
import { BLEND_MODE_GROUPS, BLEND_MODE_LABELS } from '../../types/layer.ts'
import styles from './BlendModeDropdown.module.css'

interface BlendModeDropdownProps {
  value: BlendMode
  onChange: (mode: BlendMode) => void
}

/**
 * Premium custom blend mode dropdown.
 * Portal-rendered to body to escape .glass backdrop-filter stacking context.
 * Grouped modes with amber group headers, keyboard navigation, and glass morphism panel.
 */
export function BlendModeDropdown({ value, onChange }: BlendModeDropdownProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [focusIndex, setFocusIndex] = useState(-1)

  // Flatten all modes for keyboard navigation
  const allModes = BLEND_MODE_GROUPS.flatMap((g) => g.modes)

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen((prev) => !prev)
    setFocusIndex(-1)
  }, [])

  const handleSelect = useCallback(
    (mode: BlendMode) => {
      onChange(mode)
      setOpen(false)
    },
    [onChange],
  )

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  // Position the panel beneath the trigger using getBoundingClientRect
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const panelHeight = 380
    const panelWidth = 180

    let x = rect.left
    let y = rect.bottom + 4

    // Clamp to viewport
    if (x + panelWidth > window.innerWidth) {
      x = window.innerWidth - panelWidth - 8
    }
    if (y + panelHeight > window.innerHeight) {
      // Open above the trigger if there's not enough space below
      y = rect.top - panelHeight - 4
      if (y < 4) y = 4
    }

    setPosition({ x, y })
  }, [open])

  // Scroll active item into view when panel opens
  useEffect(() => {
    if (!open || !panelRef.current) return
    const activeEl = panelRef.current.querySelector(`[data-active="true"]`)
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'center' })
    }
  }, [open])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusIndex((prev) => (prev + 1 >= allModes.length ? 0 : prev + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIndex((prev) => (prev <= 0 ? allModes.length - 1 : prev - 1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (focusIndex >= 0 && focusIndex < allModes.length) {
          handleSelect(allModes[focusIndex])
        }
        return
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [open, focusIndex, allModes, handleClose, handleSelect])

  // Scroll focused item into view
  useEffect(() => {
    if (!open || focusIndex < 0 || !panelRef.current) return
    const focusedEl = panelRef.current.querySelector(`[data-focused="true"]`)
    if (focusedEl) {
      focusedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [open, focusIndex])

  let flatIdx = 0

  return (
    <>
      <button
        ref={triggerRef}
        className={styles.trigger}
        data-open={open || undefined}
        onClick={handleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Blend mode"
        type="button"
      >
        <span className={styles.triggerLabel}>{BLEND_MODE_LABELS[value]}</span>
        <ChevronDown size={10} className={styles.triggerChevron} />
      </button>

      {open &&
        createPortal(
          <>
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
            <div className={styles.backdrop} onClick={handleClose} />
            <div
              ref={panelRef}
              className={styles.panel}
              style={{ left: position.x, top: position.y }}
              role="listbox"
              aria-label="Blend modes"
            >
              {BLEND_MODE_GROUPS.map((group, gi) => (
                <div key={group.label}>
                  {gi > 0 && <div className={styles.groupSep} />}
                  <div className={styles.groupHeader}>{group.label}</div>
                  {group.modes.map((mode) => {
                    const idx = flatIdx++
                    const isActive = mode === value
                    const isFocused = idx === focusIndex
                    return (
                      <button
                        key={mode}
                        className={styles.modeItem}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive || undefined}
                        data-focused={isFocused || undefined}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelect(mode)
                        }}
                        type="button"
                      >
                        {BLEND_MODE_LABELS[mode]}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
