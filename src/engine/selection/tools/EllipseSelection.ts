import type { SelectionMode, Point } from '../../../types/selection.ts'
import type { SelectionManager } from '../SelectionManager.ts'

/**
 * Ellipse selection tool.
 * Drag to create an elliptical selection.
 * Hold Shift to constrain to circle.
 */
export class EllipseSelection {
  private origin: Point | null = null
  private current: Point | null = null
  private active = false

  /** Start a new ellipse selection at the given point. */
  begin(point: Point) {
    this.origin = { ...point }
    this.current = { ...point }
    this.active = true
  }

  /** Update the ellipse as the pointer moves. */
  update(point: Point) {
    if (!this.active) return
    this.current = { ...point }
  }

  /**
   * Complete the selection and apply it to the manager.
   * @param constrain If true, constrains to a circle.
   */
  commit(manager: SelectionManager, mode: SelectionMode, constrain: boolean) {
    if (!this.active || !this.origin || !this.current) return
    this.active = false

    const ellipse = this.computeEllipse(constrain)
    if (ellipse.rx > 0 && ellipse.ry > 0) {
      manager.fillEllipse(ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry, mode)
    }

    this.origin = null
    this.current = null
  }

  /** Cancel the in-progress selection. */
  cancel() {
    this.active = false
    this.origin = null
    this.current = null
  }

  isActive(): boolean {
    return this.active
  }

  /** Get the current preview ellipse (for overlay rendering). */
  getPreviewEllipse(constrain: boolean): { cx: number; cy: number; rx: number; ry: number } | null {
    if (!this.active || !this.origin || !this.current) return null
    return this.computeEllipse(constrain)
  }

  private computeEllipse(constrain: boolean): { cx: number; cy: number; rx: number; ry: number } {
    const o = this.origin!
    const c = this.current!

    let w = Math.abs(c.x - o.x)
    let h = Math.abs(c.y - o.y)

    if (constrain) {
      const size = Math.max(w, h)
      w = size
      h = size
    }

    const rx = w / 2
    const ry = h / 2

    // Center of the bounding rect
    const minX = c.x >= o.x ? o.x : o.x - w
    const minY = c.y >= o.y ? o.y : o.y - h

    return { cx: minX + rx, cy: minY + ry, rx, ry }
  }
}
