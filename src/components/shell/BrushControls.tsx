import { useBrushStore } from '@stores/brushStore.ts'
import { ToolBar } from './ToolBar.tsx'
import styles from './BrushControls.module.css'

export function BrushControls() {
  const activePresetId = useBrushStore((s) => s.activePresetId)
  const size = useBrushStore((s) => s.size)
  const opacity = useBrushStore((s) => s.opacity)
  const presets = useBrushStore((s) => s.presets)
  const setPreset = useBrushStore((s) => s.setPreset)
  const setSize = useBrushStore((s) => s.setSize)
  const setOpacity = useBrushStore((s) => s.setOpacity)

  return (
    <div className={`glass ${styles.controls}`}>
      <ToolBar />

      <div className={styles.divider} />

      <div className={styles.group}>
        {presets.map((p) => (
          <button
            key={p.id}
            className={styles.presetButton}
            data-active={activePresetId === p.id}
            onClick={() => setPreset(p.id)}
            title={p.name}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        <span className={styles.label}>Size</span>
        <input
          type="range"
          className={styles.slider}
          min={1}
          max={500}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          aria-label="Brush size"
        />
        <span className={styles.value}>{Math.round(size)}px</span>
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        <span className={styles.label}>Opacity</span>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          aria-label="Brush opacity"
        />
        <span className={styles.value}>{Math.round(opacity * 100)}%</span>
      </div>
    </div>
  )
}
