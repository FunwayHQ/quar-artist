import type { SelectionMode, Point } from '../../../types/selection.ts'
import type { SelectionManager } from '../SelectionManager.ts'

/**
 * Rectangle selection tool.
 * Drag to create a rectangular selection.
 * Hold Shift to constrain to square.
 */
export class RectangleSelection {
  private origin: Point | null = null
  private current: Point | null = null
  private active = false

  /** Start a new rectangle selection at the given point. */
  begin(point: Point) {
    this.origin = { ...point }
    this.current = { ...point }
    this.active = true
  }

  /** Update the rectangle as the pointer moves. */
  update(point: Point) {
    if (!this.active) return
    this.current = { ...point }
  }

  /**
   * Complete the selection and apply it to the manager.
   * @param constrain If true, constrains to a square.
   */
  commit(manager: SelectionManager, mode: SelectionMode, constrain: boolean) {
    if (!this.active || !this.origin || !this.current) return
    this.active = false

    const rect = this.computeRect(constrain)
    if (rect.width > 0 && rect.height > 0) {
      manager.fillRect(rect.x, rect.y, rect.width, rect.height, mode)
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

  /** Get the current preview rectangle (for overlay rendering). */
  getPreviewRect(constrain: boolean): { x: number; y: number; width: number; height: number } | null {
    if (!this.active || !this.origin || !this.current) return null
    return this.computeRect(constrain)
  }

  private computeRect(constrain: boolean): { x: number; y: number; width: number; height: number } {
    const o = this.origin!
    const c = this.current!

    let x = Math.min(o.x, c.x)
    let y = Math.min(o.y, c.y)
    let w = Math.abs(c.x - o.x)
    let h = Math.abs(c.y - o.y)

    if (constrain) {
      const size = Math.max(w, h)
      w = size
      h = size
      // Adjust origin based on drag direction
      x = c.x >= o.x ? o.x : o.x - size
      y = c.y >= o.y ? o.y : o.y - size
    }

    return { x, y, width: w, height: h }
  }
}
