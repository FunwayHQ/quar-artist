import { useState } from 'react'
import { CANVAS_PRESETS, DPI_PRESETS, type ColorSpace, type NewProjectConfig } from '@app-types/project.ts'
import { canvasSizeProblem, maxCanvasSide } from '../../utils/deviceLimits.ts'
import styles from './NewProjectDialog.module.css'

interface NewProjectDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (config: NewProjectConfig) => void
  /** The largest side this device allows. */
  maxSide?: number
}

const MAX_DPI = 9600

export function NewProjectDialog({ open, onClose, onCreate, maxSide = maxCanvasSide() }: NewProjectDialogProps) {
  const [name, setName] = useState('Untitled')
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)
  const [dpiChoice, setDpiChoice] = useState('72')
  const [customDpi, setCustomDpi] = useState(96)
  const [colorSpace, setColorSpace] = useState<ColorSpace>('srgb')
  const [linked, setLinked] = useState(false)
  const [aspect, setAspect] = useState(1920 / 1080)

  if (!open) return null

  const dpi = dpiChoice === 'custom' ? customDpi : Number(dpiChoice)
  const problem = canvasSizeProblem(width, height, maxSide)
    ?? (Number.isInteger(dpi) && dpi >= 1 && dpi <= MAX_DPI ? null : `DPI must be a whole number from 1 to ${MAX_DPI}`)
  const presets = CANVAS_PRESETS.filter((p) => p.width <= maxSide && p.height <= maxSide)

  const applyPreset = (preset: typeof CANVAS_PRESETS[number]) => {
    setWidth(preset.width)
    setHeight(preset.height)
    if ((DPI_PRESETS as readonly number[]).includes(preset.dpi)) {
      setDpiChoice(String(preset.dpi))
    } else {
      setDpiChoice('custom')
      setCustomDpi(preset.dpi)
    }
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
    if (problem) return
    onCreate({ name: name.trim() || 'Untitled', width, height, dpi, colorSpace })
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New Project">
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
          {presets.map((p) => (
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
              max={maxSide}
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
              max={maxSide}
              onChange={(e) => handleHeightChange(Number(e.target.value))}
              aria-label="Canvas height"
            />
          </label>
        </div>

        <div className={styles.dimensions}>
          <label className={styles.field}>
            <span className={styles.label}>DPI</span>
            <select
              className={styles.input}
              value={dpiChoice}
              onChange={(e) => setDpiChoice(e.target.value)}
              aria-label="DPI"
            >
              {DPI_PRESETS.map((value) => (
                <option key={value} value={String(value)}>{value}</option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </label>
          {dpiChoice === 'custom' && (
            <label className={styles.field}>
              <span className={styles.label}>Custom DPI</span>
              <input
                className={styles.input}
                type="number"
                value={customDpi}
                min={1}
                max={MAX_DPI}
                onChange={(e) => setCustomDpi(Number(e.target.value))}
                aria-label="Custom DPI"
              />
            </label>
          )}
          <label className={styles.field}>
            <span className={styles.label}>Colour space</span>
            <select
              className={styles.input}
              value={colorSpace}
              onChange={(e) => setColorSpace(e.target.value as ColorSpace)}
              aria-label="Colour space"
            >
              <option value="srgb">sRGB</option>
              <option value="display-p3" disabled>Display P3 (not available yet)</option>
            </select>
          </label>
        </div>

        {problem && <p className={styles.error} role="alert">{problem}</p>}

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose} type="button">Cancel</button>
          <button className={styles.createBtn} onClick={handleCreate} type="button" disabled={problem !== null}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
