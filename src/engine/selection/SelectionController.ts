import { SelectionManager } from './SelectionManager.ts'
import { MarchingAnts } from './MarchingAnts.ts'
import { RectangleSelection } from './tools/RectangleSelection.ts'
import { EllipseSelection } from './tools/EllipseSelection.ts'
import { FreehandSelection } from './tools/FreehandSelection.ts'
import { MagicWandSelection } from './tools/MagicWandSelection.ts'
import type { SelectionToolType, SelectionMode, Point, BoundingBox } from '../../types/selection.ts'

/**
 * Orchestrates selection tools, selection mask, and marching ants rendering.
 * Bridges between InputManager events and the SelectionManager.
 *
 * No React, no PixiJS — only depends on selection engine + 2D canvas overlay.
 */
export class SelectionController {
  readonly manager: SelectionManager
  readonly marchingAnts = new MarchingAnts()

  readonly rectangleTool = new RectangleSelection()
  readonly ellipseTool = new EllipseSelection()
  readonly freehandTool = new FreehandSelection()
  readonly magicWandTool = new MagicWandSelection()

  private activeSubTool: SelectionToolType = 'rectangle'
  private selectionMode: SelectionMode = 'replace'
  private isConstrained = false
  private overlayCtx: CanvasRenderingContext2D | null = null
  private boundarySegments: { x1: number; y1: number; x2: number; y2: number }[] = []

  /** Callback to notify external state (e.g., Zustand store) of selection changes. */
  private onSelectionChange: ((hasSelection: boolean, bounds: BoundingBox | null) => void) | null = null

  constructor(width: number, height: number) {
    this.manager = new SelectionManager(width, height)
    this.manager.setChangeCallback((has, bounds) => {
      this.updateBoundary()
      this.onSelectionChange?.(has, bounds)
    })
  }

  /** Resize the selection mask (clears selection). */
  resize(width: number, height: number) {
    this.manager.resize(width, height)
  }

  /** Set the overlay canvas context for marching ants rendering. */
  setOverlayCtx(ctx: CanvasRenderingContext2D) {
    this.overlayCtx = ctx
  }

  /** Set external callback for selection state changes. */
  setSelectionChangeCallback(cb: (hasSelection: boolean, bounds: BoundingBox | null) => void) {
    this.onSelectionChange = cb
  }

  /** Set the active selection sub-tool. */
  setSubTool(tool: SelectionToolType) {
    this.cancelActiveTool()
    this.activeSubTool = tool
  }

  /** Set the selection combination mode. */
  setSelectionMode(mode: SelectionMode) {
    this.selectionMode = mode
  }

  /** Set constrain modifier (Shift held). */
  setConstrained(constrained: boolean) {
    this.isConstrained = constrained
  }

  /** Get the active sub-tool type. */
  getSubTool(): SelectionToolType {
    return this.activeSubTool
  }

  // ── Pointer event routing ─────────────────────────────────────────

  /** Handle pointer down — begin the active selection tool operation. */
  handlePointerDown(canvasPoint: Point) {
    switch (this.activeSubTool) {
      case 'rectangle':
        this.rectangleTool.begin(canvasPoint)
        break
      case 'ellipse':
        this.ellipseTool.begin(canvasPoint)
        break
      case 'freehand':
        this.freehandTool.begin(canvasPoint)
        break
      case 'magicWand':
        // Magic wand is single-click — handled separately
        break
    }
  }

  /** Handle pointer move — update the active selection tool. */
  handlePointerMove(canvasPoint: Point) {
    switch (this.activeSubTool) {
      case 'rectangle':
        this.rectangleTool.update(canvasPoint)
        break
      case 'ellipse':
        this.ellipseTool.update(canvasPoint)
        break
      case 'freehand':
        this.freehandTool.update(canvasPoint)
        break
    }
  }

  /** Handle pointer up — commit the active selection tool. */
  handlePointerUp() {
    switch (this.activeSubTool) {
      case 'rectangle':
        this.rectangleTool.commit(this.manager, this.selectionMode, this.isConstrained)
        break
      case 'ellipse':
        this.ellipseTool.commit(this.manager, this.selectionMode, this.isConstrained)
        break
      case 'freehand':
        this.freehandTool.commit(this.manager, this.selectionMode)
        break
    }
  }

  /**
   * Execute magic wand at a point (single-click action).
   * Requires the RGBA pixel data from the active layer.
   */
  executeMagicWand(point: Point, pixels: Uint8Array | Uint8ClampedArray) {
    this.magicWandTool.select(
      Math.floor(point.x),
      Math.floor(point.y),
      pixels,
      this.manager,
      this.selectionMode,
    )
  }

  // ── Selection actions ─────────────────────────────────────────────

  selectAll() {
    this.manager.selectAll()
  }

  deselect() {
    this.manager.clearSelection()
  }

  invertSelection() {
    this.manager.invertSelection()
  }

  feather(radius: number) {
    this.manager.feather({ radius })
  }

  // ── Preview rendering ─────────────────────────────────────────────

  /**
   * Draw the current tool preview and marching ants on the overlay canvas.
   * Call this in the overlay render loop.
   *
   * @param ctx The overlay 2D context
   * @param zoom Current view zoom level
   */
  drawOverlay(ctx: CanvasRenderingContext2D, zoom: number) {
    // Draw marching ants for existing selection
    this.marchingAnts.advance()
    this.marchingAnts.draw(ctx, this.boundarySegments, zoom)

    // Draw tool preview
    this.drawToolPreview(ctx, zoom)
  }

  /** Check if there's currently an active (in-progress) tool operation. */
  isToolActive(): boolean {
    return (
      this.rectangleTool.isActive() ||
      this.ellipseTool.isActive() ||
      this.freehandTool.isActive()
    )
  }

  /** Whether the selection mask has any selected pixels. */
  hasSelection(): boolean {
    return this.manager.hasSelection()
  }

  // ── Internal ──────────────────────────────────────────────────────

  private cancelActiveTool() {
    this.rectangleTool.cancel()
    this.ellipseTool.cancel()
    this.freehandTool.cancel()
  }

  private updateBoundary() {
    this.boundarySegments = this.manager.extractBoundary()
  }

  private drawToolPreview(ctx: CanvasRenderingContext2D, zoom: number) {
    const lineWidth = 1 / zoom

    if (this.rectangleTool.isActive()) {
      const rect = this.rectangleTool.getPreviewRect(this.isConstrained)
      if (rect) {
        ctx.save()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
        ctx.lineWidth = lineWidth
        ctx.setLineDash([4 / zoom, 4 / zoom])
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
        ctx.restore()
      }
    }

    if (this.ellipseTool.isActive()) {
      const ellipse = this.ellipseTool.getPreviewEllipse(this.isConstrained)
      if (ellipse) {
        ctx.save()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
        ctx.lineWidth = lineWidth
        ctx.setLineDash([4 / zoom, 4 / zoom])
        ctx.beginPath()
        ctx.ellipse(ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }

    if (this.freehandTool.isActive()) {
      const points = this.freehandTool.getPoints()
      if (points.length >= 2) {
        ctx.save()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
        ctx.lineWidth = lineWidth
        ctx.setLineDash([4 / zoom, 4 / zoom])
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        // Draw closing line back to start
        ctx.lineTo(points[0].x, points[0].y)
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  destroy() {
    this.marchingAnts.destroy()
    this.cancelActiveTool()
  }
}
