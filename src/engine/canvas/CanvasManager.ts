import { type Application, Texture, Sprite, Container, RenderTexture } from 'pixi.js'
import { ViewTransform } from './ViewTransform.ts'
import { InputManager } from '../input/InputManager.ts'
import { BrushEngine } from '../brush/BrushEngine.ts'
import { LayerManager, type LayerChangeCallback } from '../layers/LayerManager.ts'
import { LayerCompositor } from '../layers/LayerCompositor.ts'
import { SelectionController } from '../selection/SelectionController.ts'
import { TransformManager } from '../transform/TransformManager.ts'
import { FilterManager } from '../filters/FilterManager.ts'
import { FloodFillTool } from '../tools/FloodFillTool.ts'
import { EyedropperTool } from '../tools/EyedropperTool.ts'
import { createRenderer } from '../renderer.ts'
import type { ViewState, PointerState, ToolType } from '../../types/engine.ts'
import type { StrokePoint } from '../../types/brush.ts'
import type { FilterParams } from '../../types/filter.ts'
import type { LayerSnapshot, LayerUndoEntry } from '../undo/UndoManager.ts'
import type { SelectionToolType, SelectionMode, BoundingBox } from '../../types/selection.ts'
import type { SelectionUndoEntry } from '../undo/UndoManager.ts'
import type { RGBAColor } from '../../types/color.ts'

/**
 * Manages the two-canvas architecture:
 *   1. Static canvas — PixiJS Application (artwork rendering)
 *   2. Interactive canvas — HTML overlay (cursor, selection, guides)
 *
 * Owns ViewTransform, InputManager, BrushEngine, LayerManager, LayerCompositor,
 * SelectionController, TransformManager.
 * No React.
 */
export class CanvasManager {
  private app: Application | null = null
  private staticCanvas: HTMLCanvasElement | null = null
  private overlayCanvas: HTMLCanvasElement | null = null
  private overlayCtx: CanvasRenderingContext2D | null = null
  private destroyed = false
  private activeTool: ToolType = 'brush'
  private overlayRafId: number | null = null
  private pendingSelectionSnapshot: Uint8Array | null = null

  readonly viewTransform = new ViewTransform()
  readonly inputManager = new InputManager(this.viewTransform)
  readonly brushEngine = new BrushEngine()
  readonly layerManager = new LayerManager()
  readonly compositor = new LayerCompositor()
  readonly selectionController: SelectionController
  readonly transformManager = new TransformManager()
  readonly filterManager = new FilterManager()
  readonly floodFillTool = new FloodFillTool()
  readonly eyedropperTool = new EyedropperTool()

  private onColorSampled: ((color: RGBAColor) => void) | null = null
  private resizeObserver: ResizeObserver | null = null
  private container: HTMLElement | null = null

  constructor() {
    // Initialize SelectionController with a default canvas size (resized later)
    this.selectionController = new SelectionController(1024, 768)
  }

  /**
   * Initialize PixiJS on the static canvas and set up the overlay.
   * The container should be a positioned element that holds both canvases.
   */
  async init(container: HTMLElement): Promise<void> {
    this.container = container

    // Create static canvas (PixiJS)
    this.staticCanvas = document.createElement('canvas')
    this.staticCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
    container.appendChild(this.staticCanvas)

    // Create overlay canvas (interactive)
    this.overlayCanvas = document.createElement('canvas')
    this.overlayCanvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:auto;'
    container.appendChild(this.overlayCanvas)
    this.overlayCtx = this.overlayCanvas.getContext('2d', { desynchronized: true })

    // Initialize PixiJS renderer (async — check for destroy after await)
    this.app = await createRenderer(this.staticCanvas)

    // Guard: if destroy() was called while we were awaiting, bail out
    if (this.destroyed) return

    // Attach input to overlay (captures all pointer events)
    this.inputManager.attach(this.overlayCanvas)

    const w = container.clientWidth || 1024
    const h = container.clientHeight || 768

    // Initialize LayerManager
    this.layerManager.setApp(this.app)
    this.layerManager.setSize(w, h)
    this.layerManager.init()

    // Initialize LayerCompositor
    this.compositor.setApp(this.app)
    this.compositor.setSize(w, h)

    // Add compositor output to stage
    const outputSprite = this.compositor.getOutputSprite()
    if (outputSprite) {
      this.app.stage.addChild(outputSprite)
    }

    // Wire brush engine
    this.brushEngine.setApp(this.app)
    this.syncBrushToActiveLayer()

    // Wire filter manager
    this.filterManager.setApp(this.app)

    // Wire selection controller to overlay
    if (this.overlayCtx) {
      this.selectionController.setOverlayCtx(this.overlayCtx)
    }
    this.selectionController.resize(w, h)

    // Wire input to tool routing
    this.inputManager.setStrokeCallbacks({
      onPointerDown: (ps) => this.handlePointerDown(ps),
      onPointerMove: (ps, coalesced, _predicted) => this.handlePointerMove(ps, coalesced),
      onPointerUp: (ps) => this.handlePointerUp(ps),
    })

    // Start overlay render loop (marching ants, tool previews)
    this.startOverlayLoop()

    // Watch for view transform changes to update PixiJS stage
    this.viewTransform.setChangeCallback(this.applyViewTransform)

    // Handle container resize
    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.resizeObserver.observe(container)
    this.syncSize()

    // Initial composite
    this.recomposite()
  }

  /** Set callback for layer changes (wires to React store). */
  setLayerChangeCallback(cb: LayerChangeCallback) {
    this.layerManager.setChangeCallback(cb)
  }

  getPixiApp(): Application | null {
    return this.app
  }

  getOverlayCtx(): CanvasRenderingContext2D | null {
    return this.overlayCtx
  }

  /** Recomposite all layers and display the result. */
  recomposite() {
    this.compositor.composite(this.layerManager.getLayers())
  }

  /** Sync brush engine to current active layer. */
  syncBrushToActiveLayer() {
    const layer = this.layerManager.getActiveLayer()
    if (layer) {
      this.brushEngine.setActiveLayerTexture(layer.texture)
      this.brushEngine.setActiveLayerId(layer.info.id)
      this.brushEngine.setAlphaLock(layer.info.alphaLock)
    }
  }

  /** Undo the last operation (layer stroke or selection change). */
  performUndo(): boolean {
    const entry = this.brushEngine.undoManager.undo()
    if (!entry) return false

    if (entry.type === 'selection') {
      this.selectionController.manager.restoreSnapshot(entry.before)
      return true
    }

    const layer = this.layerManager.getLayerById(entry.layerId)
    if (!layer) return false

    this.restoreLayerSnapshot(layer.texture, entry.before)
    this.recomposite()
    this.layerManager.updateThumbnails()
    return true
  }

  /** Redo the last undone operation (layer stroke or selection change). */
  performRedo(): boolean {
    const entry = this.brushEngine.undoManager.redo()
    if (!entry) return false

    if (entry.type === 'selection') {
      this.selectionController.manager.restoreSnapshot(entry.after)
      return true
    }

    const layer = this.layerManager.getLayerById(entry.layerId)
    if (!layer) return false

    this.restoreLayerSnapshot(layer.texture, entry.after)
    this.recomposite()
    this.layerManager.updateThumbnails()
    return true
  }

  /**
   * Restore a full layer snapshot to a RenderTexture.
   * Creates a canvas from the pixel data and renders it with clear:true
   * to completely replace the texture contents.
   */
  private restoreLayerSnapshot(layerTexture: RenderTexture, snapshot: LayerSnapshot) {
    if (!this.app) return

    const { width: w, height: h, data } = snapshot
    if (w <= 0 || h <= 0) return

    const expectedLen = w * h * 4
    if (data.length < expectedLen) return

    // Create a canvas with the snapshot pixel data
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    const imageData = new ImageData(
      new Uint8ClampedArray(data.buffer, data.byteOffset, expectedLen),
      w,
      h,
    )
    ctx.putImageData(imageData, 0, 0)

    // Create texture from canvas and render to the layer with clear:true
    // This completely replaces the layer contents
    const tex = Texture.from(canvas)
    const sprite = new Sprite(tex)
    this.app.renderer.render({
      container: sprite,
      target: layerTexture,
      clear: true,
    })
    tex.destroy(true)
  }

  // ── Tool state management ─────────────────────────────────────────

  /** Set the active tool (called from React when toolStore changes). */
  setActiveTool(tool: ToolType) {
    this.activeTool = tool
  }

  /** Set the selection sub-tool type. */
  setSelectionSubTool(subTool: SelectionToolType) {
    this.selectionController.setSubTool(subTool)
  }

  /** Set the selection combination mode. */
  setSelectionMode(mode: SelectionMode) {
    this.selectionController.setSelectionMode(mode)
  }

  /** Set selection change callback (for syncing to Zustand store). */
  setSelectionChangeCallback(cb: (hasSelection: boolean, bounds: BoundingBox | null) => void) {
    this.selectionController.setSelectionChangeCallback(cb)
  }

  /** Update constrain modifier state. */
  setSelectionConstrained(constrained: boolean) {
    this.selectionController.setConstrained(constrained)
  }

  // ── Selection actions ─────────────────────────────────────────────

  selectAll() {
    this.snapshotSelectionBefore()
    this.selectionController.selectAll()
    this.commitSelectionUndo()
  }

  deselectAll() {
    this.snapshotSelectionBefore()
    this.selectionController.deselect()
    this.commitSelectionUndo()
  }

  invertSelection() {
    this.snapshotSelectionBefore()
    this.selectionController.invertSelection()
    this.commitSelectionUndo()
  }

  // ── Filter preview system ────────────────────────────────────────

  /** Begin a non-destructive filter preview on the active layer. */
  beginFilterPreview(): void {
    if (!this.app) return
    const layer = this.layerManager.getActiveLayer()
    if (!layer) return

    const extracted = this.app.renderer.extract.pixels({ target: layer.texture })
    const snapshot: LayerSnapshot = {
      width: extracted.width,
      height: extracted.height,
      data: new Uint8Array(extracted.pixels.buffer, extracted.pixels.byteOffset, extracted.pixels.byteLength),
    }

    const mask = this.selectionController.manager.hasSelection()
      ? this.selectionController.manager.getMask()
      : null

    const w = this.container?.clientWidth || 1024
    const h = this.container?.clientHeight || 768

    this.filterManager.beginPreview(layer.texture, layer.info.id, snapshot, mask, w, h)
  }

  /** Update the filter preview with new parameters. */
  updateFilterPreview(params: FilterParams): void {
    this.filterManager.updatePreview(params)
    this.recomposite()
  }

  /** Apply the current filter and push undo entry. */
  applyFilter(): void {
    const result = this.filterManager.apply()
    if (result) {
      const entry: LayerUndoEntry = {
        type: 'layer',
        layerId: result.layerId,
        before: result.before,
        after: result.after,
      }
      this.brushEngine.undoManager.pushEntry(entry)
      this.recomposite()
      this.layerManager.updateThumbnails()
    }
  }

  /** Cancel the current filter and restore the original layer. */
  cancelFilter(): void {
    this.filterManager.cancel()
    this.recomposite()
  }

  // ── Flood fill & Eyedropper ─────────────────────────────────────

  /** Set callback for color sampling (eyedropper). */
  setColorSampledCallback(cb: (color: RGBAColor) => void): void {
    this.onColorSampled = cb
  }

  private handleFloodFill(canvasPoint: { x: number; y: number }): void {
    if (!this.app) return
    const layer = this.layerManager.getActiveLayer()
    if (!layer) return

    // Extract current pixel data
    const extracted = this.app.renderer.extract.pixels({ target: layer.texture })
    const pixels = new Uint8Array(extracted.pixels.buffer, extracted.pixels.byteOffset, extracted.pixels.byteLength)

    // Snapshot before
    const before: LayerSnapshot = {
      width: extracted.width,
      height: extracted.height,
      data: new Uint8Array(pixels),
    }

    // Get fill color from brush engine
    const fillColor = this.brushEngine.getColor()
    const tolerance = this.fillTolerance

    // Get selection mask if any
    const mask = this.selectionController.manager.hasSelection()
      ? this.selectionController.manager.getMask()
      : null

    const modified = this.floodFillTool.fill(
      canvasPoint.x,
      canvasPoint.y,
      pixels,
      extracted.width,
      extracted.height,
      fillColor,
      tolerance,
      mask,
    )

    if (!modified) return

    // Write pixels back to texture
    const after: LayerSnapshot = {
      width: extracted.width,
      height: extracted.height,
      data: new Uint8Array(pixels),
    }
    this.restoreLayerSnapshot(layer.texture, after)

    // Push undo
    const entry: LayerUndoEntry = {
      type: 'layer',
      layerId: layer.info.id,
      before,
      after,
    }
    this.brushEngine.undoManager.pushEntry(entry)

    this.recomposite()
    this.layerManager.updateThumbnails()
  }

  private handleEyedropper(canvasPoint: { x: number; y: number }): void {
    if (!this.app) return

    // Sample from composited output (all layers)
    const outputTexture = this.compositor.getOutputTexture()
    if (!outputTexture) return

    const extracted = this.app.renderer.extract.pixels({ target: outputTexture })
    const pixels = new Uint8Array(extracted.pixels.buffer, extracted.pixels.byteOffset, extracted.pixels.byteLength)

    const color = this.eyedropperTool.sample(
      canvasPoint.x,
      canvasPoint.y,
      pixels,
      extracted.width,
      extracted.height,
    )

    if (color && this.onColorSampled) {
      this.onColorSampled(color)
    }
  }

  /** Fill tolerance (0-255), set from React via toolStore. */
  private fillTolerance = 32

  setFillTolerance(tolerance: number): void {
    this.fillTolerance = Math.max(0, Math.min(255, tolerance))
  }

  // ── Pointer event routing ─────────────────────────────────────────

  /** Snapshot selection mask before a selection operation, for undo. */
  private snapshotSelectionBefore() {
    this.pendingSelectionSnapshot = this.selectionController.manager.snapshot()
  }

  /** Commit a selection undo entry with the after snapshot. */
  private commitSelectionUndo() {
    if (!this.pendingSelectionSnapshot) return
    const after = this.selectionController.manager.snapshot()
    const entry: SelectionUndoEntry = {
      type: 'selection',
      before: this.pendingSelectionSnapshot,
      after,
    }
    this.brushEngine.undoManager.pushEntry(entry)
    this.pendingSelectionSnapshot = null
  }

  private handlePointerDown(ps: PointerState) {
    const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)

    if (this.activeTool === 'fill') {
      this.handleFloodFill(canvasPoint)
      return
    }

    if (this.activeTool === 'eyedropper') {
      this.handleEyedropper(canvasPoint)
      return
    }

    if (this.activeTool === 'selection') {
      this.snapshotSelectionBefore()
      const subTool = this.selectionController.getSubTool()
      if (subTool === 'magicWand') {
        this.handleMagicWandClick(canvasPoint)
        this.commitSelectionUndo()
      } else {
        this.selectionController.handlePointerDown(canvasPoint)
      }
      return
    }

    if (this.activeTool === 'brush' || this.activeTool === 'eraser') {
      this.handleStrokeStart(ps)
      return
    }
  }

  private handlePointerMove(ps: PointerState, coalesced: PointerState[]) {
    if (this.activeTool === 'selection') {
      const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)
      this.selectionController.handlePointerMove(canvasPoint)
      return
    }

    if (this.activeTool === 'brush' || this.activeTool === 'eraser') {
      this.handleStrokeMove(ps, coalesced)
      return
    }
  }

  private handlePointerUp(ps: PointerState) {
    if (this.activeTool === 'selection') {
      this.selectionController.handlePointerUp()
      this.commitSelectionUndo()
      return
    }

    if (this.activeTool === 'brush' || this.activeTool === 'eraser') {
      this.handleStrokeEnd()
      return
    }
  }

  private handleMagicWandClick(canvasPoint: { x: number; y: number }) {
    if (!this.app) return
    const layer = this.layerManager.getActiveLayer()
    if (!layer) return

    // Extract pixel data from the active layer
    const extracted = this.app.renderer.extract.pixels({ target: layer.texture })
    const pixels = new Uint8Array(
      extracted.pixels.buffer,
      extracted.pixels.byteOffset,
      extracted.pixels.byteLength,
    )
    this.selectionController.executeMagicWand(canvasPoint, pixels)
  }

  // ── Overlay render loop ───────────────────────────────────────────

  private startOverlayLoop() {
    const loop = () => {
      this.renderOverlay()
      this.overlayRafId = requestAnimationFrame(loop)
    }
    this.overlayRafId = requestAnimationFrame(loop)
  }

  private renderOverlay() {
    if (!this.overlayCtx || !this.overlayCanvas) return
    const ctx = this.overlayCtx
    const w = this.overlayCanvas.width
    const h = this.overlayCanvas.height

    ctx.clearRect(0, 0, w, h)

    // Apply view transform to overlay context for canvas-space drawing
    const view = this.viewTransform.getState()
    ctx.save()
    ctx.translate(view.x, view.y)
    ctx.scale(view.zoom, view.zoom)
    ctx.rotate(view.rotation)

    // Draw selection overlay (marching ants + tool preview)
    this.selectionController.drawOverlay(ctx, view.zoom)

    ctx.restore()
  }

  // ── Stroke handlers (brush/eraser) ────────────────────────────────

  private handleStrokeStart(ps: PointerState) {
    this.syncBrushToActiveLayer()
    const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)
    const strokePoint: StrokePoint = {
      x: canvasPoint.x,
      y: canvasPoint.y,
      pressure: ps.pressure || 0.5,
      tiltX: ps.tiltX,
      tiltY: ps.tiltY,
      timestamp: performance.now(),
    }
    this.brushEngine.beginStroke(strokePoint)
  }

  private handleStrokeMove(ps: PointerState, coalesced: PointerState[]) {
    const points: StrokePoint[] = coalesced.length > 0
      ? coalesced.map((c) => {
          const cp = this.viewTransform.screenToCanvas(c.x, c.y)
          return {
            x: cp.x,
            y: cp.y,
            pressure: c.pressure || 0.5,
            tiltX: c.tiltX,
            tiltY: c.tiltY,
            timestamp: performance.now(),
          }
        })
      : [{
          ...this.viewTransform.screenToCanvas(ps.x, ps.y),
          pressure: ps.pressure || 0.5,
          tiltX: ps.tiltX,
          tiltY: ps.tiltY,
          timestamp: performance.now(),
        }]

    this.brushEngine.continueStroke(points)
  }

  private handleStrokeEnd() {
    this.brushEngine.endStroke()
    // Recomposite after stroke completion
    this.recomposite()
    // Update layer thumbnails for the panel
    this.layerManager.updateThumbnails()
  }

  private applyViewTransform = (state: ViewState) => {
    if (!this.app) return
    const stage = this.app.stage
    stage.position.set(state.x, state.y)
    stage.scale.set(state.zoom)
    stage.rotation = state.rotation
  }

  private handleResize = () => {
    this.syncSize()
  }

  private syncSize() {
    if (!this.container || !this.app) return
    const { clientWidth: w, clientHeight: h } = this.container
    const dpr = window.devicePixelRatio || 1

    // Resize PixiJS renderer
    this.app.renderer.resize(w, h, dpr)

    // Resize overlay canvas
    if (this.overlayCanvas) {
      this.overlayCanvas.width = w * dpr
      this.overlayCanvas.height = h * dpr
      if (this.overlayCtx) {
        this.overlayCtx.scale(dpr, dpr)
      }
    }
  }

  destroy() {
    this.destroyed = true
    this.inputManager.detach()
    this.resizeObserver?.disconnect()

    if (this.overlayRafId !== null) {
      cancelAnimationFrame(this.overlayRafId)
      this.overlayRafId = null
    }

    this.selectionController.destroy()
    this.filterManager.destroy()
    this.layerManager.destroy()
    this.compositor.destroy()

    if (this.app) {
      this.app.destroy(true)
      this.app = null
    }

    if (this.staticCanvas?.parentNode) {
      this.staticCanvas.parentNode.removeChild(this.staticCanvas)
    }
    if (this.overlayCanvas?.parentNode) {
      this.overlayCanvas.parentNode.removeChild(this.overlayCanvas)
    }

    this.staticCanvas = null
    this.overlayCanvas = null
    this.overlayCtx = null
    this.container = null
  }
}
