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
import { GuideManager } from '../guides/GuideManager.ts'
import { SymmetryEngine } from '../guides/SymmetryEngine.ts'
import { QuickShape, type DetectedShape } from '../tools/QuickShape.ts'
import { TextTool } from '../tools/TextTool.ts'
import { TimelapseRecorder } from '../timelapse/TimelapseRecorder.ts'
import { createRenderer } from '../renderer.ts'
import type { ViewState, PointerState, ToolType } from '../../types/engine.ts'
import type { StrokePoint } from '../../types/brush.ts'
import type { FilterParams } from '../../types/filter.ts'
import type { LayerSnapshot, LayerUndoEntry } from '../undo/UndoManager.ts'
import type { SelectionToolType, SelectionMode, BoundingBox } from '../../types/selection.ts'
import type { SelectionUndoEntry } from '../undo/UndoManager.ts'
import type { RGBAColor } from '../../types/color.ts'
import type { TextProperties } from '../../types/text.ts'

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
  private compositeScheduled = false
  private compositeRafId: number | null = null

  /** VP dragging state for perspective guides */
  private draggingVP: number | null = null

  /** Symmetry center dragging state */
  private draggingSymmetryCenter = false

  /** QuickShape hold timer state */
  private quickShapeHoldTimer: ReturnType<typeof setTimeout> | null = null
  private quickShapeHoldDetected = false

  /** Hand tool (pan) state */
  private handPanState: { lastX: number; lastY: number } | null = null

  /** Layer move tool state */
  private layerMoveState: {
    startCanvasX: number
    startCanvasY: number
    beforeSnapshot: LayerSnapshot
    tempSprite: Sprite
    tempTexture: Texture
    layerId: string
  } | null = null

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
  readonly guideManager = new GuideManager()
  readonly symmetryEngine = new SymmetryEngine()
  readonly quickShape = new QuickShape()
  readonly textTool = new TextTool()
  readonly timelapseRecorder = new TimelapseRecorder()

  private onColorSampled: ((color: RGBAColor) => void) | null = null
  private onViewChange: ((state: ViewState) => void) | null = null
  private onTextInput: ((screenX: number, screenY: number, canvasX: number, canvasY: number) => void) | null = null
  private onSymmetryCenterChanged: ((cx: number, cy: number) => void) | null = null
  private resizeObserver: ResizeObserver | null = null
  private container: HTMLElement | null = null

  private documentWidth = 1024
  private documentHeight = 768

  constructor() {
    // Initialize SelectionController with a default canvas size (resized later)
    this.selectionController = new SelectionController(1024, 768)
    // Wire symmetry engine to brush engine
    this.brushEngine.symmetryEngine = this.symmetryEngine
  }

  /**
   * Initialize PixiJS on the static canvas and set up the overlay.
   * The container should be a positioned element that holds both canvases.
   * docWidth/docHeight set the artwork resolution (layer & compositor textures).
   */
  async init(container: HTMLElement, docWidth?: number, docHeight?: number): Promise<void> {
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

    // Use document dimensions for artwork textures, viewport for renderer
    const artW = docWidth || container.clientWidth || 1024
    const artH = docHeight || container.clientHeight || 768
    this.documentWidth = artW
    this.documentHeight = artH

    // Initialize LayerManager
    this.layerManager.setApp(this.app)
    this.layerManager.setSize(artW, artH)
    this.layerManager.init()

    // Initialize LayerCompositor
    this.compositor.setApp(this.app)
    this.compositor.setSize(artW, artH)

    // Invalidate compositor cache on any structural layer change
    this.layerManager.setStructuralChangeCallback(() => {
      this.compositor.invalidateCache()
    })

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
    this.selectionController.resize(artW, artH)

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

  /** Schedule a composite for the next animation frame (batches multiple calls). */
  private scheduleComposite() {
    if (this.compositeScheduled) return
    this.compositeScheduled = true
    this.compositeRafId = requestAnimationFrame(() => {
      this.compositeScheduled = false
      this.compositeRafId = null
      this.recomposite()
    })
  }

  /** Flush any pending RAF-batched composite immediately. */
  private flushComposite() {
    if (this.compositeScheduled) {
      if (this.compositeRafId !== null) {
        cancelAnimationFrame(this.compositeRafId)
        this.compositeRafId = null
      }
      this.compositeScheduled = false
      this.recomposite()
    }
  }

  /** Sync brush engine to current active layer. */
  syncBrushToActiveLayer() {
    const layer = this.layerManager.getActiveLayer()
    if (layer) {
      this.brushEngine.setActiveLayerTexture(layer.texture)
      this.brushEngine.setActiveLayerId(layer.info.id)
      this.brushEngine.setAlphaLock(layer.info.alphaLock)
      this.compositor.setActiveLayerId(layer.info.id)
    }
  }

  /** Undo the last operation (layer stroke or selection change). */
  async performUndo(): Promise<boolean> {
    const entry = await this.brushEngine.undoManager.undo()
    if (!entry) return false

    this.brushEngine.clearSnapshotCache()

    if (entry.type === 'selection') {
      this.selectionController.manager.restoreSnapshot(entry.before)
      return true
    }

    const layer = this.layerManager.getLayerById(entry.layerId)
    if (!layer) return false

    this.restoreLayerSnapshot(layer.texture, entry.before)
    this.compositor.invalidateCache()
    this.recomposite()
    this.layerManager.updateThumbnails()
    return true
  }

  /** Redo the last undone operation (layer stroke or selection change). */
  async performRedo(): Promise<boolean> {
    const entry = await this.brushEngine.undoManager.redo()
    if (!entry) return false

    this.brushEngine.clearSnapshotCache()

    if (entry.type === 'selection') {
      this.selectionController.manager.restoreSnapshot(entry.after)
      return true
    }

    const layer = this.layerManager.getLayerById(entry.layerId)
    if (!layer) return false

    this.restoreLayerSnapshot(layer.texture, entry.after)
    this.compositor.invalidateCache()
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

  /** Set the document dimensions and resize all layer/compositor textures to match. */
  setDocumentSize(width: number, height: number) {
    this.documentWidth = width
    this.documentHeight = height

    // Update symmetry center to document center by default
    this.symmetryEngine.centerX = width / 2
    this.symmetryEngine.centerY = height / 2
    this.guideManager.symmetryCenterX = width / 2
    this.guideManager.symmetryCenterY = height / 2

    // Resize layer textures and compositor to document dimensions
    if (this.app) {
      this.layerManager.resizeAllLayers(width, height)
      this.compositor.setSize(width, height)
      this.selectionController.resize(width, height)
      this.syncBrushToActiveLayer()
      this.recomposite()
    }
  }

  /** Fit document into the viewport, centering with padding. */
  fitToDocument() {
    if (!this.container) return
    const { clientWidth: vw, clientHeight: vh } = this.container
    this.viewTransform.fitToDocument(this.documentWidth, this.documentHeight, vw, vh)
  }

  // ── Image import ──────────────────────────────────────────────────

  /**
   * Import an image (from clipboard paste, file, or drag-and-drop) into a new layer.
   * The image is drawn centered on the document at its native size (clamped to doc bounds).
   * Returns the new layer name, or null on failure.
   */
  importImageToNewLayer(pixels: Uint8ClampedArray, imgW: number, imgH: number, name?: string): string | null {
    if (!this.app) return null
    this.brushEngine.clearSnapshotCache()

    // Create a new layer for the imported image
    const layerId = this.layerManager.createLayer(name ?? 'Imported Image')
    if (!layerId) return null

    this.layerManager.setActiveLayer(layerId)
    const layer = this.layerManager.getLayerById(layerId)
    if (!layer) return null

    // Build a canvas with the image composited onto a doc-sized transparent background
    const docW = this.documentWidth
    const docH = this.documentHeight
    const canvas = document.createElement('canvas')
    canvas.width = docW
    canvas.height = docH
    const ctx = canvas.getContext('2d')!

    // Draw the imported image centered, scaled to fit if larger than document
    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = imgW
    srcCanvas.height = imgH
    const srcCtx = srcCanvas.getContext('2d')!
    srcCtx.putImageData(new ImageData(pixels, imgW, imgH), 0, 0)

    // Scale down to fit within document bounds (maintain aspect ratio)
    let drawW = imgW
    let drawH = imgH
    if (imgW > docW || imgH > docH) {
      const scale = Math.min(docW / imgW, docH / imgH)
      drawW = Math.round(imgW * scale)
      drawH = Math.round(imgH * scale)
    }
    const drawX = Math.round((docW - drawW) / 2)
    const drawY = Math.round((docH - drawH) / 2)
    ctx.drawImage(srcCanvas, 0, 0, imgW, imgH, drawX, drawY, drawW, drawH)

    // Extract the composited data as a snapshot
    const resultData = ctx.getImageData(0, 0, docW, docH)
    const snapshot: LayerSnapshot = {
      width: docW,
      height: docH,
      data: new Uint8Array(resultData.data.buffer),
    }

    // Write to the layer texture
    this.restoreLayerSnapshot(layer.texture, snapshot)
    this.recomposite()
    this.layerManager.updateThumbnails()

    // Push undo entry (before = blank layer, after = imported image)
    const blankData = new Uint8Array(docW * docH * 4) // all zeros = transparent
    const undoEntry: LayerUndoEntry = {
      type: 'layer',
      layerId,
      before: { width: docW, height: docH, data: blankData },
      after: snapshot,
    }
    this.brushEngine.undoManager.pushEntry(undoEntry)

    return layer.info.name
  }

  // ── Tool state management ─────────────────────────────────────────

  /** Set the active tool (called from React when toolStore changes). */
  setActiveTool(tool: ToolType) {
    this.activeTool = tool
    // Update cursor based on tool
    if (this.overlayCanvas) {
      if (tool === 'move') {
        this.overlayCanvas.style.cursor = 'grab'
      } else if (tool === 'transform') {
        this.overlayCanvas.style.cursor = 'move'
      } else if (tool === 'text') {
        this.overlayCanvas.style.cursor = 'text'
      } else {
        this.overlayCanvas.style.cursor = ''
      }
    }
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

  /** Clear the active layer to transparent. */
  clearActiveLayer(): void {
    if (!this.app) return
    const layer = this.layerManager.getActiveLayer()
    if (!layer) return

    // Snapshot before
    const extracted = this.app.renderer.extract.pixels({ target: layer.texture })
    const before: LayerSnapshot = {
      width: extracted.width,
      height: extracted.height,
      data: new Uint8Array(extracted.pixels.buffer, extracted.pixels.byteOffset, extracted.pixels.byteLength),
    }

    // Clear the layer
    const emptyContainer = new Container()
    this.app.renderer.render({ container: emptyContainer, target: layer.texture, clear: true })

    // Snapshot after
    const after: LayerSnapshot = {
      width: before.width,
      height: before.height,
      data: new Uint8Array(before.width * before.height * 4),
    }

    const entry: LayerUndoEntry = {
      type: 'layer',
      layerId: layer.info.id,
      before,
      after,
    }
    this.brushEngine.undoManager.pushEntry(entry)
    this.brushEngine.clearSnapshotCache()
    this.compositor.invalidateCache()
    this.recomposite()
    this.layerManager.updateThumbnails()
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

    // Use actual layer texture dimensions (not viewport size) for correct filter resolution
    const w = layer.texture.width
    const h = layer.texture.height

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
      this.captureTimelapseFrame()
    }
  }

  /** Cancel the current filter and restore the original layer. */
  cancelFilter(): void {
    this.filterManager.cancel()
    this.recomposite()
  }

  // ── Flood fill & Eyedropper ─────────────────────────────────────

  /** Set callback for view transform changes (zoom, pan, rotation). */
  setViewChangeCallback(cb: (state: ViewState) => void): void {
    this.onViewChange = cb
    // Emit current state immediately so caller has initial value
    cb(this.viewTransform.getState())
  }

  /** Set callback for color sampling (eyedropper). */
  setColorSampledCallback(cb: (color: RGBAColor) => void): void {
    this.onColorSampled = cb
  }

  /** Set callback for text input (opens the React TextInputOverlay). */
  setTextInputCallback(cb: (screenX: number, screenY: number, canvasX: number, canvasY: number) => void): void {
    this.onTextInput = cb
  }

  /** Set callback for symmetry center changes (dragging the center handle). */
  setSymmetryCenterChangedCallback(cb: (cx: number, cy: number) => void): void {
    this.onSymmetryCenterChanged = cb
  }

  /** Rasterize text at a position and import as a new layer. */
  commitText(text: string, props: TextProperties, canvasX: number, canvasY: number): void {
    const result = this.textTool.rasterize(text, props, canvasX, canvasY, this.documentWidth, this.documentHeight)
    if (!result) return
    this.importImageToNewLayer(result.pixels, result.width, result.height, `Text: ${text.slice(0, 20)}`)
    this.captureTimelapseFrame()
  }

  /** Capture a timelapse frame from the current composite output. */
  captureTimelapseFrame(): void {
    if (this.timelapseRecorder.getState() !== 'recording') return
    const result = this.getCompositePixels()
    if (result) {
      this.timelapseRecorder.captureFrame(result.pixels, result.width, result.height)
    }
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
    this.captureTimelapseFrame()
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

  /** Extract composite pixel data (all visible layers) for export. */
  getCompositePixels(): { pixels: Uint8ClampedArray; width: number; height: number } | null {
    if (!this.app) return null
    // Force a full N-layer composite for accuracy (bypass cache fast path)
    this.compositor.invalidateCache()
    this.recomposite()
    const outputTexture = this.compositor.getOutputTexture()
    if (!outputTexture) return null
    const extracted = this.app.renderer.extract.pixels({ target: outputTexture })
    return {
      pixels: new Uint8ClampedArray(
        extracted.pixels.buffer,
        extracted.pixels.byteOffset,
        extracted.pixels.byteLength,
      ),
      width: extracted.width,
      height: extracted.height,
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

    // VP handle dragging (before tool routing)
    if (this.guideManager.perspectiveEnabled) {
      const vpIdx = this.guideManager.hitTestVP(canvasPoint.x, canvasPoint.y, this.viewTransform.getState().zoom)
      if (vpIdx >= 0) {
        this.draggingVP = vpIdx
        return
      }
    }

    // Symmetry center handle dragging (before tool routing)
    if (this.guideManager.hitTestSymmetryCenter(canvasPoint.x, canvasPoint.y, this.viewTransform.getState().zoom)) {
      this.draggingSymmetryCenter = true
      return
    }

    if (this.activeTool === 'move') {
      this.handPanState = { lastX: ps.x, lastY: ps.y }
      if (this.overlayCanvas) this.overlayCanvas.style.cursor = 'grabbing'
      return
    }

    if (this.activeTool === 'transform') {
      this.startLayerMove(ps)
      return
    }

    if (this.activeTool === 'fill') {
      this.handleFloodFill(canvasPoint)
      return
    }

    if (this.activeTool === 'eyedropper') {
      this.handleEyedropper(canvasPoint)
      return
    }

    if (this.activeTool === 'text') {
      this.onTextInput?.(ps.x, ps.y, canvasPoint.x, canvasPoint.y)
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
      this.quickShapeHoldDetected = false
      this.handleStrokeStart(ps)
      return
    }
  }

  private handlePointerMove(ps: PointerState, coalesced: PointerState[]) {
    // VP handle dragging
    if (this.draggingVP !== null) {
      const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)
      const points = [...this.guideManager.vanishingPoints]
      points[this.draggingVP] = { x: canvasPoint.x, y: canvasPoint.y }
      this.guideManager.vanishingPoints = points
      return
    }

    // Symmetry center handle dragging
    if (this.draggingSymmetryCenter) {
      const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)
      this.guideManager.symmetryCenterX = canvasPoint.x
      this.guideManager.symmetryCenterY = canvasPoint.y
      this.symmetryEngine.centerX = canvasPoint.x
      this.symmetryEngine.centerY = canvasPoint.y
      return
    }

    if (this.activeTool === 'move' && this.handPanState) {
      const dx = ps.x - this.handPanState.lastX
      const dy = ps.y - this.handPanState.lastY
      this.handPanState.lastX = ps.x
      this.handPanState.lastY = ps.y
      this.viewTransform.pan(dx, dy)
      return
    }

    if (this.activeTool === 'transform' && this.layerMoveState) {
      this.updateLayerMove(ps)
      return
    }

    if (this.activeTool === 'selection') {
      const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)
      this.selectionController.handlePointerMove(canvasPoint)
      return
    }

    if (this.activeTool === 'brush' || this.activeTool === 'eraser') {
      this.handleStrokeMove(ps, coalesced)
      // Reset QuickShape hold timer on each move
      if (this.quickShapeEnabled) {
        if (this.quickShapeHoldTimer) clearTimeout(this.quickShapeHoldTimer)
        this.quickShapeHoldDetected = false
        this.quickShapeHoldTimer = setTimeout(() => {
          this.quickShapeHoldDetected = true
        }, 300)
      }
      return
    }
  }

  private handlePointerUp(ps: PointerState) {
    // VP handle dragging finish
    if (this.draggingVP !== null) {
      this.draggingVP = null
      return
    }

    // Symmetry center dragging finish — notify React to sync store
    if (this.draggingSymmetryCenter) {
      this.draggingSymmetryCenter = false
      this.onSymmetryCenterChanged?.(this.guideManager.symmetryCenterX, this.guideManager.symmetryCenterY)
      return
    }

    if (this.activeTool === 'move' && this.handPanState) {
      this.handPanState = null
      if (this.overlayCanvas) this.overlayCanvas.style.cursor = 'grab'
      return
    }

    if (this.activeTool === 'transform' && this.layerMoveState) {
      this.finishLayerMove()
      return
    }

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

  // ── Layer move tool ──────────────────────────────────────────────

  private startLayerMove(ps: PointerState) {
    if (!this.app) return
    const layer = this.layerManager.getActiveLayer()
    if (!layer) return

    const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)

    // Extract current pixel data for undo
    const extracted = this.app.renderer.extract.pixels({ target: layer.texture })
    const before: LayerSnapshot = {
      width: extracted.width,
      height: extracted.height,
      data: new Uint8Array(extracted.pixels.buffer, extracted.pixels.byteOffset, extracted.pixels.byteLength),
    }

    // Create a temporary canvas with the layer content
    const canvas = document.createElement('canvas')
    canvas.width = before.width
    canvas.height = before.height
    const ctx = canvas.getContext('2d')!
    const imageData = new ImageData(
      new Uint8ClampedArray(before.data.buffer, before.data.byteOffset, before.width * before.height * 4),
      before.width,
      before.height,
    )
    ctx.putImageData(imageData, 0, 0)

    const tempTexture = Texture.from(canvas)
    const tempSprite = new Sprite(tempTexture)

    this.layerMoveState = {
      startCanvasX: canvasPoint.x,
      startCanvasY: canvasPoint.y,
      beforeSnapshot: before,
      tempSprite,
      tempTexture,
      layerId: layer.info.id,
    }
  }

  private updateLayerMove(ps: PointerState) {
    if (!this.app || !this.layerMoveState) return
    const layer = this.layerManager.getLayerById(this.layerMoveState.layerId)
    if (!layer) return

    const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)
    const dx = canvasPoint.x - this.layerMoveState.startCanvasX
    const dy = canvasPoint.y - this.layerMoveState.startCanvasY

    // Position the temp sprite at the offset and render to layer texture
    this.layerMoveState.tempSprite.position.set(dx, dy)
    this.app.renderer.render({
      container: this.layerMoveState.tempSprite,
      target: layer.texture,
      clear: true,
    })

    this.scheduleComposite()
  }

  private finishLayerMove() {
    if (!this.app || !this.layerMoveState) return

    this.flushComposite()

    const layer = this.layerManager.getLayerById(this.layerMoveState.layerId)
    if (layer) {
      // Create after snapshot
      const extracted = this.app.renderer.extract.pixels({ target: layer.texture })
      const after: LayerSnapshot = {
        width: extracted.width,
        height: extracted.height,
        data: new Uint8Array(extracted.pixels.buffer, extracted.pixels.byteOffset, extracted.pixels.byteLength),
      }

      // Push undo entry
      const entry: LayerUndoEntry = {
        type: 'layer',
        layerId: this.layerMoveState.layerId,
        before: this.layerMoveState.beforeSnapshot,
        after,
      }
      this.brushEngine.undoManager.pushEntry(entry)

      this.recomposite()
      this.layerManager.updateThumbnails()
      this.captureTimelapseFrame()
    }

    // Cleanup
    this.layerMoveState.tempTexture.destroy(true)
    this.layerMoveState.tempSprite.destroy()
    this.layerMoveState = null
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
    const dpr = window.devicePixelRatio || 1
    const w = this.overlayCanvas.width / dpr
    const h = this.overlayCanvas.height / dpr

    ctx.clearRect(0, 0, w * dpr, h * dpr)

    // ── Draw pasteboard dimming using evenodd fill rule ──
    const view = this.viewTransform.getState()
    ctx.save()

    // Document rect in screen space
    const dx = view.x
    const dy = view.y
    const dw = this.documentWidth * view.zoom
    const dh = this.documentHeight * view.zoom

    // Full viewport rect (clockwise) + document cutout rect (counter-clockwise)
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.moveTo(dx + dw, dy)
    ctx.lineTo(dx, dy)
    ctx.lineTo(dx, dy + dh)
    ctx.lineTo(dx + dw, dy + dh)
    ctx.closePath()
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fill('evenodd')

    // Document border (1px screen-space)
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    ctx.strokeRect(dx, dy, dw, dh)

    ctx.restore()

    // ── Canvas-space drawing (guides, selection, etc.) ──
    ctx.save()
    ctx.translate(view.x, view.y)
    ctx.scale(view.zoom, view.zoom)
    ctx.rotate(view.rotation)

    // Draw guides overlay (grid, perspective, symmetry) BEFORE selection
    this.guideManager.drawOverlay(ctx, view.zoom, this.documentWidth, this.documentHeight)

    // Draw selection overlay (marching ants + tool preview)
    this.selectionController.drawOverlay(ctx, view.zoom)

    ctx.restore()
  }

  // ── Stroke handlers (brush/eraser) ────────────────────────────────

  private handleStrokeStart(ps: PointerState) {
    this.syncBrushToActiveLayer()
    this.brushEngine.setEraserMode(this.activeTool === 'eraser')
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
    // Show initial stamp immediately
    this.recomposite()
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
    // Batch composite to once per animation frame during painting
    this.scheduleComposite()
  }

  private handleStrokeEnd() {
    // Clear QuickShape hold timer
    if (this.quickShapeHoldTimer) {
      clearTimeout(this.quickShapeHoldTimer)
      this.quickShapeHoldTimer = null
    }

    // Flush any pending RAF composite before stroke end snapshot
    this.flushComposite()

    // QuickShape detection: if hold detected and feature enabled
    if (this.quickShapeHoldDetected && this.quickShapeEnabled) {
      const strokePoints = this.brushEngine.getLastStrokePoints()
      if (strokePoints.length >= 3) {
        const shape = this.quickShape.detect(strokePoints.map(p => ({ x: p.x, y: p.y })))
        if (shape) {
          this.applyQuickShape(shape)
          return
        }
      }
    }

    this.brushEngine.endStroke()
    // Recomposite after stroke completion
    this.recomposite()
    // Update layer thumbnails for the panel
    this.layerManager.updateThumbnails()
    this.captureTimelapseFrame()
  }

  /** Whether QuickShape is enabled (set from React via guideStore sync). */
  quickShapeEnabled = false

  /** Apply a detected QuickShape: undo freehand stroke, render clean shape. */
  private applyQuickShape(shape: DetectedShape) {
    const preset = this.brushEngine['activePreset']
    if (!preset) {
      this.brushEngine.endStroke()
      this.recomposite()
      return
    }

    // End the freehand stroke
    this.brushEngine.endStroke()

    // Undo the freehand stroke
    this.performUndo().then(() => {
      // Generate shape stamps
      const stamps = this.quickShape.generateShapeStamps(shape, preset.size, preset.spacing)
      if (stamps.length === 0) return

      // Begin a fresh stroke, render shape stamps, and end
      const firstPt: StrokePoint = {
        x: stamps[0].x,
        y: stamps[0].y,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        timestamp: performance.now(),
      }
      this.brushEngine.beginStroke(firstPt)
      // Directly render all shape stamps via the brush engine
      ;(this.brushEngine as any).renderStamps(stamps)
      this.brushEngine.endStroke()

      this.recomposite()
      this.layerManager.updateThumbnails()
      this.captureTimelapseFrame()
    })
  }

  private applyViewTransform = (state: ViewState) => {
    if (!this.app) return
    const stage = this.app.stage
    stage.position.set(state.x, state.y)
    stage.scale.set(state.zoom)
    stage.rotation = state.rotation
    this.onViewChange?.(state)
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
    if (this.compositeRafId !== null) {
      cancelAnimationFrame(this.compositeRafId)
      this.compositeRafId = null
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
