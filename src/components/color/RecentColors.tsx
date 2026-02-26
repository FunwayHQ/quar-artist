import type { HSBColor } from '../../types/color.ts'
import { hsbToHex } from '../../types/color.ts'
import styles from './RecentColors.module.css'

interface RecentColorsProps {
  colors: HSBColor[]
  onSelect: (color: HSBColor) => void
}

/**
 * Horizontal strip showing the last 10 picked colors.
 */
export function RecentColors({ colors, onSelect }: RecentColorsProps) {
  if (colors.length === 0) return null

  return (
    <div className={styles.container} aria-label="Recent colors">
      <span className={styles.label}>Recent</span>
      <div className={styles.strip}>
        {colors.map((color, i) => (
          <button
            key={i}
            className={styles.swatch}
            style={{ background: hsbToHex(color) }}
            onClick={() => onSelect(color)}
            aria-label={`Recent color ${i + 1}: ${hsbToHex(color)}`}
            title={hsbToHex(color)}
          />
        ))}
      </div>
    </div>
  )
}
