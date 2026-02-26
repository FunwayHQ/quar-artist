import { useEffect, useRef, useState, useCallback } from 'react'
import { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import { useLayerStore } from '@stores/layerStore.ts'

/**
 * React hook that initializes the CanvasManager (PixiJS + overlay + input + brush engine + layers)
 * on mount and tears it down on unmount.
 */
export function useEngine(containerRef: React.RefObject<HTMLElement | null>) {
  const managerRef = useRef<CanvasManager | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const manager = new CanvasManager()
    managerRef.current = manager

    // Wire layer changes to the React store
    manager.setLayerChangeCallback((layers, activeId) => {
      useLayerStore.getState().syncFromEngine(layers, activeId)
    })

    manager
      .init(container)
      .then(() => {
        setReady(true)
      })
      .catch((err) => {
        console.error('[QUAR] Engine init failed:', err)
      })

    return () => {
      manager.destroy()
      managerRef.current = null
      setReady(false)
    }
  }, [containerRef])

  const undo = useCallback(() => {
    managerRef.current?.performUndo()
  }, [])

  const redo = useCallback(() => {
    managerRef.current?.performRedo()
  }, [])

  return { manager: managerRef.current, ready, undo, redo }
}
