import { ViewTransform } from '../canvas/ViewTransform.ts'
import type { PointerState } from '../../types/engine.ts'

interface Pointer {
  id: number
  x: number
  y: number
}

/**
 * Handles all pointer events on the canvas element.
 * Delegates gestures (pinch-zoom, rotate, pan) to ViewTransform.
 * Provides stroke input data for the brush engine.
 *
 * No React, no PixiJS — pure DOM event handling.
 */
export class InputManager {
  private element: HTMLElement | null = null
  private viewTransform: ViewTransform
  private activePointers = new Map<number, Pointer>()
  private isSpaceDown = false
  private isPanning = false
  private lastPanX = 0
  private lastPanY = 0

  /** Pinch/rotate/pan gesture state */
  private gestureStartDist = 0
  private gestureStartAngle = 0
  private gestureStartZoom = 1
  private lastGestureCx = 0
  private lastGestureCy = 0

  /** Callbacks for stroke input (consumed by brush engine) */
  private onPointerDown: ((state: PointerState) => void) | null = null
  private onPointerMove: ((state: PointerState, coalesced: PointerState[]) => void) | null = null
  private onPointerUp: ((state: PointerState) => void) | null = null

  constructor(viewTransform: ViewTransform) {
    this.viewTransform = viewTransform
  }

  setStrokeCallbacks(callbacks: {
    onPointerDown?: (state: PointerState) => void
    onPointerMove?: (state: PointerState, coalesced: PointerState[]) => void
    onPointerUp?: (state: PointerState) => void
  }) {
    this.onPointerDown = callbacks.onPointerDown ?? null
    this.onPointerMove = callbacks.onPointerMove ?? null
    this.onPointerUp = callbacks.onPointerUp ?? null
  }

  attach(element: HTMLElement) {
    this.element = element
    element.addEventListener('pointerdown', this.handlePointerDown)
    element.addEventListener('pointermove', this.handlePointerMove)
    element.addEventListener('pointerup', this.handlePointerUp)
    element.addEventListener('pointercancel', this.handlePointerUp)
    element.addEventListener('wheel', this.handleWheel, { passive: false })
    document.addEventListener('keydown', this.handleKeyDown)
    document.addEventListener('keyup', this.handleKeyUp)
  }

  detach() {
    if (!this.element) return
    const el = this.element
    el.removeEventListener('pointerdown', this.handlePointerDown)
    el.removeEventListener('pointermove', this.handlePointerMove)
    el.removeEventListener('pointerup', this.handlePointerUp)
    el.removeEventListener('pointercancel', this.handlePointerUp)
    el.removeEventListener('wheel', this.handleWheel)
    document.removeEventListener('keydown', this.handleKeyDown)
    document.removeEventListener('keyup', this.handleKeyUp)
    this.element = null
  }

  private handlePointerDown = (e: PointerEvent) => {
    this.element?.setPointerCapture(e.pointerId)
    const local = this.toLocalCoords(e.clientX, e.clientY)
    this.activePointers.set(e.pointerId, { id: e.pointerId, x: local.x, y: local.y })

    if (this.activePointers.size === 2) {
      this.startGesture()
      return
    }

    // Space+click = pan
    if (this.isSpaceDown) {
      this.isPanning = true
      this.lastPanX = local.x
      this.lastPanY = local.y
      return
    }

    // Single pointer — pass to stroke handler
    if (this.activePointers.size === 1) {
      this.onPointerDown?.(this.toPointerState(e))
    }
  }

  private handlePointerMove = (e: PointerEvent) => {
    const existing = this.activePointers.get(e.pointerId)
    if (!existing) return

    const local = this.toLocalCoords(e.clientX, e.clientY)
    existing.x = local.x
    existing.y = local.y

    // Two-pointer gesture: pinch-zoom + rotate
    if (this.activePointers.size === 2) {
      this.updateGesture()
      return
    }

    // Space+drag = pan
    if (this.isPanning) {
      const dx = local.x - this.lastPanX
      const dy = local.y - this.lastPanY
      this.lastPanX = local.x
      this.lastPanY = local.y
      this.viewTransform.pan(dx, dy)
      return
    }

    // Single pointer — pass to stroke handler with coalesced events
    if (this.activePointers.size === 1) {
      const coalesced = (e.getCoalescedEvents?.() ?? []).map((ce) => this.toPointerState(ce))
      this.onPointerMove?.(this.toPointerState(e), coalesced)
    }
  }

  private handlePointerUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId)

    if (this.isPanning) {
      this.isPanning = false
      return
    }

    if (this.activePointers.size < 2) {
      // Gesture ended
    }

    if (this.activePointers.size === 0) {
      this.onPointerUp?.(this.toPointerState(e))
    }
  }

  private handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    const local = this.toLocalCoords(e.clientX, e.clientY)

    // Ctrl+wheel = zoom (standard browser behavior, trackpad pinch)
    if (e.ctrlKey) {
      this.viewTransform.zoomAt(local.x, local.y, e.deltaY * 3)
    } else {
      // Regular scroll = zoom (mouse wheel), or pan if Shift held
      if (e.shiftKey) {
        this.viewTransform.pan(-e.deltaY, -e.deltaX)
      } else {
        this.viewTransform.zoomAt(local.x, local.y, e.deltaY)
      }
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !e.repeat) {
      this.isSpaceDown = true
      if (this.element) {
        this.element.style.cursor = 'grab'
      }
    }
  }

  private handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      this.isSpaceDown = false
      if (this.element) {
        this.element.style.cursor = ''
      }
    }
  }

  /* ── Coordinate helpers ── */

  /** Convert viewport clientX/clientY to element-local coordinates */
  private toLocalCoords(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.element) return { x: clientX, y: clientY }
    const rect = this.element.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  /** Convert a PointerEvent to a PointerState with element-local coordinates */
  private toPointerState(e: PointerEvent): PointerState {
    const local = this.toLocalCoords(e.clientX, e.clientY)
    return {
      x: local.x,
      y: local.y,
      pressure: e.pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      pointerId: e.pointerId,
      pointerType: e.pointerType as PointerState['pointerType'],
    }
  }

  /* ── Two-pointer gesture helpers ── */

  private startGesture() {
    const [a, b] = [...this.activePointers.values()]
    this.gestureStartDist = dist(a, b)
    this.gestureStartAngle = angle(a, b)
    this.gestureStartZoom = this.viewTransform.getState().zoom
    this.lastGestureCx = (a.x + b.x) / 2
    this.lastGestureCy = (a.y + b.y) / 2
  }

  private updateGesture() {
    const pointers = [...this.activePointers.values()]
    if (pointers.length < 2) return
    const [a, b] = pointers

    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2

    // Two-finger drag pan
    const panDx = cx - this.lastGestureCx
    const panDy = cy - this.lastGestureCy
    this.lastGestureCx = cx
    this.lastGestureCy = cy
    if (Math.abs(panDx) > 0.01 || Math.abs(panDy) > 0.01) {
      this.viewTransform.pan(panDx, panDy)
    }

    // Pinch zoom
    const currentDist = dist(a, b)
    if (this.gestureStartDist > 0) {
      const scale = currentDist / this.gestureStartDist
      const newZoom = this.gestureStartZoom * scale
      this.viewTransform.setZoom(newZoom, cx, cy)
    }

    // Rotation
    const currentAngle = angle(a, b)
    const deltaAngle = currentAngle - this.gestureStartAngle
    if (Math.abs(deltaAngle) > 0.001) {
      this.viewTransform.rotate(deltaAngle, cx, cy)
      this.gestureStartAngle = currentAngle
    }
  }
}

function dist(a: Pointer, b: Pointer): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function angle(a: Pointer, b: Pointer): number {
  return Math.atan2(b.y - a.y, b.x - a.x)
}

