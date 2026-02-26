import { useState } from 'react'
import { CANVAS_PRESETS } from '@app-types/project.ts'
import styles from './NewProjectDialog.module.css'

interface NewProjectDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (name: string, width: number, height: number, dpi: number) => void
}

export function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState('Untitled')
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)
  const [dpi, setDpi] = useState(72)
  const [linked, setLinked] = useState(false)
  const [aspect, setAspect] = useState(1920 / 1080)

  if (!open) return null

  const applyPreset = (preset: typeof CANVAS_PRESETS[number]) => {
    setWidth(preset.width)
    setHeight(preset.height)
    setDpi(preset.dpi)
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

  const handleCreate = () => {
    if (width > 0 && height > 0) {
      onCreate(name || 'Untitled', width, height, dpi)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New Project">
        <h2 className={styles.title}>New Project</h2>

        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Project name"
          />
        </label>

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
            {linked ? '🔗' : '⛓️‍💥'}
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

        <label className={styles.field}>
          <span className={styles.label}>DPI</span>
          <select
            className={styles.input}
            value={dpi}
            onChange={(e) => setDpi(Number(e.target.value))}
            aria-label="DPI"
          >
            <option value={72}>72</option>
            <option value={150}>150</option>
            <option value={300}>300</option>
          </select>
        </label>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose} type="button">Cancel</button>
          <button className={styles.createBtn} onClick={handleCreate} type="button">Create</button>
        </div>
      </div>
    </div>
  )
}
