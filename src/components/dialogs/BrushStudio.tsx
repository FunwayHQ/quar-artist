import { useState, useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useBrushStore } from '@stores/brushStore.ts'
import { useUIStore } from '@stores/uiStore.ts'
import { BRUSH_CATEGORIES } from '@engine/brush/BrushParams.ts'
import { ShapeTab } from './brush-studio/ShapeTab.tsx'
import { DynamicsTab } from './brush-studio/DynamicsTab.tsx'
import { TextureTab } from './brush-studio/TextureTab.tsx'
import { TransferTab } from './brush-studio/TransferTab.tsx'
import { ScatterTab } from './brush-studio/ScatterTab.tsx'
import { SmoothingTab } from './brush-studio/SmoothingTab.tsx'
import type { BrushPreset } from '@app-types/brush.ts'
import styles from './BrushStudio.module.css'

type TabId = 'shape' | 'dynamics' | 'texture' | 'transfer' | 'scatter' | 'smoothing'

const TABS: { id: TabId; label: string }[] = [
  { id: 'shape', label: 'Shape' },
  { id: 'dynamics', label: 'Dynamics' },
  { id: 'texture', label: 'Texture' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'smoothing', label: 'Smoothing' },
]

interface BrushStudioProps {
  open: boolean
  onClose: () => void
}

export function BrushStudio({ open, onClose }: BrushStudioProps) {
  const [activeTab, setActiveTab] = useState<TabId>('shape')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [savePresetName, setSavePresetName] = useState('')
  const previewRef = useRef<HTMLCanvasElement>(null)
  const saveInputRef = useRef<HTMLInputElement>(null)

  const activePresetId = useBrushStore((s) => s.activePresetId)
  const presets = useBrushStore((s) => s.presets)
  const customPresets = useBrushStore((s) => s.customPresets)
  const setPreset = useBrushStore((s) => s.setPreset)

  // Get individual values to avoid infinite re-render from getActivePreset() creating new objects
  const currentSize = useBrushStore((s) => s.size)
  const currentOpacity = useBrushStore((s) => s.opacity)

  // Working copy of the preset — computed once per render, not subscribed reactively
  const currentPreset: BrushPreset = (() => {
    const state = useBrushStore.getState()
    const allP = [...state.presets, ...state.customPresets]
    const p = allP.find((p) => p.id === activePresetId) ?? state.presets[0]
    return { ...p, size: currentSize, opacity: currentOpacity }
  })()

  const handleParamChange = useCallback((updates: Partial<BrushPreset>) => {
    useBrushStore.getState().setActivePresetParams(updates)
  }, [])

  const openSaveDialog = useCallback(() => {
    const preset = useBrushStore.getState().getActivePreset()
    setSavePresetName(preset.name + ' Copy')
    setShowSaveDialog(true)
  }, [])

  const closeSaveDialog = useCallback(() => {
    setShowSaveDialog(false)
    setSavePresetName('')
  }, [])

  const confirmSavePreset = useCallback(() => {
    const trimmed = savePresetName.trim()
    if (!trimmed) return
    const preset = useBrushStore.getState().getActivePreset()
    const newPreset: BrushPreset = {
      ...preset,
      id: `custom-${Date.now()}`,
      name: trimmed,
    }
    useBrushStore.getState().addCustomPreset(newPreset)
    useUIStore.getState().addToast(`Saved preset "${trimmed}"`, 'success')
    setShowSaveDialog(false)
    setSavePresetName('')
  }, [savePresetName])

  // Auto-focus and select the name input when save dialog opens
  useEffect(() => {
    if (showSaveDialog && saveInputRef.current) {
      saveInputRef.current.focus()
      saveInputRef.current.select()
    }
  }, [showSaveDialog])

  // Close on Escape — save dialog takes priority
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSaveDialog) {
          closeSaveDialog()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose, showSaveDialog, closeSaveDialog])

  // Draw preview stroke
  useEffect(() => {
    if (!open) return
    const canvas = previewRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
    ctx.scale(dpr, dpr)

    const w = canvas.clientWidth
    const h = canvas.clientHeight
    ctx.clearRect(0, 0, w, h)

    // Determine stroke visual style from shape texture
    const baseWidth = Math.min(currentPreset.size * 0.3, 8)
    const tex = currentPreset.shapeTextureId
    const isGrainy = tex === 'pencil-grain' || tex === 'charcoal-grain' || tex === 'pastel-rough'
    const isSoft = tex === 'soft-round' || tex === 'airbrush-gradient'
    const isBristled = tex === 'oil-bristle' || tex === 'watercolor-bleed'
    const isFlat = tex === 'flat-square' || tex === 'marker-flat'

    // Build sine-wave path points with optional texture jitter
    const points: { x: number; y: number }[] = []
    // Use a seed from texture name for deterministic jitter
    let seed = 0
    for (let c = 0; c < (tex?.length ?? 0); c++) seed += tex!.charCodeAt(c)
    const jitter = (i: number) => {
      if (!isGrainy) return 0
      // Simple pseudo-random from seed + index
      const v = Math.sin(seed * 9301 + i * 49297) * 10000
      return (v - Math.floor(v) - 0.5) * baseWidth * 0.4
    }

    for (let x = 16; x < w - 16; x++) {
      const t = (x - 16) / (w - 32)
      const y = h / 2 + Math.sin(t * Math.PI * 3) * (h * 0.28) * (0.3 + t * 0.7)
      points.push({ x, y: y + jitter(x) })
    }

    // Glow under-layer
    ctx.save()
    ctx.filter = isSoft ? 'blur(10px)' : 'blur(6px)'
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)'
    ctx.lineWidth = isSoft ? baseWidth * 1.8 : baseWidth * 1.2
    ctx.lineCap = isFlat ? 'square' : 'round'
    ctx.lineJoin = 'round'
    ctx.globalAlpha = currentPreset.opacity * (isSoft ? 0.5 : 1)
    ctx.beginPath()
    for (let i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(points[i].x, points[i].y)
      else ctx.lineTo(points[i].x, points[i].y)
    }
    ctx.stroke()
    ctx.restore()

    // For bristled brushes, draw multiple thin offset strokes
    if (isBristled) {
      const bristleCount = 3
      for (let b = 0; b < bristleCount; b++) {
        const offset = (b - (bristleCount - 1) / 2) * baseWidth * 0.3
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.5 + b * 0.15})`
        ctx.lineWidth = baseWidth * 0.4
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalAlpha = currentPreset.opacity * 0.8
        ctx.beginPath()
        for (let i = 0; i < points.length; i++) {
          const px = points[i].x
          const py = points[i].y + offset
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.stroke()
      }
    } else {
      // Main stroke
      ctx.strokeStyle = '#F59E0B'
      ctx.lineWidth = isFlat ? baseWidth * 1.3 : baseWidth
      ctx.lineCap = isFlat ? 'square' : 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = currentPreset.opacity * (isGrainy ? 0.7 : 1)

      if (isGrainy) {
        // Draw as small segments with gaps for grainy appearance
        for (let i = 1; i < points.length; i += 2) {
          ctx.beginPath()
          ctx.moveTo(points[i - 1].x, points[i - 1].y)
          ctx.lineTo(points[i].x, points[i].y)
          ctx.stroke()
        }
      } else {
        ctx.beginPath()
        for (let i = 0; i < points.length; i++) {
          if (i === 0) ctx.moveTo(points[i].x, points[i].y)
          else ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }, [open, currentPreset])

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  if (!open) return null

  const allPresets = [...presets, ...customPresets]

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Brush Studio">
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Brush Studio</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close" type="button">
            <X size={18} />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className={styles.body}>
          {/* Sidebar: preset list */}
          <div className={styles.sidebar}>
            {BRUSH_CATEGORIES.map((cat) => {
              const catPresets = allPresets.filter((p) => p.category === cat.id)
              if (catPresets.length === 0) return null
              return (
                <div key={cat.id}>
                  <div className={styles.categoryHeader}>{cat.label}</div>
                  {catPresets.map((p) => (
                    <button
                      key={p.id}
                      className={styles.presetItem}
                      data-active={activePresetId === p.id}
                      onClick={() => setPreset(p.id)}
                      type="button"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>

          {/* Content: tabs + tab content */}
          <div className={styles.content}>
            <div className={styles.tabs}>
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={styles.tab}
                  data-active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className={styles.tabContent}>
              {activeTab === 'shape' && <ShapeTab preset={currentPreset} onChange={handleParamChange} />}
              {activeTab === 'dynamics' && <DynamicsTab preset={currentPreset} onChange={handleParamChange} />}
              {activeTab === 'texture' && <TextureTab preset={currentPreset} onChange={handleParamChange} />}
              {activeTab === 'transfer' && <TransferTab preset={currentPreset} onChange={handleParamChange} />}
              {activeTab === 'scatter' && <ScatterTab preset={currentPreset} onChange={handleParamChange} />}
              {activeTab === 'smoothing' && <SmoothingTab preset={currentPreset} onChange={handleParamChange} />}
            </div>
          </div>
        </div>

        {/* Preview strip */}
        <div className={styles.preview}>
          <span className={styles.previewLabel}>Preview</span>
          <canvas ref={previewRef} className={styles.previewCanvas} />
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose} type="button">Close</button>
          <button className={styles.saveBtn} onClick={openSaveDialog} type="button">Save as Preset</button>
        </div>

        {/* Save Preset Dialog — nested overlay, onKeyDown stops shortcuts leaking to app */}
        {showSaveDialog && (
          <div className={styles.saveOverlay} onClick={closeSaveDialog} onKeyDown={(e) => e.stopPropagation()}>
            <div
              className={styles.saveDialog}
              role="dialog"
              aria-modal="true"
              aria-label="Save Brush Preset"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.saveDialogHeader}>
                <h3 className={styles.saveDialogTitle}>Save as Preset</h3>
                <div className={styles.saveDialogSubtitle}>Create a custom brush preset</div>
              </div>

              <div className={styles.saveDialogBody}>
                <div className={styles.saveSourceChip}>
                  <span className={styles.saveSourceDot} />
                  <span className={styles.saveSourceText}>
                    Based on<span className={styles.saveSourceValue}> {currentPreset.name}</span>
                  </span>
                </div>

                <div>
                  <div className={styles.saveFieldLabel}>Preset Name</div>
                  <input
                    ref={saveInputRef}
                    className={styles.saveInput}
                    type="text"
                    value={savePresetName}
                    onChange={(e) => setSavePresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmSavePreset()
                    }}
                    placeholder="My Brush Preset"
                    aria-label="Preset name"
                  />
                </div>

                <div className={styles.saveHint}>
                  <span className={styles.saveHintKbd}>Enter</span>
                  <span className={styles.saveHintText}>to save</span>
                  <span className={styles.saveHintKbd}>Esc</span>
                  <span className={styles.saveHintText}>to cancel</span>
                </div>
              </div>

              <div className={styles.saveDialogFooter}>
                <button className={styles.saveCancelBtn} onClick={closeSaveDialog} type="button">
                  Cancel
                </button>
                <button
                  className={styles.saveConfirmBtn}
                  onClick={confirmSavePreset}
                  disabled={!savePresetName.trim()}
                  type="button"
                >
                  Save Preset
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
