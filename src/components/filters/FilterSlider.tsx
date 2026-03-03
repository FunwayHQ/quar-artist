import { memo } from 'react'
import styles from './FilterSlider.module.css'

interface FilterSliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}

export const FilterSlider = memo(function FilterSlider({ label, value, min, max, step = 1, unit = '', onChange }: FilterSliderProps) {
  return (
    <div className={styles.row}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{Math.round(value * 10) / 10}{unit}</span>
      </div>
      <input
        type="range"
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  )
})
