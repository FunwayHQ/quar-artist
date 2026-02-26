import type { SelectionMode, Point } from '../../../types/selection.ts'
import type { SelectionManager } from '../SelectionManager.ts'

/**
 * Freehand (lasso) selection tool.
 * Draw a path to create a custom selection shape.
 * The path is automatically closed on pointer up.
 */
export class FreehandSelection {
  private points: Point[] = []
  private active = false

  /** Start a new freehand selection at the given point. */
  begin(point: Point) {
    this.points = [{ ...point }]
    this.active = true
  }

  /** Add a point to the path as the pointer moves. */
  update(point: Point) {
    if (!this.active) return
    // Only add if moved enough to avoid redundant points
    const last = this.points[this.points.length - 1]
    const dx = point.x - last.x
    const dy = point.y - last.y
    if (dx * dx + dy * dy >= 4) { // min 2px distance
      this.points.push({ ...point })
    }
  }

  /**
   * Complete the selection and apply the polygon to the manager.
   * The path is automatically closed.
   */
  commit(manager: SelectionManager, mode: SelectionMode) {
    if (!this.active || this.points.length < 3) {
      this.cancel()
      return
    }
    this.active = false

    manager.fillPolygon(this.points, mode)
    this.points = []
  }

  /** Cancel the in-progress selection. */
  cancel() {
    this.active = false
    this.points = []
  }

  isActive(): boolean {
    return this.active
  }

  /** Get the current path points (for overlay rendering). */
  getPoints(): readonly Point[] {
    return this.points
  }
}
