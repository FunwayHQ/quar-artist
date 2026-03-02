import type { VanishingPoint, SymmetryType, PerspectiveType } from '../../stores/guideStore.ts'

/**
 * Orchestrates drawing guide overlays on the interactive canvas.
 * Called from CanvasManager.renderOverlay() in canvas-space
 * (already translated/scaled by view transform).
 */
export class GuideManager {
  // Grid settings
  gridEnabled = false
  gridSpacing = 32
  gridColor = '#ffffff'
  gridOpacity = 0.15

  // Isometric settings
  isometricEnabled = false
  isometricSpacing = 32

  // Perspective settings
  perspectiveEnabled = false
  perspectiveType: PerspectiveType = '1-point'
  vanishingPoints: VanishingPoint[] = [{ x: 512, y: 384 }]
  horizonY = 384
  perspectiveLineCount = 12

  // Symmetry settings
  symmetryEnabled = false
  symmetryType: SymmetryType = 'vertical'
  symmetryAxes = 6
  symmetryRotation = 0
  symmetryCenterX = 512
  symmetryCenterY = 384
  symmetryColor = '#F59E0B'

  /**
   * Main entry point — draws all enabled guides on the overlay canvas.
   * Called in canvas-space (ctx already has view transform applied).
   */
  drawOverlay(ctx: CanvasRenderingContext2D, zoom: number, docW: number, docH: number): void {
    if (this.gridEnabled) {
      this.drawGrid(ctx, zoom, docW, docH)
    }
    if (this.isometricEnabled) {
      this.drawIsometricGrid(ctx, zoom, docW, docH)
    }
    if (this.perspectiveEnabled) {
      this.drawPerspective(ctx, zoom, docW, docH)
    }
    if (this.symmetryEnabled) {
      this.drawSymmetryAxis(ctx, zoom, docW, docH)
    }
  }

  /** Render 2D grid lines at gridSpacing intervals. */
  drawGrid(ctx: CanvasRenderingContext2D, zoom: number, docW: number, docH: number): void {
    const spacing = this.gridSpacing
    if (spacing <= 0) return

    ctx.save()
    ctx.strokeStyle = this.gridColor
    ctx.globalAlpha = this.gridOpacity
    ctx.lineWidth = 1 / zoom // constant 1px screen width

    ctx.beginPath()

    // Vertical lines
    for (let x = spacing; x < docW; x += spacing) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, docH)
    }

    // Horizontal lines
    for (let y = spacing; y < docH; y += spacing) {
      ctx.moveTo(0, y)
      ctx.lineTo(docW, y)
    }

    ctx.stroke()
    ctx.restore()
  }

  /** Render isometric grid (30°/150° angled lines + horizontal baselines). */
  drawIsometricGrid(ctx: CanvasRenderingContext2D, zoom: number, docW: number, docH: number): void {
    const spacing = this.isometricSpacing
    if (spacing <= 0) return

    ctx.save()
    ctx.strokeStyle = this.gridColor
    ctx.globalAlpha = this.gridOpacity
    ctx.lineWidth = 1 / zoom

    const angle30 = Math.PI / 6 // 30 degrees
    const tanA = Math.tan(angle30)
    const rowH = spacing * Math.sin(angle30) // vertical spacing between rows
    const reach = docW + docH / tanA // how far lines extend horizontally

    ctx.beginPath()

    // Horizontal baseline rows
    for (let y = 0; y <= docH; y += rowH) {
      ctx.moveTo(0, y)
      ctx.lineTo(docW, y)
    }

    // 30° lines (going up-right from left edge and bottom edge)
    for (let offset = -reach; offset <= reach; offset += spacing) {
      const x0 = offset
      const y0 = docH
      const x1 = offset + docH / tanA
      const y1 = 0
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
    }

    // 150° lines (going up-left from right edge and bottom edge)
    for (let offset = -reach; offset <= reach; offset += spacing) {
      const x0 = offset
      const y0 = docH
      const x1 = offset - docH / tanA
      const y1 = 0
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
    }

    ctx.stroke()
    ctx.restore()
  }

  /** Render perspective guide lines from vanishing points. */
  drawPerspective(ctx: CanvasRenderingContext2D, zoom: number, docW: number, docH: number): void {
    const lineCount = this.perspectiveLineCount
    if (lineCount <= 0) return

    ctx.save()
    ctx.strokeStyle = this.gridColor
    ctx.globalAlpha = this.gridOpacity * 1.5 // slightly more visible
    ctx.lineWidth = 1 / zoom

    // Draw horizon line
    ctx.save()
    ctx.setLineDash([6 / zoom, 4 / zoom])
    ctx.globalAlpha = this.gridOpacity * 0.8
    ctx.beginPath()
    ctx.moveTo(0, this.horizonY)
    ctx.lineTo(docW, this.horizonY)
    ctx.stroke()
    ctx.restore()

    // Draw radial lines from each vanishing point
    const points = this.perspectiveType === '2-point'
      ? this.vanishingPoints.slice(0, 2)
      : this.vanishingPoints.slice(0, 1)

    for (const vp of points) {
      this.drawRadialLines(ctx, vp, lineCount, docW, docH, zoom)
    }

    // Draw VP handles
    for (const vp of points) {
      this.drawVPHandle(ctx, vp, zoom)
    }

    ctx.restore()
  }

  /** Draw radial lines emanating from a vanishing point to document edges. */
  private drawRadialLines(
    ctx: CanvasRenderingContext2D,
    vp: VanishingPoint,
    count: number,
    docW: number,
    docH: number,
    zoom: number,
  ): void {
    ctx.beginPath()

    // Distribute lines evenly around full 360° but only draw those that reach document bounds
    const maxDist = Math.sqrt(docW * docW + docH * docH) * 2

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const endX = vp.x + Math.cos(angle) * maxDist
      const endY = vp.y + Math.sin(angle) * maxDist

      ctx.moveTo(vp.x, vp.y)
      ctx.lineTo(endX, endY)
    }

    ctx.stroke()
  }

  /** Draw a vanishing point handle (filled circle with amber border). */
  private drawVPHandle(ctx: CanvasRenderingContext2D, vp: VanishingPoint, zoom: number): void {
    const r = 8 / zoom
    ctx.save()
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(vp.x, vp.y, r, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#F59E0B'
    ctx.lineWidth = 2 / zoom
    ctx.stroke()
    ctx.restore()
  }

  /** Check if a canvas-space point hits a VP handle. Returns VP index or -1. */
  hitTestVP(canvasX: number, canvasY: number, zoom: number): number {
    if (!this.perspectiveEnabled) return -1
    const points = this.perspectiveType === '2-point'
      ? this.vanishingPoints.slice(0, 2)
      : this.vanishingPoints.slice(0, 1)

    const hitRadius = 12 / zoom
    for (let i = 0; i < points.length; i++) {
      const vp = points[i]
      const dx = canvasX - vp.x
      const dy = canvasY - vp.y
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return i
      }
    }
    return -1
  }

  /** Render symmetry axis lines. */
  drawSymmetryAxis(ctx: CanvasRenderingContext2D, zoom: number, docW: number, docH: number): void {
    ctx.save()
    ctx.strokeStyle = this.symmetryColor
    ctx.globalAlpha = 0.6
    ctx.lineWidth = 2 / zoom
    ctx.setLineDash([8 / zoom, 4 / zoom])

    const cx = this.symmetryCenterX
    const cy = this.symmetryCenterY

    if (this.symmetryType === 'vertical') {
      ctx.beginPath()
      ctx.moveTo(cx, 0)
      ctx.lineTo(cx, docH)
      ctx.stroke()
    } else if (this.symmetryType === 'horizontal') {
      ctx.beginPath()
      ctx.moveTo(0, cy)
      ctx.lineTo(docW, cy)
      ctx.stroke()
    } else if (this.symmetryType === 'quadrant') {
      ctx.beginPath()
      ctx.moveTo(cx, 0)
      ctx.lineTo(cx, docH)
      ctx.moveTo(0, cy)
      ctx.lineTo(docW, cy)
      ctx.stroke()
      // Draw draggable center handle
      this.drawSymmetryCenterHandle(ctx, zoom)
    } else if (this.symmetryType === 'radial') {
      const n = this.symmetryAxes
      const maxDist = Math.sqrt(docW * docW + docH * docH)
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + this.symmetryRotation
        const endX = cx + Math.cos(angle) * maxDist
        const endY = cy + Math.sin(angle) * maxDist
        const startX = cx - Math.cos(angle) * maxDist
        const startY = cy - Math.sin(angle) * maxDist
        ctx.moveTo(startX, startY)
        ctx.lineTo(endX, endY)
      }
      ctx.stroke()
      // Draw draggable center handle
      this.drawSymmetryCenterHandle(ctx, zoom)
    }

    ctx.restore()
  }

  /** Draw the symmetry center handle (filled circle with amber border). */
  private drawSymmetryCenterHandle(ctx: CanvasRenderingContext2D, zoom: number): void {
    const r = 8 / zoom
    ctx.save()
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(this.symmetryCenterX, this.symmetryCenterY, r, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = this.symmetryColor
    ctx.lineWidth = 2 / zoom
    ctx.stroke()
    ctx.restore()
  }

  /** Check if a canvas-space point hits the symmetry center handle. */
  hitTestSymmetryCenter(canvasX: number, canvasY: number, zoom: number): boolean {
    if (!this.symmetryEnabled) return false
    if (this.symmetryType !== 'quadrant' && this.symmetryType !== 'radial') return false
    const hitRadius = 12 / zoom
    const dx = canvasX - this.symmetryCenterX
    const dy = canvasY - this.symmetryCenterY
    return dx * dx + dy * dy <= hitRadius * hitRadius
  }
}
