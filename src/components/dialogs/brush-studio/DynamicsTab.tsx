import type { BrushPreset } from '@app-types/brush.ts'
import { PressureCurveEditor } from './PressureCurveEditor.tsx'
import type { PressureCurvePoints } from '@engine/brush/PressureCurve.ts'
import { LINEAR_CURVE } from '@engine/brush/PressureCurve.ts'
import styles from '../BrushStudio.module.css'

interface DynamicsTabProps {
  preset: BrushPreset
  onChange: (updates: Partial<BrushPreset>) => void
}

export function DynamicsTab({ preset, onChange }: DynamicsTabProps) {
  const curve: PressureCurvePoints = preset.pressureCurve ?? LINEAR_CURVE

  return (
    <div>
      <div className={styles.paramGroup}>
        <div className={styles.paramCheck}>
          <input
            type="checkbox"
            id="pressure-size"
            checked={preset.pressureSizeEnabled}
            onChange={(e) => onChange({ pressureSizeEnabled: e.target.checked })}
          />
          <label htmlFor="pressure-size">Pressure controls size</label>
        </div>
      </div>

      <div className={styles.paramGroup}>
        <div className={styles.paramCheck}>
          <input
            type="checkbox"
            id="pressure-opacity"
            checked={preset.pressureOpacityEnabled}
            onChange={(e) => onChange({ pressureOpacityEnabled: e.target.checked })}
          />
          <label htmlFor="pressure-opacity">Pressure controls opacity</label>
        </div>
      </div>

      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Pressure Curve</span>
        <PressureCurveEditor
          value={curve}
          onChange={(newCurve) => onChange({ pressureCurve: newCurve })}
          size={180}
        />
      </div>

      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Min Size</span>
        <div className={styles.paramRow}>
          <input
            type="range"
            className={styles.paramSlider}
            min={1}
            max={preset.maxSize}
            value={preset.minSize}
            onChange={(e) => onChange({ minSize: Number(e.target.value) })}
          />
          <span className={styles.paramValue}>{preset.minSize}px</span>
        </div>
      </div>

      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Max Size</span>
        <div className={styles.paramRow}>
          <input
            type="range"
            className={styles.paramSlider}
            min={preset.minSize}
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
