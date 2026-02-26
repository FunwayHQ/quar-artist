import { useCallback, useState, useEffect } from 'react'
import type { HSBColor } from '../../types/color.ts'
import { hsbToRgb255, hsbToHex, hexToHsb, rgbaToHsb } from '../../types/color.ts'
import styles from './ValueSliders.module.css'

interface ValueSlidersProps {
  color: HSBColor
  onChange: (color: HSBColor) => void
}

type SliderMode = 'hsb' | 'rgb'

/**
 * Color value sliders — HSB mode + RGB mode + Hex input.
 * All modes are linked — changing one updates the others.
 */
export function ValueSliders({ color, onChange }: ValueSlidersProps) {
  const [mode, setMode] = useState<SliderMode>('hsb')
  const [hexInput, setHexInput] = useState('')

  const rgb = hsbToRgb255(color)
  const hex = hsbToHex(color)

  // Sync hex input when color changes externally
  useEffect(() => {
    setHexInput(hex.slice(1))
  }, [hex])

  const handleHexChange = useCallback((value: string) => {
    setHexInput(value)
    const parsed = hexToHsb(`#${value}`)
    if (parsed) {
      onChange(parsed)
    }
  }, [onChange])

  const handleRgbChange = useCallback((channel: 'r' | 'g' | 'b', value: number) => {
    const current = hsbToRgb255(color)
    const updated = { ...current, [channel]: value }
    const hsb = rgbaToHsb({
      r: updated.r / 255,
      g: updated.g / 255,
      b: updated.b / 255,
      a: 1,
    })
    onChange(hsb)
  }, [color, onChange])

  return (
    <div className={styles.container}>
      <div className={styles.modeToggle}>
        <button
          className={styles.modeBtn}
          data-active={mode === 'hsb'}
          onClick={() => setMode('hsb')}
        >
          HSB
        </button>
        <button
          className={styles.modeBtn}
          data-active={mode === 'rgb'}
          onClick={() => setMode('rgb')}
        >
          RGB
        </button>
      </div>

      {mode === 'hsb' ? (
        <div className={styles.sliders}>
          <div className={styles.row}>
            <label className={styles.label}>H</label>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={360}
              value={Math.round(color.h)}
              onChange={(e) => onChange({ ...color, h: Number(e.target.value) })}
              aria-label="Hue"
              style={{ '--slider-hue': `${color.h}` } as React.CSSProperties}
            />
            <span className={styles.value}>{Math.round(color.h)}°</span>
          </div>
          <div className={styles.row}>
            <label className={styles.label}>S</label>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={100}
              value={Math.round(color.s * 100)}
              onChange={(e) => onChange({ ...color, s: Number(e.target.value) / 100 })}
              aria-label="Saturation"
            />
            <span className={styles.value}>{Math.round(color.s * 100)}%</span>
          </div>
          <div className={styles.row}>
            <label className={styles.label}>B</label>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={100}
              value={Math.round(color.b * 100)}
              onChange={(e) => onChange({ ...color, b: Number(e.target.value) / 100 })}
              aria-label="Brightness"
            />
            <span className={styles.value}>{Math.round(color.b * 100)}%</span>
          </div>
        </div>
      ) : (
        <div className={styles.sliders}>
          <div className={styles.row}>
            <label className={styles.label}>R</label>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={255}
              value={rgb.r}
              onChange={(e) => handleRgbChange('r', Number(e.target.value))}
              aria-label="Red"
            />
            <span className={styles.value}>{rgb.r}</span>
          </div>
          <div className={styles.row}>
            <label className={styles.label}>G</label>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={255}
              value={rgb.g}
              onChange={(e) => handleRgbChange('g', Number(e.target.value))}
              aria-label="Green"
            />
            <span className={styles.value}>{rgb.g}</span>
          </div>
          <div className={styles.row}>
            <label className={styles.label}>B</label>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={255}
              value={rgb.b}
              onChange={(e) => handleRgbChange('b', Number(e.target.value))}
              aria-label="Blue"
            />
            <span className={styles.value}>{rgb.b}</span>
          </div>
        </div>
      )}

      <div className={styles.hexRow}>
        <label className={styles.label}>#</label>
        <input
          className={styles.hexInput}
          value={hexInput}
          onChange={(e) => handleHexChange(e.target.value)}
          maxLength={6}
          aria-label="Hex color"
          spellCheck={false}
        />
        <div
          className={styles.preview}
          style={{ background: hex }}
          aria-label="Color preview"
        />
      </div>
    </div>
  )
}
