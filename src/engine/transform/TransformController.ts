import { TransformManager } from './TransformManager.ts'
import type { BoundingBox, HandlePosition, Point, TransformState } from '../../types/selection.ts'

/** Distance from point p to the line segment a→b. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2)
}

/**
 * Orchestrates the transform tool interactions.
 * Renders transform handles on the overlay canvas and processes drag operations.
 *
 * No React, no PixiJS — only depends on TransformManager + 2D canvas overlay.
 */
export class TransformController {
  readonly manager = new TransformManager()

  private isDragging = false
  private dragHandle: HandlePosition | null = null
  private dragStart: Point | null = null
  private isConstrained = false

  /** Begin a transform operation on the given bounds. */
  begin(bounds: BoundingBox) {
    this.manager.begin(bounds)
  }

  /** Cancel the current transform. */
  cancel() {
    this.manager.cancel()
    this.resetDrag()
  }

  /** Apply the current transform and return the final state. */
  apply(): TransformState | null {
    const result = this.manager.apply()
    this.resetDrag()
    return result
  }

  /** Set the constrain modifier (Shift held). */
  setConstrained(constrained: boolean) {
    this.isConstrained = constrained
  }

  /** Whether a transform is active. */
  isActive(): boolean {
    return this.manager.isActive()
  }

  /** Whether a drag operation is in progress. */
  getDragging(): boolean {
    return this.isDragging
  }

  /** Get the active drag handle (null = move drag, undefined = not dragging). */
  getActiveHandle(): HandlePosition | null | undefined {
    if (!this.isDragging) return undefined
    return this.dragHandle
  }

  // ── Pointer event routing ─────────────────────────────────────────

  private currentZoom = 1

  /** Update the current zoom level (used for zoom-aware hit testing). */
  setZoom(zoom: number) {
    this.currentZoom = zoom
  }

  /**
   * Hit-test the rotation zone: just outside a corner of the bounding box.
   * Returns true if the pointer is within rotationRadius of any corner
   * but NOT on a scale handle and NOT inside the bounds.
   */
  hitTestRotationZone(canvasPoint: Point): boolean {
    if (!this.manager.isActive()) return false

    const zoom = this.currentZoom
    const handleRadius = 8 / zoom
    const rotationRadius = 18 / zoom

    // Must not be on a handle
    if (this.manager.hitTestHandle(canvasPoint, handleRadius, zoom)) return false
    // Must not be inside bounds
    if (this.manager.isInsideBounds(canvasPoint)) return false

    const handles = this.manager.getHandlePositions(zoom)
    if (!handles) return false

    const corners: Point[] = [handles.topLeft, handles.topRight, handles.bottomLeft, handles.bottomRight]
    for (const c of corners) {
      const dx = canvasPoint.x - c.x
      const dy = canvasPoint.y - c.y
      if (dx * dx + dy * dy <= rotationRadius * rotationRadius) return true
    }
    return false
  }

  /**
   * Hit-test the bounding box edges (lines between corners).
   * Returns the corresponding center handle for the closest edge, or null.
   */
  hitTestEdge(canvasPoint: Point): HandlePosition | null {
    if (!this.manager.isActive()) return null

    const zoom = this.currentZoom
    const threshold = 6 / zoom
    const handles = this.manager.getHandlePositions(zoom)
    if (!handles) return null

    const edges: { from: Point; to: Point; handle: HandlePosition }[] = [
      { from: handles.topLeft, to: handles.topRight, handle: 'topCenter' },
      { from: handles.topRight, to: handles.bottomRight, handle: 'middleRight' },
      { from: handles.bottomRight, to: handles.bottomLeft, handle: 'bottomCenter' },
      { from: handles.bottomLeft, to: handles.topLeft, handle: 'middleLeft' },
    ]

    for (const edge of edges) {
      if (distToSegment(canvasPoint, edge.from, edge.to) <= threshold) {
        return edge.handle
      }
    }
    return null
  }

  /**
   * Handle pointer down in transform mode.
   * Returns true if the event was consumed (hit a handle, edge, rotation zone, or inside bounds).
   */
  handlePointerDown(canvasPoint: Point): boolean {
    if (!this.manager.isActive()) return false

    // Check if pointer hit a scale handle (zoom-aware radius)
    const handleRadius = 8 / this.currentZoom
    const handle = this.manager.hitTestHandle(canvasPoint, handleRadius, this.currentZoom)
    if (handle && handle !== 'rotation') {
      this.isDragging = true
      this.dragHandle = handle
      this.dragStart = { ...canvasPoint }
      return true
    }

    // Check rotation zone (just outside corners)
    if (this.hitTestRotationZone(canvasPoint)) {
      this.isDragging = true
      this.dragHandle = 'rotation'
      this.dragStart = { ...canvasPoint }
      return true
    }

    // Check edge proximity (click on bounding box line to scale)
    const edgeHandle = this.hitTestEdge(canvasPoint)
    if (edgeHandle) {
      this.isDragging = true
      this.dragHandle = edgeHandle
      this.dragStart = { ...canvasPoint }
      return true
    }

    // Check if pointer is inside the transform bounds (move)
    if (this.manager.isInsideBounds(canvasPoint)) {
      this.isDragging = true
      this.dragHandle = null // null = move
      this.dragStart = { ...canvasPoint }
      return true
    }

    return false
  }

  /** Handle pointer move during transform drag. */
  handlePointerMove(canvasPoint: Point) {
    if (!this.isDragging || !this.dragStart) return

    if (this.dragHandle) {
      // Scale or rotate via handle drag
      this.manager.dragHandle(this.dragHandle, canvasPoint, this.dragStart, this.isConstrained)
    } else {
      // Move via drag inside bounds
      const dx = canvasPoint.x - this.dragStart.x
      const dy = canvasPoint.y - this.dragStart.y
      this.manager.setTranslation(dx, dy)
    }
  }

  /** Handle pointer up — end the current drag. */
  handlePointerUp() {
    this.isDragging = false
  }

  // ── Overlay rendering ─────────────────────────────────────────────

  /**
   * Draw transform handles on the overlay canvas.
   * Call this in the overlay render loop.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, zoom: number) {
    if (!this.manager.isActive()) return

    const handles = this.manager.getHandlePositions(zoom)
    if (!handles) return

    const handleSize = 6 / zoom
    const lineWidth = 1 / zoom

    ctx.save()

    // Draw bounding box
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)' // amber
    ctx.lineWidth = lineWidth
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(handles.topLeft.x, handles.topLeft.y)
    ctx.lineTo(handles.topRight.x, handles.topRight.y)
    ctx.lineTo(handles.bottomRight.x, handles.bottomRight.y)
    ctx.lineTo(handles.bottomLeft.x, handles.bottomLeft.y)
    ctx.closePath()
    ctx.stroke()

    // Draw handle squares
    const allHandles: { pos: Point; name: string }[] = [
      { pos: handles.topLeft, name: 'topLeft' },
      { pos: handles.topCenter, name: 'topCenter' },
      { pos: handles.topRight, name: 'topRight' },
      { pos: handles.middleLeft, name: 'middleLeft' },
      { pos: handles.middleRight, name: 'middleRight' },
      { pos: handles.bottomLeft, name: 'bottomLeft' },
      { pos: handles.bottomCenter, name: 'bottomCenter' },
      { pos: handles.bottomRight, name: 'bottomRight' },
    ]

    for (const { pos } of allHandles) {
      ctx.fillStyle = 'white'
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)'
      ctx.lineWidth = lineWidth
      ctx.fillRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize)
      ctx.strokeRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize)
    }

    ctx.restore()
  }

  private resetDrag() {
    this.isDragging = false
    this.dragHandle = null
    this.dragStart = null
  }
}
