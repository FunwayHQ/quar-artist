import { useBrushStore } from '@stores/brushStore.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useSelectionStore } from '@stores/selectionStore.ts'
import { ToolBar } from './ToolBar.tsx'
import styles from './BrushControls.module.css'
import type { SelectionToolType } from '@app-types/selection.ts'

const SUB_TOOLS: { id: SelectionToolType; label: string }[] = [
  { id: 'rectangle', label: 'Rect' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'freehand', label: 'Lasso' },
  { id: 'magicWand', label: 'Wand' },
]

export function BrushControls() {
  const activeTool = useToolStore((s) => s.activeTool)
  const activePresetId = useBrushStore((s) => s.activePresetId)
  const size = useBrushStore((s) => s.size)
  const opacity = useBrushStore((s) => s.opacity)
  const presets = useBrushStore((s) => s.presets)
  const setPreset = useBrushStore((s) => s.setPreset)
  const setSize = useBrushStore((s) => s.setSize)
  const setOpacity = useBrushStore((s) => s.setOpacity)

  const activeSubTool = useSelectionStore((s) => s.activeSubTool)
  const setSubTool = useSelectionStore((s) => s.setSubTool)
  const tolerance = useSelectionStore((s) => s.magicWandOptions.tolerance)
  const contiguous = useSelectionStore((s) => s.magicWandOptions.contiguous)
  const featherRadius = useSelectionStore((s) => s.featherOptions.radius)
  const setMagicWandTolerance = useSelectionStore((s) => s.setMagicWandTolerance)
  const setMagicWandContiguous = useSelectionStore((s) => s.setMagicWandContiguous)
  const setFeatherRadius = useSelectionStore((s) => s.setFeatherRadius)

  const showBrushOptions = activeTool === 'brush' || activeTool === 'eraser'
  const showSelectionOptions = activeTool === 'selection'

  return (
    <div className={styles.toolStrip}>
      {/* Centered tool icons */}
      <div className={`glass ${styles.toolRow}`}>
        <ToolBar />
      </div>

      {/* Brush options bar */}
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

      {/* Selection options bar */}
      {showSelectionOptions && (
        <div className={`glass ${styles.optionsRow}`}>
          <div className={styles.presets}>
            {SUB_TOOLS.map((t) => (
              <button
                key={t.id}
                className={styles.presetButton}
                data-active={activeSubTool === t.id}
                onClick={() => setSubTool(t.id)}
                title={t.label}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={styles.divider} />

          <div className={styles.group}>
            <span className={styles.label}>Feather</span>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={50}
              value={featherRadius}
              onChange={(e) => setFeatherRadius(Number(e.target.value))}
              aria-label="Feather radius"
            />
            <span className={styles.value}>{featherRadius}px</span>
          </div>

          {activeSubTool === 'magicWand' && (
            <>
              <div className={styles.divider} />

              <div className={styles.group}>
                <span className={styles.label}>Tolerance</span>
                <input
                  type="range"
                  className={styles.slider}
                  min={0}
                  max={255}
                  value={tolerance}
                  onChange={(e) => setMagicWandTolerance(Number(e.target.value))}
                  aria-label="Magic wand tolerance"
                />
                <span className={styles.value}>{tolerance}</span>
              </div>

              <div className={styles.divider} />

              <label className={styles.checkGroup}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={contiguous}
                  onChange={(e) => setMagicWandContiguous(e.target.checked)}
                />
                <span className={styles.checkLabel}>Contiguous</span>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  )
}
