import type {
  TransformState,
  BoundingBox,
  HandlePosition,
  Point,
} from '../../types/selection.ts'

/**
 * Manages freeform transform operations on selected content.
 * Pure math — no PixiJS dependency. The CanvasManager uses this
 * to compute sprite transforms and render handles.
 */
export class TransformManager {
  private state: TransformState | null = null
  private active = false

  /** Begin a transform operation with the given selection bounds. */
  begin(bounds: BoundingBox) {
    this.state = {
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      pivotX: bounds.x + bounds.width / 2,
      pivotY: bounds.y + bounds.height / 2,
      originalBounds: { ...bounds },
    }
    this.active = true
  }

  /** Cancel the transform, returning to original state. */
  cancel() {
    this.state = null
    this.active = false
  }

  /** Apply the transform (returns the final state for the caller to execute). */
  apply(): TransformState | null {
    const result = this.state
    this.state = null
    this.active = false
    return result
  }

  isActive(): boolean {
    return this.active
  }

  getState(): TransformState | null {
    return this.state ? { ...this.state } : null
  }

  /** Move the selected content by a delta. */
  translate(dx: number, dy: number) {
    if (!this.state) return
    this.state.translateX += dx
    this.state.translateY += dy
  }

  /** Set absolute translation. */
  setTranslation(x: number, y: number) {
    if (!this.state) return
    this.state.translateX = x
    this.state.translateY = y
  }

  /** Set scale factors. */
  setScale(sx: number, sy: number) {
    if (!this.state) return
    this.state.scaleX = sx
    this.state.scaleY = sy
  }

  /** Set rotation in radians. */
  setRotation(radians: number) {
    if (!this.state) return
    this.state.rotation = radians
  }

  /**
   * Handle dragging on a specific transform handle.
   * Returns the updated transform state.
   *
   * @param handle Which handle is being dragged
   * @param current Current mouse position in canvas coords
   * @param start The position where the drag started
   * @param uniformScale Whether to constrain to uniform scaling (Shift key)
   */
  dragHandle(
    handle: HandlePosition,
    current: Point,
    start: Point,
    uniformScale: boolean,
  ): TransformState | null {
    if (!this.state) return null

    const bounds = this.state.originalBounds
    const cx = this.state.pivotX + this.state.translateX
    const cy = this.state.pivotY + this.state.translateY

    if (handle === 'rotation') {
      // Rotation: angle from pivot to current point
      const angle = Math.atan2(current.y - cy, current.x - cx)
      const startAngle = Math.atan2(start.y - cy, start.x - cx)
      this.state.rotation = angle - startAngle
      return { ...this.state }
    }

    // Scale handles
    const dx = current.x - start.x
    const dy = current.y - start.y

    let sx = this.state.scaleX
    let sy = this.state.scaleY

    const bw = bounds.width || 1
    const bh = bounds.height || 1

    switch (handle) {
      case 'topLeft':
        sx = Math.max(0.01, 1 - dx / bw)
        sy = Math.max(0.01, 1 - dy / bh)
        break
      case 'topCenter':
        sy = Math.max(0.01, 1 - dy / bh)
        break
      case 'topRight':
        sx = Math.max(0.01, 1 + dx / bw)
        sy = Math.max(0.01, 1 - dy / bh)
        break
      case 'middleLeft':
        sx = Math.max(0.01, 1 - dx / bw)
        break
      case 'middleRight':
        sx = Math.max(0.01, 1 + dx / bw)
        break
      case 'bottomLeft':
        sx = Math.max(0.01, 1 - dx / bw)
        sy = Math.max(0.01, 1 + dy / bh)
        break
      case 'bottomCenter':
        sy = Math.max(0.01, 1 + dy / bh)
        break
      case 'bottomRight':
        sx = Math.max(0.01, 1 + dx / bw)
        sy = Math.max(0.01, 1 + dy / bh)
        break
    }

    if (uniformScale) {
      const uniform = Math.max(sx, sy)
      sx = uniform
      sy = uniform
    }

    this.state.scaleX = sx
    this.state.scaleY = sy
    return { ...this.state }
  }

  /**
   * Get the 8 handle positions + rotation handle in canvas coordinates.
   * Accounts for current translation, scale, and rotation.
   */
  getHandlePositions(): Record<HandlePosition, Point> | null {
    if (!this.state) return null

    const { originalBounds: b, translateX: tx, translateY: ty, scaleX: sx, scaleY: sy, rotation, pivotX, pivotY } = this.state

    const hw = (b.width * sx) / 2
    const hh = (b.height * sy) / 2
    const cx = pivotX + tx
    const cy = pivotY + ty

    const rotatePoint = (lx: number, ly: number): Point => {
      const cos = Math.cos(rotation)
      const sin = Math.sin(rotation)
      return {
        x: cx + lx * cos - ly * sin,
        y: cy + lx * sin + ly * cos,
      }
    }

    return {
      topLeft: rotatePoint(-hw, -hh),
      topCenter: rotatePoint(0, -hh),
      topRight: rotatePoint(hw, -hh),
      middleLeft: rotatePoint(-hw, 0),
      middleRight: rotatePoint(hw, 0),
      bottomLeft: rotatePoint(-hw, hh),
      bottomCenter: rotatePoint(0, hh),
      bottomRight: rotatePoint(hw, hh),
      rotation: rotatePoint(0, -hh - 20), // 20px above top center
    }
  }

  /**
   * Hit-test: which handle (if any) is under the given point?
   * Returns the handle name or null.
   */
  hitTestHandle(point: Point, handleRadius = 6): HandlePosition | null {
    const handles = this.getHandlePositions()
    if (!handles) return null

    const entries = Object.entries(handles) as [HandlePosition, Point][]
    for (const [name, pos] of entries) {
      const dx = point.x - pos.x
      const dy = point.y - pos.y
      if (dx * dx + dy * dy <= handleRadius * handleRadius) {
        return name
      }
    }
    return null
  }

  /**
   * Check if a point is inside the transformed bounding box.
   * Used to determine if a click should start a move operation.
   */
  isInsideBounds(point: Point): boolean {
    if (!this.state) return false

    const { originalBounds: b, translateX: tx, translateY: ty, scaleX: sx, scaleY: sy, rotation, pivotX, pivotY } = this.state

    const cx = pivotX + tx
    const cy = pivotY + ty

    // Inverse-rotate the point around the center
    const cos = Math.cos(-rotation)
    const sin = Math.sin(-rotation)
    const dx = point.x - cx
    const dy = point.y - cy
    const lx = dx * cos - dy * sin
    const ly = dx * sin + dy * cos

    const hw = (b.width * sx) / 2
    const hh = (b.height * sy) / 2

    return Math.abs(lx) <= hw && Math.abs(ly) <= hh
  }

  /**
   * Transform a point from original selection space to current transformed space.
   */
  transformPoint(point: Point): Point {
    if (!this.state) return point

    const { translateX: tx, translateY: ty, scaleX: sx, scaleY: sy, rotation, pivotX, pivotY } = this.state

    // Translate to pivot-relative coords
    let x = point.x - pivotX
    let y = point.y - pivotY

    // Scale
    x *= sx
    y *= sy

    // Rotate
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const rx = x * cos - y * sin
    const ry = x * sin + y * cos

    // Translate back + offset
    return {
      x: rx + pivotX + tx,
      y: ry + pivotY + ty,
    }
  }

  /**
   * Get the current transformed bounding box (axis-aligned).
   */
  getTransformedBounds(): BoundingBox | null {
    const handles = this.getHandlePositions()
    if (!handles) return null

    const corners = [handles.topLeft, handles.topRight, handles.bottomLeft, handles.bottomRight]
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const c of corners) {
      minX = Math.min(minX, c.x)
      minY = Math.min(minY, c.y)
      maxX = Math.max(maxX, c.x)
      maxY = Math.max(maxY, c.y)
    }

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }
}
