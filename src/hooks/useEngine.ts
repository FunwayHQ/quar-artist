import { useEffect, useRef, useState, useCallback } from 'react'
import { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import { useLayerStore } from '@stores/layerStore.ts'
import { useProjectStore } from '@stores/projectStore.ts'

/**
 * Runs a CanvasManager (PixiJS + overlay + input + brush engine + layers) on
 * the canvas container.
 *
 * Pass `containerRef` as the container's `ref`. Every newly mounted container
 * gets its own engine, and the engine is destroyed when its container goes
 * away, so leaving the canvas view and coming back works. An engine replaced
 * before it finished starting (React StrictMode, a quick view change) never
 * reports ready, and its errors are ignored.
 */
export function useEngine() {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const managerRef = useRef<CanvasManager | null>(null)
  const [manager, setManager] = useState<CanvasManager | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!container) return
    let cancelled = false
    const mgr = new CanvasManager()
    managerRef.current = mgr

    // Wire layer changes to the React store
    mgr.setLayerChangeCallback((layers, activeId) => {
      if (!cancelled) useLayerStore.getState().syncFromEngine(layers, activeId)
    })

    // Pass document dimensions so textures are created at the correct size
    const { canvasWidth, canvasHeight } = useProjectStore.getState()

    mgr.init(container, canvasWidth, canvasHeight).then(
      () => {
        if (!cancelled) setManager(mgr)
      },
      (err: unknown) => {
        if (cancelled) return
        console.error('[QUAR] Engine init failed:', err)
        setError(err instanceof Error ? err : new Error(String(err)))
      },
    )

    return () => {
      cancelled = true
      mgr.destroy()
      if (managerRef.current === mgr) managerRef.current = null
      setManager(null)
      setError(null)
    }
  }, [container])

  const containerRef: (element: HTMLElement | null) => void = setContainer

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
    /** Callback ref for the element the engine renders into. */
    containerRef,
    /** The mounted container, or null outside the canvas view. */
    container,
    /** The running engine, once it has finished starting. */
    manager,
    ready: manager !== null,
    /** Why the engine failed to start, if it did. */
    error,
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
