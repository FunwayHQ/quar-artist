import { useQuickMenuStore } from '@stores/quickMenuStore.ts'
import { DEFAULT_QUICK_MENU_SLOTS } from '@app-types/quickmenu.ts'
import type { QuickMenuSlot, QuickMenuActionType } from '@app-types/quickmenu.ts'
import type { ToolType } from '@app-types/engine.ts'
import styles from './QuickMenuSettingsDialog.module.css'

interface QuickMenuSettingsDialogProps {
  open: boolean
  onClose: () => void
}

const AVAILABLE_ACTIONS: { label: string; actionType: QuickMenuActionType; icon: string }[] = [
  { label: 'Brush',       actionType: { kind: 'tool', tool: 'brush' },       icon: 'Brush' },
  { label: 'Eraser',      actionType: { kind: 'tool', tool: 'eraser' },      icon: 'Eraser' },
  { label: 'Eyedropper',  actionType: { kind: 'tool', tool: 'eyedropper' },  icon: 'Pipette' },
  { label: 'Fill',        actionType: { kind: 'tool', tool: 'fill' },        icon: 'PaintBucket' },
  { label: 'Selection',   actionType: { kind: 'tool', tool: 'selection' },   icon: 'MousePointer2' },
  { label: 'Transform',   actionType: { kind: 'tool', tool: 'transform' },   icon: 'Move' },
  { label: 'Move',        actionType: { kind: 'tool', tool: 'move' },        icon: 'Hand' },
  { label: 'Text',        actionType: { kind: 'tool', tool: 'text' },        icon: 'Type' },
  { label: 'Undo',        actionType: { kind: 'action', action: 'undo' },    icon: 'Undo2' },
  { label: 'Redo',        actionType: { kind: 'action', action: 'redo' },    icon: 'Redo2' },
  { label: 'Clear Layer', actionType: { kind: 'action', action: 'clear-layer' }, icon: 'Trash2' },
]

function actionKey(at: QuickMenuActionType): string {
  return at.kind === 'tool' ? `tool:${at.tool}` : `action:${at.action}`
}

function findAction(key: string): typeof AVAILABLE_ACTIONS[0] | undefined {
  return AVAILABLE_ACTIONS.find((a) => actionKey(a.actionType) === key)
}

export function QuickMenuSettingsDialog({ open, onClose }: QuickMenuSettingsDialogProps) {
  const slots = useQuickMenuStore((s) => s.slots)
  const setSlot = useQuickMenuStore((s) => s.setSlot)
  const resetToDefaults = useQuickMenuStore((s) => s.resetToDefaults)

  if (!open) return null

  const handleSlotChange = (index: number, key: string) => {
    const action = findAction(key)
    if (!action) return
    const newSlot: QuickMenuSlot = {
      label: action.label,
      icon: action.icon,
      actionType: action.actionType,
    }
    setSlot(index, newSlot)
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles.overlay} onKeyDown={(e) => e.stopPropagation()} onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Quick Menu Settings">
        <h2 className={styles.title}>Quick Menu Settings</h2>

        <div className={styles.slotList}>
          {slots.map((slot, i) => (
            <div key={i} className={styles.slotRow} data-testid={`quickmenu-slot-row-${i}`}>
              <span className={styles.slotIndex}>{i + 1}</span>
              <select
                className={styles.slotSelect}
                value={actionKey(slot.actionType)}
                onChange={(e) => handleSlotChange(i, e.target.value)}
                aria-label={`Slot ${i + 1} action`}
              >
                {AVAILABLE_ACTIONS.map((a) => (
                  <option key={actionKey(a.actionType)} value={actionKey(a.actionType)}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <button className={styles.resetBtn} onClick={resetToDefaults} type="button" data-testid="quickmenu-reset">
            Reset to Defaults
          </button>
          <button className={styles.closeBtn} onClick={onClose} type="button">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
