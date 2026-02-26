import { Eye, EyeOff, Lock, LockOpen, GripVertical, Paperclip } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { LayerInfo, BlendMode } from '../../types/layer.ts'
import { ALL_BLEND_MODES, BLEND_MODE_LABELS } from '../../types/layer.ts'
import styles from './LayerRow.module.css'

interface LayerRowProps {
  layer: LayerInfo
  isActive: boolean
  onSelect: () => void
  onToggleVisibility: () => void
  onOpacityChange: (opacity: number) => void
  onBlendModeChange: (mode: BlendMode) => void
  onRename: (name: string) => void
  onToggleAlphaLock: () => void
  onToggleClippingMask: () => void
}

export function LayerRow({
  layer,
  isActive,
  onSelect,
  onToggleVisibility,
  onOpacityChange,
  onBlendModeChange,
  onRename,
  onToggleAlphaLock,
  onToggleClippingMask,
}: LayerRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id })

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
      role="treeitem"
      aria-selected={isActive}
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
    </div>
  )
}
