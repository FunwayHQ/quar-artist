import type { BrushPreset } from '@app-types/brush.ts'
import styles from '../BrushStudio.module.css'

interface TransferTabProps {
  preset: BrushPreset
  onChange: (updates: Partial<BrushPreset>) => void
}

export function TransferTab({ preset, onChange }: TransferTabProps) {
  return (
    <div>
      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Opacity</span>
        <div className={styles.paramRow}>
          <input
            type="range"
            className={styles.paramSlider}
            min={0}
            max={100}
            value={Math.round(preset.opacity * 100)}
            onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
          />
          <span className={styles.paramValue}>{Math.round(preset.opacity * 100)}%</span>
        </div>
      </div>

      <div className={styles.paramGroup}>
        <div className={styles.paramCheck}>
          <input
            type="checkbox"
            id="is-eraser"
            checked={preset.isEraser}
            onChange={(e) => onChange({ isEraser: e.target.checked })}
          />
          <label htmlFor="is-eraser">Eraser mode</label>
        </div>
      </div>

      <div className={styles.paramGroup}>
        <div className={styles.paramCheck}>
          <input
            type="checkbox"
            id="uses-smudge"
            checked={preset.usesSmudge}
            onChange={(e) => onChange({ usesSmudge: e.target.checked })}
          />
          <label htmlFor="uses-smudge">Smudge mode</label>
        </div>
      </div>
    </div>
  )
}
