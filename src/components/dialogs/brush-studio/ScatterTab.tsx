import type { BrushPreset } from '@app-types/brush.ts'
import styles from '../BrushStudio.module.css'

interface ScatterTabProps {
  preset: BrushPreset
  onChange: (updates: Partial<BrushPreset>) => void
}

export function ScatterTab({ preset, onChange }: ScatterTabProps) {
  return (
    <div>
      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Scatter Amount</span>
        <div className={styles.paramRow}>
          <input
            type="range"
            className={styles.paramSlider}
            min={0}
            max={100}
            value={Math.round(preset.scatter * 100)}
            onChange={(e) => onChange({ scatter: Number(e.target.value) / 100 })}
          />
          <span className={styles.paramValue}>{Math.round(preset.scatter * 100)}%</span>
        </div>
      </div>

      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Rotation Jitter</span>
        <div className={styles.paramRow}>
          <input
            type="range"
            className={styles.paramSlider}
            min={0}
            max={360}
            value={Math.round(preset.rotationJitter)}
            onChange={(e) => onChange({ rotationJitter: Number(e.target.value) })}
          />
          <span className={styles.paramValue}>{Math.round(preset.rotationJitter)}&deg;</span>
        </div>
      </div>
    </div>
  )
}
