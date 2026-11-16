import { forwardRef } from 'react'
import type { RenderBackend } from '@app-types/engine.ts'
import styles from './CanvasViewport.module.css'

interface CanvasViewportProps {
  /** Whether the engine has finished initializing (exposed for tests as `data-engine-ready`). */
  engineReady?: boolean
  /** The backend the engine renders with (exposed for tests and bug reports as `data-renderer`). */
  renderer?: RenderBackend
}

/**
 * The canvas container div. The engine attaches PixiJS canvases to this element.
 * Engine lifecycle is managed by the parent via useEngine.
 */
export const CanvasViewport = forwardRef<HTMLDivElement, CanvasViewportProps>(function CanvasViewport(
  { engineReady = false, renderer },
  ref,
) {
  return (
    <div
      ref={ref}
      className={styles.viewport}
      data-testid="canvas-container"
      data-engine-ready={engineReady ? 'true' : 'false'}
      data-renderer={renderer}
    />
  )
})
