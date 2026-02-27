import type { BrushPreset } from '@app-types/brush.ts'
import styles from '../BrushStudio.module.css'

interface SmoothingTabProps {
  preset: BrushPreset
  onChange: (updates: Partial<BrushPreset>) => void
}

export function SmoothingTab({ preset, onChange }: SmoothingTabProps) {
  return (
    <div>
      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Smoothing</span>
        <div className={styles.paramRow}>
          <input
            type="range"
            className={styles.paramSlider}
            min={0}
            max={100}
            value={Math.round(preset.smoothing * 100)}
            onChange={(e) => onChange({ smoothing: Number(e.target.value) / 100 })}
          />
          <span className={styles.paramValue}>{Math.round(preset.smoothing * 100)}%</span>
        </div>
      </div>

      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Spacing</span>
        <div className={styles.paramRow}>
          <input
            type="range"
            className={styles.paramSlider}
            min={1}
            max={100}
            value={Math.round(preset.spacing * 100)}
            onChange={(e) => onChange({ spacing: Number(e.target.value) / 100 })}
          />
          <span className={styles.paramValue}>{Math.round(preset.spacing * 100)}%</span>
        </div>
      </div>
    </div>
  )
}
