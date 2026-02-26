import type { HSBColor, HarmonyMode } from '../../types/color.ts'
import { ALL_HARMONY_MODES, HARMONY_MODE_LABELS, getHarmonyHues, hsbToHex } from '../../types/color.ts'
import styles from './ColorHarmony.module.css'

interface ColorHarmonyProps {
  color: HSBColor
  harmonyMode: HarmonyMode
  onHarmonyModeChange: (mode: HarmonyMode) => void
  onSelectHarmonyColor: (color: HSBColor) => void
}

/**
 * Color harmony mode selector + companion color swatches.
 */
export function ColorHarmony({
  color,
  harmonyMode,
  onHarmonyModeChange,
  onSelectHarmonyColor,
}: ColorHarmonyProps) {
  const harmonyHues = getHarmonyHues(color.h, harmonyMode)

  return (
    <div className={styles.container}>
      <select
        className={styles.select}
        value={harmonyMode}
        onChange={(e) => onHarmonyModeChange(e.target.value as HarmonyMode)}
        aria-label="Harmony mode"
      >
        {ALL_HARMONY_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {HARMONY_MODE_LABELS[mode]}
          </option>
        ))}
      </select>

      {harmonyHues.length > 0 && (
        <div className={styles.swatches}>
          <button
            className={styles.swatch}
            style={{ background: hsbToHex(color) }}
            title="Primary"
            aria-label="Primary color"
          />
          {harmonyHues.map((hue, i) => {
            const hc: HSBColor = { h: hue, s: color.s, b: color.b }
            return (
              <button
                key={i}
                className={styles.swatch}
                style={{ background: hsbToHex(hc) }}
                onClick={() => onSelectHarmonyColor(hc)}
                title={`Harmony ${i + 1}: ${Math.round(hue)}°`}
                aria-label={`Harmony color ${i + 1}`}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
