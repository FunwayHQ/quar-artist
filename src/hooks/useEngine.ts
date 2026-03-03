import { useEffect, useRef, useState, useCallback } from 'react'
import { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import { useLayerStore } from '@stores/layerStore.ts'
import { useProjectStore } from '@stores/projectStore.ts'

/**
 * React hook that initializes the CanvasManager (PixiJS + overlay + input + brush engine + layers)
 * on mount and tears it down on unmount.
 */
export function useEngine(containerRef: React.RefObject<HTMLElement | null>) {
  const managerRef = useRef<CanvasManager | null>(null)
  const [manager, setManager] = useState<CanvasManager | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const mgr = new CanvasManager()
    managerRef.current = mgr

    // Wire layer changes to the React store
    mgr.setLayerChangeCallback((layers, activeId) => {
      useLayerStore.getState().syncFromEngine(layers, activeId)
    })

    // Pass document dimensions so textures are created at the correct size
    const { canvasWidth, canvasHeight } = useProjectStore.getState()

    mgr
      .init(container, canvasWidth, canvasHeight)
      .then(() => {
        setManager(mgr)
        setReady(true)
      })
      .catch((err) => {
        console.error('[QUAR] Engine init failed:', err)
      })

    return () => {
      mgr.destroy()
      managerRef.current = null
      setManager(null)
      setReady(false)
    }
  }, [containerRef])

  const undo = useCallback(() => {
    managerRef.current?.performUndo()
  }, [])

  const redo = useCallback(() => {
    managerRef.current?.performRedo()
  }, [])

  const commitTransform = useCallback(() => {
    managerRef.current?.commitTransform()
  }, [])

  const cancelTransform = useCallback(() => {
    managerRef.current?.cancelTransform()
  }, [])

  const flipLayerHorizontal = useCallback(() => {
    managerRef.current?.flipLayerHorizontal()
  }, [])

  const flipLayerVertical = useCallback(() => {
    managerRef.current?.flipLayerVertical()
  }, [])

  const rotateLayer90CW = useCallback(() => {
    managerRef.current?.rotateLayer90CW()
  }, [])

  const rotateLayer90CCW = useCallback(() => {
    managerRef.current?.rotateLayer90CCW()
  }, [])

  return {
    manager,
    ready,
    undo,
    redo,
    commitTransform,
    cancelTransform,
    flipLayerHorizontal,
    flipLayerVertical,
    rotateLayer90CW,
    rotateLayer90CCW,
  }
}
