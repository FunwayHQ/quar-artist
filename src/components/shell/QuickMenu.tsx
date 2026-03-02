import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Brush, Eraser, Undo2, Redo2, Pipette, PaintBucket,
  MousePointer2, Trash2, Type, Move, Hand,
} from 'lucide-react'
import { useQuickMenuStore } from '@stores/quickMenuStore.ts'
import type { QuickMenuSlot } from '@app-types/quickmenu.ts'
import styles from './QuickMenu.module.css'

const ICON_MAP: Record<string, typeof Brush> = {
  Brush, Eraser, Undo2, Redo2, Pipette, PaintBucket,
  MousePointer2, Trash2, Type, Move, Hand,
}

const SLOT_COUNT = 8
const RADIUS = 80

interface QuickMenuProps {
  onAction: (slot: QuickMenuSlot) => void
}

export function QuickMenu({ onAction }: QuickMenuProps) {
  const visible = useQuickMenuStore((s) => s.visible)
  const position = useQuickMenuStore((s) => s.position)
  const slots = useQuickMenuStore((s) => s.slots)
  const activeSlotIndex = useQuickMenuStore((s) => s.activeSlotIndex)
  const hide = useQuickMenuStore((s) => s.hide)
  const setActiveSlotIndex = useQuickMenuStore((s) => s.setActiveSlotIndex)
  const containerRef = useRef<HTMLDivElement>(null)

  const getSlotIndex = useCallback((clientX: number, clientY: number): number | null => {
    const dx = clientX - position.x
    const dy = clientY - position.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 20) return null // dead zone

    let angle = Math.atan2(dy, dx)
    if (angle < 0) angle += Math.PI * 2
    const sectorSize = (Math.PI * 2) / SLOT_COUNT
    const index = Math.floor((angle + sectorSize / 2) / sectorSize) % SLOT_COUNT
    return index
  }, [position])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const idx = getSlotIndex(e.clientX, e.clientY)
    setActiveSlotIndex(idx)
  }, [getSlotIndex, setActiveSlotIndex])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const idx = getSlotIndex(e.clientX, e.clientY)
    if (idx !== null && slots[idx]) {
      onAction(slots[idx])
    }
    hide()
  }, [getSlotIndex, slots, onAction, hide])

  // Escape to dismiss
  useEffect(() => {
    if (!visible) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        hide()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [visible, hide])

  if (!visible) return null

  return createPortal(
    <div
      className={styles.overlay}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      data-testid="quick-menu"
    >
      <div
        ref={containerRef}
        className={styles.container}
        style={{ left: position.x, top: position.y }}
      >
        <div className={styles.center} />
        {slots.map((slot, i) => {
          const angle = (i * Math.PI * 2) / SLOT_COUNT
          const x = Math.cos(angle) * RADIUS
          const y = Math.sin(angle) * RADIUS
          const Icon = ICON_MAP[slot.icon] || Brush

          return (
            <div
              key={i}
              className={styles.slot}
              style={{ left: x, top: y }}
              data-active={activeSlotIndex === i}
              data-testid={`quick-menu-slot-${i}`}
              onClick={(e) => {
                e.stopPropagation()
                onAction(slot)
                hide()
              }}
            >
              <Icon size={18} />
              <span className={styles.slotLabel}>{slot.label}</span>
            </div>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
