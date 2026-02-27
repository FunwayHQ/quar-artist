import type { BrushPreset, ShapeTextureId } from '@app-types/brush.ts'
import styles from '../BrushStudio.module.css'

const SHAPE_TEXTURES: { id: ShapeTextureId; label: string }[] = [
  { id: 'hard-round', label: 'Hard Round' },
  { id: 'soft-round', label: 'Soft Round' },
  { id: 'pencil-grain', label: 'Pencil' },
  { id: 'ink-splatter', label: 'Ink' },
  { id: 'watercolor-bleed', label: 'Watercolor' },
  { id: 'oil-bristle', label: 'Oil Bristle' },
  { id: 'marker-flat', label: 'Marker' },
  { id: 'pastel-rough', label: 'Pastel' },
  { id: 'charcoal-grain', label: 'Charcoal' },
  { id: 'smudge-soft', label: 'Smudge' },
  { id: 'flat-square', label: 'Flat Square' },
  { id: 'airbrush-gradient', label: 'Airbrush' },
]

interface ShapeTabProps {
  preset: BrushPreset
  onChange: (updates: Partial<BrushPreset>) => void
}

export function ShapeTab({ preset, onChange }: ShapeTabProps) {
  return (
    <div>
      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Shape Texture</span>
        <div className={styles.textureGrid}>
          {SHAPE_TEXTURES.map((tex) => (
            <button
              key={tex.id}
              className={styles.textureBtn}
              data-active={preset.shapeTextureId === tex.id}
              onClick={() => onChange({ shapeTextureId: tex.id })}
              type="button"
            >
              {tex.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Hardness</span>
        <div className={styles.paramRow}>
          <input
            type="range"
            className={styles.paramSlider}
            min={0}
            max={100}
            value={Math.round(preset.hardness * 100)}
            onChange={(e) => onChange({ hardness: Number(e.target.value) / 100 })}
          />
          <span className={styles.paramValue}>{Math.round(preset.hardness * 100)}%</span>
        </div>
      </div>

      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Size Range</span>
        <div className={styles.paramRow}>
          <span className={styles.paramLabel}>Min</span>
          <input
            type="range"
            className={styles.paramSlider}
            min={1}
            max={500}
            value={preset.minSize}
            onChange={(e) => onChange({ minSize: Number(e.target.value) })}
          />
          <span className={styles.paramValue}>{preset.minSize}px</span>
        </div>
        <div className={styles.paramRow}>
          <span className={styles.paramLabel}>Max</span>
          <input
            type="range"
            className={styles.paramSlider}
            min={1}
            max={500}
            value={preset.maxSize}
            onChange={(e) => onChange({ maxSize: Number(e.target.value) })}
          />
          <span className={styles.paramValue}>{preset.maxSize}px</span>
        </div>
      </div>
    </div>
  )
}
