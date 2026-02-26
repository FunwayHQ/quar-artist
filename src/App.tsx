import { useRef, useEffect } from 'react'
import { TitleBar } from '@components/shell/TitleBar.tsx'
import { BrushControls } from '@components/shell/BrushControls.tsx'
import { CanvasViewport } from '@components/shell/CanvasViewport.tsx'
import { RightShelf } from '@components/shell/RightShelf.tsx'
import { LayersPanel } from '@components/layers/LayersPanel.tsx'
import { ColorPanel } from '@components/color/ColorPanel.tsx'
import { useEngine } from '@hooks/useEngine.ts'
import { useBrushStore } from '@stores/brushStore.ts'
import { useColorStore } from '@stores/colorStore.ts'
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

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / X (swap colors)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault()
        redo()
      }
      if (e.key === 'x' && !e.ctrlKey && !e.metaKey) {
        useColorStore.getState().swapColors()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  return (
    <div className={styles.app}>
      <TitleBar />
      <BrushControls />
      <div className={styles.workspace}>
        {rightPanelTab === 'layers' && <LayersPanel manager={manager} />}
        {rightPanelTab === 'color' && <ColorPanel />}
        <CanvasViewport ref={containerRef} />
        <RightShelf />
      </div>
    </div>
  )
}
