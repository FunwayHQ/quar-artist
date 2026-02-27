import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Settings2, ChevronDown, X, Download, Upload } from 'lucide-react'
import { useBrushStore } from '@stores/brushStore.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useSelectionStore } from '@stores/selectionStore.ts'
import { useUIStore } from '@stores/uiStore.ts'
import { exportBrushPreset, importBrushPreset } from '../../io/brushPresets.ts'
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
  const customPresets = useBrushStore((s) => s.customPresets)
  const setPreset = useBrushStore((s) => s.setPreset)
  const setSize = useBrushStore((s) => s.setSize)
  const setOpacity = useBrushStore((s) => s.setOpacity)
  const deleteCustomPreset = useBrushStore((s) => s.deleteCustomPreset)

  const activeSubTool = useSelectionStore((s) => s.activeSubTool)
  const setSubTool = useSelectionStore((s) => s.setSubTool)
  const tolerance = useSelectionStore((s) => s.magicWandOptions.tolerance)
  const contiguous = useSelectionStore((s) => s.magicWandOptions.contiguous)
  const featherRadius = useSelectionStore((s) => s.featherOptions.radius)
  const setMagicWandTolerance = useSelectionStore((s) => s.setMagicWandTolerance)
  const setMagicWandContiguous = useSelectionStore((s) => s.setMagicWandContiguous)
  const setFeatherRadius = useSelectionStore((s) => s.setFeatherRadius)

  const [customDropdownOpen, setCustomDropdownOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })
  const customTriggerRef = useRef<HTMLButtonElement>(null)
  const customDropdownRef = useRef<HTMLDivElement>(null)

  const isCustomActive = customPresets.some((p) => p.id === activePresetId)

  const toggleCustomDropdown = useCallback(() => {
    setCustomDropdownOpen((prev) => {
      if (!prev && customTriggerRef.current) {
        const rect = customTriggerRef.current.getBoundingClientRect()
        setDropdownPos({
          top: rect.bottom + 6,
          left: rect.left + rect.width / 2,
        })
      }
      return !prev
    })
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!customDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        customTriggerRef.current?.contains(target) ||
        customDropdownRef.current?.contains(target)
      ) return
      setCustomDropdownOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCustomDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [customDropdownOpen])

  const handleSelectCustomPreset = useCallback((id: string) => {
    setPreset(id)
    setCustomDropdownOpen(false)
  }, [setPreset])

  const handleDeleteCustomPreset = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteCustomPreset(id)
    useUIStore.getState().addToast('Preset deleted', 'info')
  }, [deleteCustomPreset])

  const handleExportPreset = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const preset = customPresets.find((p) => p.id === id)
    if (preset) {
      exportBrushPreset(preset)
      useUIStore.getState().addToast(`Exported "${preset.name}"`, 'success')
    }
  }, [customPresets])

  const handleImportPreset = useCallback(async () => {
    const preset = await importBrushPreset()
    if (preset) {
      useBrushStore.getState().addCustomPreset(preset)
      useUIStore.getState().addToast(`Imported "${preset.name}"`, 'success')
    }
    setCustomDropdownOpen(false)
  }, [])

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

          {/* Custom presets dropdown */}
          <div className={styles.divider} />
          <div className={styles.customSection}>
            <button
              ref={customTriggerRef}
              className={styles.customTrigger}
              data-active={isCustomActive}
              data-open={customDropdownOpen}
              onClick={toggleCustomDropdown}
              title="Custom presets"
              type="button"
            >
              <span className={styles.customLabel}>Custom</span>
              <ChevronDown size={10} />
            </button>

            {customDropdownOpen && createPortal(
              <div
                ref={customDropdownRef}
                className={styles.customDropdown}
                style={{ top: dropdownPos.top, left: dropdownPos.left }}
              >
                <div className={styles.customDropdownHeader}>Custom Presets</div>
                {customPresets.length === 0 && (
                  <div className={styles.customDropdownEmpty}>
                    No custom presets yet
                  </div>
                )}
                {customPresets.map((p) => (
                  <div
                    key={p.id}
                    className={styles.customDropdownItem}
                    data-active={activePresetId === p.id}
                    onClick={() => handleSelectCustomPreset(p.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSelectCustomPreset(p.id) }}
                  >
                    <span className={styles.customDropdownDot} />
                    <span className={styles.customDropdownName}>{p.name}</span>
                    <button
                      className={styles.customDropdownExport}
                      onClick={(e) => handleExportPreset(e, p.id)}
                      title={`Export "${p.name}"`}
                      aria-label={`Export preset ${p.name}`}
                      type="button"
                    >
                      <Download size={10} />
                    </button>
                    <button
                      className={styles.customDropdownDelete}
                      onClick={(e) => handleDeleteCustomPreset(e, p.id)}
                      title={`Delete "${p.name}"`}
                      aria-label={`Delete preset ${p.name}`}
                      type="button"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <div className={styles.customDropdownFooter}>
                  <button
                    className={styles.customDropdownAction}
                    onClick={handleImportPreset}
                    type="button"
                  >
                    <Upload size={12} />
                    <span>Import .qbrush</span>
                  </button>
                </div>
              </div>,
              document.body,
            )}
          </div>

          <button
            className={styles.presetButton}
            onClick={() => useUIStore.getState().setShowBrushStudio(true)}
            title="Brush Studio"
          >
            <Settings2 size={14} />
          </button>

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
