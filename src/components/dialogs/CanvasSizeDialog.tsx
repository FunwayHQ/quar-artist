import { useState, useEffect } from 'react'
import { CANVAS_PRESETS } from '@app-types/project.ts'
import styles from './NewProjectDialog.module.css'

interface CanvasSizeDialogProps {
  open: boolean
  currentWidth: number
  currentHeight: number
  onClose: () => void
  onResize: (width: number, height: number) => void
}

export function CanvasSizeDialog({ open, currentWidth, currentHeight, onClose, onResize }: CanvasSizeDialogProps) {
  const [width, setWidth] = useState(currentWidth)
  const [height, setHeight] = useState(currentHeight)
  const [linked, setLinked] = useState(false)
  const [aspect, setAspect] = useState(currentWidth / currentHeight)

  // Sync when dialog opens with current project dimensions
  useEffect(() => {
    if (open) {
      setWidth(currentWidth)
      setHeight(currentHeight)
      setAspect(currentWidth / currentHeight)
    }
  }, [open, currentWidth, currentHeight])

  if (!open) return null

  const applyPreset = (preset: typeof CANVAS_PRESETS[number]) => {
    setWidth(preset.width)
    setHeight(preset.height)
    setAspect(preset.width / preset.height)
  }

  const handleWidthChange = (w: number) => {
    setWidth(w)
    if (linked) setHeight(Math.round(w / aspect))
  }

  const handleHeightChange = (h: number) => {
    setHeight(h)
    if (linked) setWidth(Math.round(h * aspect))
  }

  const handleApply = () => {
    if (width > 0 && height > 0) {
      onResize(width, height)
    }
  }

  const unchanged = width === currentWidth && height === currentHeight

  return (
    <div className={styles.overlay} onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Canvas Size">
        <h2 className={styles.title}>Canvas Size</h2>

        <div className={styles.presets}>
          {CANVAS_PRESETS.map((p) => (
            <button
              key={p.label}
              className={styles.presetBtn}
              onClick={() => applyPreset(p)}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className={styles.dimensions}>
          <label className={styles.field}>
            <span className={styles.label}>Width</span>
            <input
              className={styles.input}
              type="number"
              value={width}
              min={1}
              max={16384}
              onChange={(e) => handleWidthChange(Number(e.target.value))}
              aria-label="Canvas width"
            />
          </label>
          <button
            className={styles.linkBtn}
            data-linked={linked}
            onClick={() => {
              setLinked(!linked)
              setAspect(width / height)
            }}
            type="button"
            title="Link dimensions"
          >
            {linked ? '\u{1F517}' : '\u26D3\uFE0F\u200D\u{1F4A5}'}
          </button>
          <label className={styles.field}>
            <span className={styles.label}>Height</span>
            <input
              className={styles.input}
              type="number"
              value={height}
              min={1}
              max={16384}
              onChange={(e) => handleHeightChange(Number(e.target.value))}
              aria-label="Canvas height"
            />
          </label>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose} type="button">Cancel</button>
          <button
            className={styles.createBtn}
            onClick={handleApply}
            type="button"
            disabled={unchanged}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
