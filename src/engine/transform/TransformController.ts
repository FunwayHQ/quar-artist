import { TransformManager } from './TransformManager.ts'
import type { BoundingBox, HandlePosition, Point, TransformState } from '../../types/selection.ts'

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

  // ── Pointer event routing ─────────────────────────────────────────

  /**
   * Handle pointer down in transform mode.
   * Returns true if the event was consumed (hit a handle or inside bounds).
   */
  handlePointerDown(canvasPoint: Point): boolean {
    if (!this.manager.isActive()) return false

    // Check if pointer hit a handle
    const handle = this.manager.hitTestHandle(canvasPoint)
    if (handle) {
      this.isDragging = true
      this.dragHandle = handle
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

    const handles = this.manager.getHandlePositions()
    if (!handles) return

    const handleSize = 6 / zoom
    const lineWidth = 1 / zoom

    ctx.save()

    // Draw bounding box
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)' // blue
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
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)'
      ctx.lineWidth = lineWidth
      ctx.fillRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize)
      ctx.strokeRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize)
    }

    // Draw rotation handle
    const rot = handles.rotation
    ctx.beginPath()
    ctx.moveTo(handles.topCenter.x, handles.topCenter.y)
    ctx.lineTo(rot.x, rot.y)
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)'
    ctx.stroke()

    // Draw rotation handle circle
    ctx.beginPath()
    ctx.arc(rot.x, rot.y, handleSize / 2, 0, Math.PI * 2)
    ctx.fillStyle = 'white'
    ctx.fill()
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)'
    ctx.stroke()

    ctx.restore()
  }

  private resetDrag() {
    this.isDragging = false
    this.dragHandle = null
    this.dragStart = null
  }
}
