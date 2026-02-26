/**
 * Marching ants animation renderer.
 * Draws animated dashed boundary lines on a 2D canvas context
 * to indicate the current selection boundary.
 *
 * Pure CPU rendering — uses the overlay canvas (not PixiJS).
 */
export class MarchingAnts {
  private animationId: number | null = null
  private dashOffset = 0
  private segments: { x1: number; y1: number; x2: number; y2: number }[] = []
  private ctx: CanvasRenderingContext2D | null = null

  /** Dash pattern: 6px dash, 6px gap */
  private readonly dashLength = 6
  /** Animation speed: pixels per frame */
  private readonly speed = 0.4

  /** Start animating marching ants for the given boundary segments. */
  start(
    ctx: CanvasRenderingContext2D,
    segments: { x1: number; y1: number; x2: number; y2: number }[],
  ) {
    this.stop()
    this.ctx = ctx
    this.segments = segments
    this.dashOffset = 0

    if (segments.length === 0) return

    this.tick()
  }

  /** Update segments without restarting animation. */
  updateSegments(segments: { x1: number; y1: number; x2: number; y2: number }[]) {
    this.segments = segments
    if (segments.length === 0) {
      this.stop()
    }
  }

  /** Stop animating. */
  stop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  /** Whether the animation is currently running. */
  isRunning(): boolean {
    return this.animationId !== null
  }

  /**
   * Draw a single frame of marching ants at the current dash offset.
   * Call this from an external render loop if you prefer manual control.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    segments: { x1: number; y1: number; x2: number; y2: number }[],
    zoom: number,
  ) {
    if (segments.length === 0) return

    const lineWidth = 1 / zoom
    const dash = this.dashLength / zoom

    ctx.save()

    // Black dashes (background)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.lineWidth = lineWidth
    ctx.setLineDash([dash, dash])
    ctx.lineDashOffset = -this.dashOffset / zoom
    ctx.beginPath()
    for (const seg of segments) {
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
    }
    ctx.stroke()

    // White dashes (foreground, offset by half)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineDashOffset = -(this.dashOffset / zoom + dash)
    ctx.beginPath()
    for (const seg of segments) {
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
    }
    ctx.stroke()

    ctx.restore()
  }

  /** Advance the dash offset by one frame. */
  advance() {
    this.dashOffset += this.speed
    if (this.dashOffset >= this.dashLength * 2) {
      this.dashOffset -= this.dashLength * 2
    }
  }

  /** Get current dash offset (for testing). */
  getDashOffset(): number {
    return this.dashOffset
  }

  private tick = () => {
    this.advance()

    if (this.ctx && this.segments.length > 0) {
      this.draw(this.ctx, this.segments, 1)
    }

    this.animationId = requestAnimationFrame(this.tick)
  }

  destroy() {
    this.stop()
    this.ctx = null
    this.segments = []
  }
}
