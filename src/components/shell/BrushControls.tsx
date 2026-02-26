import { useBrushStore } from '@stores/brushStore.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { ToolBar } from './ToolBar.tsx'
import styles from './BrushControls.module.css'

export function BrushControls() {
  const activeTool = useToolStore((s) => s.activeTool)
  const activePresetId = useBrushStore((s) => s.activePresetId)
  const size = useBrushStore((s) => s.size)
  const opacity = useBrushStore((s) => s.opacity)
  const presets = useBrushStore((s) => s.presets)
  const setPreset = useBrushStore((s) => s.setPreset)
  const setSize = useBrushStore((s) => s.setSize)
  const setOpacity = useBrushStore((s) => s.setOpacity)

  const showBrushOptions = activeTool === 'brush' || activeTool === 'eraser'

  return (
    <div className={styles.toolStrip}>
      {/* Centered tool icons */}
      <div className={`glass ${styles.toolRow}`}>
        <ToolBar />
      </div>

      {/* Context-sensitive options bar */}
      {showBrushOptions && (
        <div className={`glass ${styles.optionsRow}`}>
          <div className={styles.presets}>
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
      )}
    </div>
  )
}
