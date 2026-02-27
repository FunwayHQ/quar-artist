import type { ViewState } from '../../types/engine.ts'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 64
const ZOOM_SENSITIVITY = 0.001

/**
 * Manages the canvas view transform: zoom, pan, rotation.
 * Pure math — no DOM, no PixiJS, no React.
 */
export class ViewTransform {
  private state: ViewState = {
    x: 0,
    y: 0,
    zoom: 1,
    rotation: 0,
  }

  private onChange: ((state: ViewState) => void) | null = null

  getState(): Readonly<ViewState> {
    return this.state
  }

  setChangeCallback(cb: (state: ViewState) => void) {
    this.onChange = cb
  }

  /** Pan by delta pixels in screen space */
  pan(dx: number, dy: number) {
    this.state.x += dx
    this.state.y += dy
    this.notify()
  }

  /** Zoom towards a point in screen coordinates */
  zoomAt(screenX: number, screenY: number, delta: number) {
    const factor = 1 - delta * ZOOM_SENSITIVITY
    const newZoom = clamp(this.state.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const scale = newZoom / this.state.zoom

    // Adjust pan so zoom is centered at the pointer
    this.state.x = screenX - scale * (screenX - this.state.x)
    this.state.y = screenY - scale * (screenY - this.state.y)
    this.state.zoom = newZoom
    this.notify()
  }

  /** Set zoom directly, centered at screen point */
  setZoom(zoom: number, screenX: number, screenY: number) {
    const newZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
    const scale = newZoom / this.state.zoom
    this.state.x = screenX - scale * (screenX - this.state.x)
    this.state.y = screenY - scale * (screenY - this.state.y)
    this.state.zoom = newZoom
    this.notify()
  }

  /** Rotate by delta radians around a screen point */
  rotate(deltaRad: number, screenX: number, screenY: number) {
    const cos = Math.cos(deltaRad)
    const sin = Math.sin(deltaRad)
    const dx = this.state.x - screenX
    const dy = this.state.y - screenY
    this.state.x = cos * dx - sin * dy + screenX
    this.state.y = sin * dx + cos * dy + screenY
    this.state.rotation += deltaRad
    this.notify()
  }

  /** Reset to identity (fit to screen) */
  reset() {
    this.state = { x: 0, y: 0, zoom: 1, rotation: 0 }
    this.notify()
  }

  /** Fit the document into the viewport with padding, centered */
  fitToDocument(docW: number, docH: number, viewportW: number, viewportH: number) {
    if (viewportW <= 0 || viewportH <= 0 || docW <= 0 || docH <= 0) return
    const padding = 40
    const availW = Math.max(viewportW - padding * 2, viewportW * 0.5)
    const availH = Math.max(viewportH - padding * 2, viewportH * 0.5)
    const zoom = clamp(Math.min(availW / docW, availH / docH, 1), MIN_ZOOM, MAX_ZOOM)
    const x = (viewportW - docW * zoom) / 2
    const y = (viewportH - docH * zoom) / 2
    this.state = { x, y, zoom, rotation: 0 }
    this.notify()
  }

  /** Convert screen point to canvas coordinates */
  screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    const cos = Math.cos(-this.state.rotation)
    const sin = Math.sin(-this.state.rotation)
    const dx = (screenX - this.state.x) / this.state.zoom
    const dy = (screenY - this.state.y) / this.state.zoom
    return {
      x: cos * dx - sin * dy,
      y: sin * dx + cos * dy,
    }
  }

  private notify() {
    this.onChange?.({ ...this.state })
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
