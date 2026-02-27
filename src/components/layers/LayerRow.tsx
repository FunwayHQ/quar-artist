import { useState, useCallback } from 'react'
import { Eye, EyeOff, Lock, LockOpen, GripVertical, Paperclip } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ContextMenu } from '@components/ui/ContextMenu.tsx'
import type { LayerInfo, BlendMode } from '../../types/layer.ts'
import { ALL_BLEND_MODES, BLEND_MODE_LABELS } from '../../types/layer.ts'
import styles from './LayerRow.module.css'

interface LayerRowProps {
  layer: LayerInfo
  isActive: boolean
  canDelete: boolean
  canMergeDown: boolean
  onSelect: () => void
  onToggleVisibility: () => void
  onOpacityChange: (opacity: number) => void
  onBlendModeChange: (mode: BlendMode) => void
  onRename: (name: string) => void
  onToggleAlphaLock: () => void
  onToggleClippingMask: () => void
  onDuplicate: () => void
  onDelete: () => void
  onMergeDown: () => void
}

export function LayerRow({
  layer,
  isActive,
  canDelete,
  canMergeDown,
  onSelect,
  onToggleVisibility,
  onOpacityChange,
  onBlendModeChange,
  onRename,
  onToggleAlphaLock,
  onToggleClippingMask,
  onDuplicate,
  onDelete,
  onMergeDown,
}: LayerRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id })

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.row} ${isActive ? styles.active : ''}`}
      data-active={isActive}
      onClick={onSelect}
      onContextMenu={handleContextMenu}
      role="treeitem"
      aria-selected={isActive}
      data-testid="layer-row"
    >
      <div className={styles.dragHandle} {...attributes} {...listeners}>
        <GripVertical size={14} />
      </div>

      <div
        className={styles.thumbnail}
        style={layer.thumbnail ? {
          backgroundImage: `url(${layer.thumbnail})`,
          backgroundSize: 'cover',
        } : undefined}
      />

      <div className={styles.info}>
        <input
          className={styles.nameInput}
          value={layer.name}
          onChange={(e) => onRename(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Layer name: ${layer.name}`}
        />
        <div className={styles.meta}>
          <select
            className={styles.blendSelect}
            value={layer.blendMode}
            onChange={(e) => onBlendModeChange(e.target.value as BlendMode)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Blend mode"
          >
            {ALL_BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {BLEND_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
          <input
            type="range"
            className={styles.opacitySlider}
            min={0}
            max={100}
            value={Math.round(layer.opacity * 100)}
            onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Layer opacity"
          />
          <span className={styles.opacityValue}>
            {Math.round(layer.opacity * 100)}%
          </span>
        </div>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.iconBtn}
          onClick={(e) => { e.stopPropagation(); onToggleVisibility() }}
          aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
          title={layer.visible ? 'Hide' : 'Show'}
        >
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        <button
          className={`${styles.iconBtn} ${layer.alphaLock ? styles.activeToggle : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleAlphaLock() }}
          aria-label={layer.alphaLock ? 'Unlock alpha' : 'Lock alpha'}
          title="Alpha lock"
        >
          {layer.alphaLock ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>

        <button
          className={`${styles.iconBtn} ${layer.clippingMask ? styles.activeToggle : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleClippingMask() }}
          aria-label={layer.clippingMask ? 'Remove clipping mask' : 'Add clipping mask'}
          title="Clipping mask"
        >
          <Paperclip size={12} />
        </button>
      </div>

      {ctxMenu && (
        <ContextMenu
          items={[
            { label: 'Duplicate', action: onDuplicate },
            { label: 'Delete', action: onDelete, disabled: !canDelete },
            { label: '', separator: true },
            { label: 'Merge Down', action: onMergeDown, disabled: !canMergeDown },
            { label: '', separator: true },
            { label: layer.alphaLock ? 'Unlock Alpha' : 'Lock Alpha', action: onToggleAlphaLock },
            { label: layer.clippingMask ? 'Remove Clipping Mask' : 'Add Clipping Mask', action: onToggleClippingMask },
          ]}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
