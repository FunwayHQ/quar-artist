import { forwardRef } from 'react'
import styles from './CanvasViewport.module.css'

/**
 * The canvas container div. The engine attaches PixiJS canvases to this element.
 * Engine lifecycle is managed by the parent via useEngine.
 */
export const CanvasViewport = forwardRef<HTMLDivElement>(function CanvasViewport(_, ref) {
  return <div ref={ref} className={styles.viewport} />
})
