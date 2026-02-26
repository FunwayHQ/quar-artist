import { useRef, useEffect } from 'react'
import { TitleBar } from '@components/shell/TitleBar.tsx'
import { BrushControls } from '@components/shell/BrushControls.tsx'
import { CanvasViewport } from '@components/shell/CanvasViewport.tsx'
import { LayersPanel } from '@components/layers/LayersPanel.tsx'
import { ColorPanel } from '@components/color/ColorPanel.tsx'
import { useEngine } from '@hooks/useEngine.ts'
import { useBrushStore } from '@stores/brushStore.ts'
import { useColorStore } from '@stores/colorStore.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useSelectionStore } from '@stores/selectionStore.ts'
import { useUIStore } from '@stores/uiStore.ts'
import { hsbToRgba } from '@app-types/color.ts'
import styles from './App.module.css'

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { manager, undo, redo } = useEngine(containerRef)
  const rightPanelTab = useUIStore((s) => s.rightPanelTab)

  // Sync brush preset changes to the engine
  useEffect(() => {
    if (!manager) return
    const unsub = useBrushStore.subscribe((state) => {
      const preset = state.getActivePreset()
      manager.brushEngine.setPreset(preset)
    })
    const preset = useBrushStore.getState().getActivePreset()
    manager.brushEngine.setPreset(preset)
    return unsub
  }, [manager])

  // Sync color changes to the engine
  useEffect(() => {
    if (!manager) return
    const unsub = useColorStore.subscribe((state) => {
      const rgba = hsbToRgba(state.primary)
      manager.brushEngine.setColor(rgba)
    })
    const rgba = hsbToRgba(useColorStore.getState().primary)
    manager.brushEngine.setColor(rgba)
    return unsub
  }, [manager])

  // Sync active tool to engine
  useEffect(() => {
    if (!manager) return
    const unsub = useToolStore.subscribe((state) => {
      manager.setActiveTool(state.activeTool)
    })
    manager.setActiveTool(useToolStore.getState().activeTool)
    return unsub
  }, [manager])

  // Sync selection store to engine
  useEffect(() => {
    if (!manager) return
    const unsub = useSelectionStore.subscribe((state) => {
      manager.setSelectionSubTool(state.activeSubTool)
      manager.setSelectionMode(state.selectionMode)
      manager.selectionController.magicWandTool.setOptions(state.magicWandOptions)
    })
    // Initial sync
    const s = useSelectionStore.getState()
    manager.setSelectionSubTool(s.activeSubTool)
    manager.setSelectionMode(s.selectionMode)
    manager.selectionController.magicWandTool.setOptions(s.magicWandOptions)

    // Wire selection state back to store
    manager.setSelectionChangeCallback((hasSelection, bounds) => {
      useSelectionStore.getState().setHasSelection(hasSelection, bounds)
    })
    return unsub
  }, [manager])

  // Sync modifier keys for selection constraint (Shift) and mode (Shift/Alt)
  useEffect(() => {
    if (!manager) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') manager.setSelectionConstrained(true)
      // Modifier-based selection mode switching
      if (useToolStore.getState().activeTool === 'selection') {
        if (e.shiftKey && e.altKey) {
          manager.setSelectionMode('intersect')
        } else if (e.shiftKey) {
          manager.setSelectionMode('add')
        } else if (e.altKey) {
          manager.setSelectionMode('subtract')
        }
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') manager.setSelectionConstrained(false)
      // Reset selection mode when modifiers released
      if (!e.shiftKey && !e.altKey) {
        manager.setSelectionMode(useSelectionStore.getState().selectionMode)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [manager])

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / X / Ctrl+A / Ctrl+D / Ctrl+Shift+I
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
      }
      if (mod && e.key === 'y') {
        e.preventDefault()
        redo()
      }
      // Select All — Ctrl+A
      if (mod && e.key === 'a') {
        e.preventDefault()
        manager?.selectAll()
      }
      // Deselect — Ctrl+D
      if (mod && e.key === 'd') {
        e.preventDefault()
        manager?.deselectAll()
      }
      // Invert Selection — Ctrl+Shift+I
      if (mod && e.key === 'I' && e.shiftKey) {
        e.preventDefault()
        manager?.invertSelection()
      }
      if (e.key === 'x' && !mod) {
        useColorStore.getState().swapColors()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, manager])

  return (
    <div className={styles.app}>
      <TitleBar />
      <BrushControls />
      <div className={styles.workspace}>
        {/* Left: Layers panel */}
        <div className={styles.leftPanel}>
          <LayersPanel manager={manager} />
        </div>

        {/* Center: Canvas */}
        <CanvasViewport ref={containerRef} />

        {/* Right: Properties panel (Color / Brush) */}
        <div className={styles.rightPanel}>
          <div className={styles.rightPanelHeader}>
            <button
              className={styles.rightPanelTab}
              data-active={rightPanelTab === 'color'}
              onClick={() => useUIStore.getState().setRightPanelTab('color')}
            >
              Color
            </button>
            <button
              className={styles.rightPanelTab}
              data-active={rightPanelTab === 'brush'}
              onClick={() => useUIStore.getState().setRightPanelTab('brush')}
            >
              Brush
            </button>
          </div>
          <div className={styles.rightPanelContent}>
            {rightPanelTab === 'color' && <ColorPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
