import { type Application, Texture, Sprite, Container, RenderTexture } from 'pixi.js'
import { MAX_ZOOM, MIN_ZOOM, ViewTransform } from './ViewTransform.ts'
import { InputManager } from '../input/InputManager.ts'
import { BrushEngine } from '../brush/BrushEngine.ts'
import { LayerManager, type LayerChangeCallback } from '../layers/LayerManager.ts'
import { LayerCompositor } from '../layers/LayerCompositor.ts'
import { SelectionController } from '../selection/SelectionController.ts'
import { TransformManager } from '../transform/TransformManager.ts'
import { TransformController } from '../transform/TransformController.ts'
import { getContentBounds } from '../utils/contentBounds.ts'
import { FilterManager } from '../filters/FilterManager.ts'
import { FloodFillTool } from '../tools/FloodFillTool.ts'
import { EyedropperTool } from '../tools/EyedropperTool.ts'
import { GuideManager, type GuideSettings } from '../guides/GuideManager.ts'
import { SymmetryEngine } from '../guides/SymmetryEngine.ts'
import { QuickShape, type DetectedShape } from '../tools/QuickShape.ts'
import { TextTool } from '../tools/TextTool.ts'
import { TimelapseRecorder } from '../timelapse/TimelapseRecorder.ts'
import { createRenderer, type RendererOptions } from '../renderer.ts'
import type { ViewState, PointerState, SavedView, ToolType } from '../../types/engine.ts'
import type { LayerInfo, StoredLayer } from '../../types/layer.ts'
import type { StrokePoint } from '../../types/brush.ts'
import type { FilterParams } from '../../types/filter.ts'
import type { LayerSnapshot, LayerUndoEntry } from '../undo/UndoManager.ts'
import type { SelectionToolType, SelectionMode, BoundingBox } from '../../types/selection.ts'
import type { SelectionUndoEntry } from '../undo/UndoManager.ts'
import type { RGBAColor } from '../../types/color.ts'
import type { TextProperties } from '../../types/text.ts'
import { get2dContext } from '../../utils/canvas2d.ts'
import { asClampedBytes } from '../../utils/typedArrays.ts'
import { readPixels, readRegions, writePixels, writeTiles, type PremultipliedTile } from '../utils/readback.ts'
import { cutTiles, splitRun, tileRuns, type TileChanges, type TilePixels, type TilePosition } from '../../utils/tiles.ts'
import { strokePressure } from '../input/pressure.ts'

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

  /** Transform tool state */
  private transformState: {
    layerId: string
    beforeSnapshot: LayerSnapshot
    previewSprite: Sprite
    previewTexture: Texture
    originalPixels: Uint8Array
    originalWidth: number
    originalHeight: number
  } | null = null

  readonly viewTransform = new ViewTransform()
  readonly inputManager = new InputManager(this.viewTransform)
  readonly brushEngine = new BrushEngine()
  readonly layerManager = new LayerManager()
  readonly compositor = new LayerCompositor()
  readonly selectionController: SelectionController
  readonly transformManager = new TransformManager()
  readonly transformController = new TransformController()
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
  private onVanishingPointsChanged: ((points: { x: number; y: number }[]) => void) | null = null
  private onLayerChange: LayerChangeCallback | null = null
  private onDocumentChange: (() => void) | null = null
  /** True while loadDocument runs, so loading isn't reported as a change. */
  private loadingDocument = false
  /** The tiles changed since `takeChanges` last ran, by layer (plan M1.3). */
  private changes = new Map<string, Set<string> | 'all'>()
  private resizeObserver: ResizeObserver | null = null
  private container: HTMLElement | null = null

  private documentWidth = 1024
  private documentHeight = 768
  /** The GPU context was lost, and the layers' pixels with it. */
  private pixelsLost = false

  constructor() {
    // Initialize SelectionController with a default canvas size (resized later)
    this.selectionController = new SelectionController(1024, 768)
    // Wire symmetry engine to brush engine
    this.brushEngine.symmetryEngine = this.symmetryEngine

    // Every history step and every change to the layers is a change to save.
    // Choosing a layer and redrawing the panel's thumbnails aren't (plan M1.4).
    this.brushEngine.undoManager.setChangeCallback(() => this.notifyDocumentChange())
    this.layerManager.setChangeCallback((layers, activeId, kind) => {
      this.onLayerChange?.(layers, activeId, kind)
      if (kind === 'document') this.notifyDocumentChange()
    })
    // And where the pixels changed, so a save reads back only those tiles.
    // A change the brush didn't make leaves its snapshot of the layer out of
    // date (a stroke's own commit sets the snapshot again right after).
    this.brushEngine.undoManager.setPixelChangeCallback((id, tiles) => {
      this.brushEngine.clearSnapshotCache()
      this.recordChange(id, tiles)
    })
    this.layerManager.setPixelChangeCallback((id, change) => {
      this.brushEngine.clearSnapshotCache()
      if (change === 'removed') this.changes.delete(id)
      else if (change === 'empty') this.changes.set(id, new Set())
      else {
        // Changed outside the history: its steps no longer say what undoing them changes.
        this.brushEngine.undoManager.forgetTiles(id)
        this.recordChange(id, 'all')
      }
    })
  }

  private recordChange(layerId: string, tiles: TileChanges) {
    const known = this.changes.get(layerId)
    if (known === 'all') return
    if (tiles === 'all') {
      this.changes.set(layerId, 'all')
      return
    }
    const set = known ?? new Set<string>()
    for (const key of tiles) set.add(key)
    this.changes.set(layerId, set)
  }

  private notifyDocumentChange() {
    if (!this.loadingDocument) this.onDocumentChange?.()
  }

  /**
   * Initialize PixiJS on the static canvas and set up the overlay.
   * The container should be a positioned element that holds both canvases.
   * docWidth/docHeight set the artwork resolution (layer & compositor textures).
   */
  async init(container: HTMLElement, docWidth?: number, docHeight?: number, renderer: RendererOptions = {}): Promise<void> {
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
    const app = await createRenderer(this.staticCanvas, renderer)

    // destroy() ran while the renderer was starting (React StrictMode, or the
    // view changed). Release the renderer we just created instead of leaking
    // its GPU context.
    if (this.destroyed) {
      app.destroy(true)
      return
    }
    this.app = app
    this.watchForContextLoss(app)

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

    this.selectionController.resize(artW, artH)

    // Wire input to tool routing
    // Tool previews, handles and guides follow the pointer, so every input
    // event may change the overlay.
    this.inputManager.setStrokeCallbacks({
      onPointerDown: (ps) => {
        this.handlePointerDown(ps)
        this.requestOverlayRender()
      },
      onPointerMove: (ps, coalesced, _predicted) => {
        this.handlePointerMove(ps, coalesced)
        this.requestOverlayRender()
      },
      onPointerUp: () => {
        this.handlePointerUp()
        this.requestOverlayRender()
      },
      onHover: (ps) => {
        this.handleHover(ps)
        this.requestOverlayRender()
      },
    })

    // The overlay is drawn only when something on it changes (F62).
    this.selectionController.setRedrawCallback(() => this.requestOverlayRender())
    this.requestOverlayRender()

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
    this.onLayerChange = cb
  }

  /** Set the callback for every change worth saving: history steps and layer changes. */
  setDocumentChangeCallback(cb: (() => void) | null) {
    this.onDocumentChange = cb
  }

  // ── Document ──────────────────────────────────────────────────────

  getDocumentSize(): { width: number; height: number } {
    return { width: this.documentWidth, height: this.documentHeight }
  }

  getLayerInfos(): LayerInfo[] {
    return this.layerManager.getLayerInfos()
  }

  getActiveLayerId(): string {
    return this.layerManager.getActiveLayerId()
  }

  /**
   * A layer's pixels, straight RGBA at document size, in a buffer of the
   * caller's own (saves hand it to the persistence worker). Under a filter or
   * transform preview, the pixels from before it: a preview isn't part of the
   * document until it is applied.
   */
  getLayerPixels(id: string): Uint8Array | null {
    if (!this.app) return null
    this.checkPixelsReadable()
    const layer = this.layerManager.getLayerById(id)
    if (!layer) return null
    const committed = this.transformState?.layerId === id
      ? this.transformState.beforeSnapshot
      : this.filterManager.committedPixels(id)
    // A preview's snapshot isn't compressed until it goes into the history, after the preview.
    if (committed) return committed.compressed ? null : committed.data.slice()
    const { pixels } = readPixels(this.app.renderer, layer.texture)
    return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  }

  /**
   * What changed since the last call, by layer: the 256 × 256 tiles that
   * changes touched ("column_row"), or 'all' for a layer changed throughout,
   * and an empty set for a layer that was made empty. Layers missing from it
   * haven't changed. Starts a new record: the caller saves these changes.
   */
  takeChanges(): Map<string, TileChanges> {
    const changes = this.changes
    this.changes = new Map()
    return changes
  }

  /**
   * Some of a layer's tiles, straight RGBA, each in a buffer of its own and
   * cut at the document's edges (`tileBounds`). Like `getLayerPixels`, the
   * pixels from before a preview. Null when they can't be read now.
   */
  getLayerTiles(id: string, tiles: readonly TilePosition[]): TilePixels[] | null {
    if (!this.app) return null
    this.checkPixelsReadable()
    const layer = this.layerManager.getLayerById(id)
    if (!layer) return null
    const width = this.documentWidth
    const height = this.documentHeight
    const committed = this.transformState?.layerId === id
      ? this.transformState.beforeSnapshot
      : this.filterManager.committedPixels(id)
    if (committed) return committed.compressed ? null : cutTiles(committed.data, width, height, tiles)
    // A row of adjacent tiles is one readback.
    const runs = tileRuns(tiles, width, height)
    const pixels = readRegions(
      this.app.renderer,
      layer.texture,
      runs.map((run) => ({ x: run.left, y: run.top, width: run.width, height: run.height })),
    )
    return runs.flatMap((run, i) => splitRun(run, pixels[i], width, height))
  }

  /** Whether a filter or transform preview is on screen. */
  isPreviewing(): boolean {
    return this.transformState !== null || this.filterManager.isActive()
  }

  /** Whether a stroke is being drawn. */
  isDrawing(): boolean {
    return this.brushEngine.isStroking()
  }

  /**
   * Note a lost GPU context. The layers' pixels live in their textures, which
   * the loss empties, and they stay empty if the context comes back. So from
   * then on reading pixels throws instead of returning blanks that a save
   * would write over the project (recovering them: F105, M2.2).
   */
  private watchForContextLoss(app: Application) {
    this.staticCanvas?.addEventListener('webglcontextlost', () => {
      this.pixelsLost = true
    })
    const gpu = (app.renderer as { gpu?: { device?: { lost?: Promise<{ reason?: string }> } } }).gpu
    void gpu?.device?.lost?.then((info) => {
      if (info.reason !== 'destroyed' && !this.destroyed) this.pixelsLost = true
    })
  }

  private checkPixelsReadable() {
    if (this.pixelsLost) {
      throw new Error('the canvas lost its pixels when the graphics processor reset. Reload the page: your last save is kept')
    }
  }

  /**
   * Replace the document with saved layers (opening a project). Layer ids are
   * kept, history starts empty, and none of this counts as a change to save.
   * Pixels of the wrong size are skipped, leaving that layer empty; layers
   * without pixels start empty, for their tiles to be placed (`placeTiles`).
   * Returns the ids of the layers made, bottom first: the saved ones, but a
   * fresh id for one that repeats another's, and none past the layer limit.
   */
  loadDocument(layers: readonly StoredLayer[], activeLayerId: string | null): readonly string[] {
    if (!this.app) return []
    this.loadingDocument = true
    try {
      this.brushEngine.clearSnapshotCache()
      const created = this.layerManager.replaceLayers(layers.map((l) => l.info), activeLayerId)
      const width = this.documentWidth
      const height = this.documentHeight
      created.forEach((layer, i) => {
        const pixels = layers[i]?.pixels
        if (pixels && pixels.length === width * height * 4) {
          this.restoreLayerSnapshot(layer.texture, { width, height, data: pixels })
        }
      })
      this.brushEngine.undoManager.clear()
      this.syncBrushToActiveLayer()
      this.compositor.invalidateCache()
      this.recomposite()
      this.layerManager.updateThumbnails()
      return created.map((layer) => layer.info.id)
    } finally {
      this.loadingDocument = false
      // The document as loaded is the one saved: nothing has changed yet.
      this.changes.clear()
    }
  }

  /**
   * Put saved tiles into a layer that `loadDocument` made empty (opening a
   * project, plan M1.4): premultiplied 256 × 256 tiles, as the tile store
   * keeps them. They are what was saved, so this isn't a change to save.
   * The document shows once `finishLoading` runs.
   */
  placeTiles(layerId: string, tiles: readonly PremultipliedTile[]): void {
    if (!this.app || this.destroyed || tiles.length === 0) return
    const layer = this.layerManager.getLayerById(layerId)
    if (!layer) return
    this.brushEngine.clearSnapshotCache()
    writeTiles(this.app.renderer, layer.texture, tiles)
    this.compositor.invalidateCache()
  }

  /** Every saved tile is in place: show the document, and draw the layers' thumbnails. */
  finishLoading(): void {
    if (!this.app || this.destroyed) return
    this.compositor.invalidateCache()
    this.recomposite()
    this.layerManager.updateThumbnails()
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
    // Cancel active transform before undo
    if (this.transformState) {
      this.cancelTransform()
    }

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
    this.recordChange(entry.layerId, entry.tiles ?? 'all')
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
    this.recordChange(entry.layerId, entry.tiles ?? 'all')
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

    if (data.length < w * h * 4) return

    // Replaces the layer's contents completely
    writePixels(this.app.renderer, layerTexture, data, w, h)
  }

  /** Set the document dimensions and resize all layer/compositor textures to match. */
  setDocumentSize(width: number, height: number) {
    const resized = width !== this.documentWidth || height !== this.documentHeight
    this.documentWidth = width
    this.documentHeight = height

    // A new size centres symmetry on it, and the guide settings follow, so the
    // centre saved with the document is the one shown (plan M1.4). The same
    // size leaves the centre the document opened with.
    if (resized) {
      this.symmetryEngine.centerX = width / 2
      this.symmetryEngine.centerY = height / 2
      this.guideManager.symmetryCenterX = width / 2
      this.guideManager.symmetryCenterY = height / 2
      this.onSymmetryCenterChanged?.(width / 2, height / 2)
    }

    // Resize layer textures and compositor to document dimensions
    if (this.app) {
      this.layerManager.resizeAllLayers(width, height)
      this.compositor.setSize(width, height)
      this.selectionController.resize(width, height)
      this.syncBrushToActiveLayer()
      this.recomposite()
    }
    this.requestOverlayRender()
  }

  /** Fit document into the viewport, centering with padding. */
  fitToDocument() {
    if (!this.container) return
    const { clientWidth: vw, clientHeight: vh } = this.container
    this.viewTransform.fitToDocument(this.documentWidth, this.documentHeight, vw, vh)
  }

  /**
   * How the document is shown, to save with its project (plan M1.4). Null
   * when there is no viewport to measure (the canvas isn't on the page).
   */
  getView(): SavedView | null {
    const container = this.container
    if (!container || this.destroyed) return null
    const { clientWidth: vw, clientHeight: vh } = container
    if (vw <= 0 || vh <= 0) return null
    const centre = this.viewTransform.screenToCanvas(vw / 2, vh / 2)
    const { zoom, rotation } = this.viewTransform.getState()
    // Rounded, so a view that didn't change saves as the same numbers.
    const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places
    const turn = 2 * Math.PI
    return {
      x: round(centre.x, 2),
      y: round(centre.y, 2),
      zoom: round(zoom, 5),
      rotation: round((((rotation % turn) + turn) % turn), 5),
    }
  }

  /**
   * Show the document as a saved view had it, its point at the middle of the
   * viewport. A point off the document is moved onto it, so some of the
   * document always shows. False, with the view unchanged, when there is no
   * viewport yet or the view isn't one.
   */
  restoreView(view: SavedView): boolean {
    const container = this.container
    if (!container || this.destroyed) return false
    const { clientWidth: vw, clientHeight: vh } = container
    if (vw <= 0 || vh <= 0) return false
    const { x, y, zoom, rotation } = view
    if (![x, y, zoom, rotation].every((v) => typeof v === 'number' && Number.isFinite(v)) || zoom <= 0) return false
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
    this.viewTransform.centerOn(
      clamp(x, this.documentWidth),
      clamp(y, this.documentHeight),
      Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM),
      rotation,
      vw / 2,
      vh / 2,
    )
    return true
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
    const ctx = get2dContext(canvas)

    // Draw the imported image centered, scaled to fit if larger than document
    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = imgW
    srcCanvas.height = imgH
    const srcCtx = get2dContext(srcCanvas)
    srcCtx.putImageData(new ImageData(asClampedBytes(pixels), imgW, imgH), 0, 0)

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
    const prevTool = this.activeTool
    // A stroke still being drawn ends here, as its pointer up would: that goes
    // to the new tool, and the stroke would stay open (plan M1.3).
    if (this.brushEngine.isStroking() && tool !== 'brush' && tool !== 'eraser') this.handleStrokeEnd()
    this.activeTool = tool
    this.requestOverlayRender()

    // Auto-commit transform when switching away from transform tool
    if (prevTool === 'transform' && tool !== 'transform' && this.transformState) {
      this.commitTransform()
    }

    // Auto-begin transform when switching to transform tool
    if (tool === 'transform' && prevTool !== 'transform') {
      this.beginTransform()
    }

    // Update cursor based on tool
    if (this.overlayCanvas) {
      if (tool === 'move') {
        this.overlayCanvas.style.cursor = 'grab'
      } else if (tool === 'transform') {
        this.overlayCanvas.style.cursor = 'default'
      } else if (tool === 'text') {
        this.overlayCanvas.style.cursor = 'text'
      } else {
        this.overlayCanvas.style.cursor = 'crosshair'
      }
    }
  }

  /** Set the selection sub-tool type. */
  setSelectionSubTool(subTool: SelectionToolType) {
    this.selectionController.setSubTool(subTool)
    this.requestOverlayRender()
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
    this.requestOverlayRender()
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
    const extracted = readPixels(this.app.renderer, layer.texture)
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

    const extracted = readPixels(this.app.renderer, layer.texture)
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

  /** Set callback for symmetry center changes (dragging the center handle, or a new document size). */
  setSymmetryCenterChangedCallback(cb: (cx: number, cy: number) => void): void {
    this.onSymmetryCenterChanged = cb
  }

  /** Set callback for vanishing points dragged on the canvas, once the drag ends (plan M1.4: they are saved with the guides). */
  setVanishingPointsChangedCallback(cb: ((points: { x: number; y: number }[]) => void) | null): void {
    this.onVanishingPointsChanged = cb
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
    const extracted = readPixels(this.app.renderer, layer.texture)
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

    const extracted = readPixels(this.app.renderer, outputTexture)
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
    this.checkPixelsReadable()
    // Force a full N-layer composite for accuracy (bypass cache fast path)
    this.compositor.invalidateCache()
    this.recomposite()
    const outputTexture = this.compositor.getOutputTexture()
    if (!outputTexture) return null
    const extracted = readPixels(this.app.renderer, outputTexture)
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
      this.transformController.setZoom(this.viewTransform.getState().zoom)
      const consumed = this.transformController.handlePointerDown(canvasPoint)
      if (!consumed && this.transformState) {
        // Clicked outside bounds — commit current, begin new
        this.commitTransform()
        this.beginTransform()
      }
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

    if (this.activeTool === 'transform') {
      const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)
      if (this.transformController.getDragging()) {
        this.transformController.handlePointerMove(canvasPoint)
        this.updateTransformPreview()
      } else {
        // Update cursor based on what's under the pointer
        this.updateTransformCursor(canvasPoint)
      }
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

  private handlePointerUp() {
    // VP handle dragging finish — notify React to sync store
    if (this.draggingVP !== null) {
      this.draggingVP = null
      this.onVanishingPointsChanged?.(this.guideManager.vanishingPoints.map(({ x, y }) => ({ x, y })))
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

    if (this.activeTool === 'transform') {
      this.transformController.handlePointerUp()
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
    const extracted = readPixels(this.app.renderer, layer.texture)
    const pixels = new Uint8Array(
      extracted.pixels.buffer,
      extracted.pixels.byteOffset,
      extracted.pixels.byteLength,
    )
    this.selectionController.executeMagicWand(canvasPoint, pixels)
  }

  // ── Transform tool ──────────────────────────────────────────────

  /** Begin a transform operation on the active layer. */
  beginTransform() {
    if (!this.app) return
    if (this.transformState) return // already active

    const layer = this.layerManager.getActiveLayer()
    if (!layer) return

    // Extract current pixel data
    let extracted: { pixels: Uint8ClampedArray; width: number; height: number }
    try {
      extracted = readPixels(this.app.renderer, layer.texture)
    } catch {
      return // extraction not available (e.g. during tests)
    }
    const pixels = new Uint8Array(extracted.pixels.buffer, extracted.pixels.byteOffset, extracted.pixels.byteLength)
    const before: LayerSnapshot = {
      width: extracted.width,
      height: extracted.height,
      data: new Uint8Array(pixels),
    }

    // Find content bounds
    const bounds = getContentBounds(pixels, extracted.width, extracted.height)
    if (!bounds) {
      // Empty layer — no handles to show, but allow flip/rotate
      return
    }

    // Start the transform controller
    this.transformController.begin(bounds)
    this.requestOverlayRender()

    // Create a temporary canvas with the layer content for preview
    const canvas = document.createElement('canvas')
    canvas.width = before.width
    canvas.height = before.height
    const ctx = get2dContext(canvas)
    const imageData = new ImageData(
      asClampedBytes(pixels, extracted.width * extracted.height * 4),
      before.width,
      before.height,
    )
    ctx.putImageData(imageData, 0, 0)

    const previewTexture = Texture.from(canvas)
    const previewSprite = new Sprite(previewTexture)

    this.transformState = {
      layerId: layer.info.id,
      beforeSnapshot: before,
      previewSprite,
      previewTexture,
      originalPixels: pixels,
      originalWidth: extracted.width,
      originalHeight: extracted.height,
    }
  }

  /** Update the preview sprite based on current transform state. */
  private updateTransformPreview() {
    if (!this.app || !this.transformState) return
    const layer = this.layerManager.getLayerById(this.transformState.layerId)
    if (!layer) return

    const state = this.transformController.manager.getState()
    if (!state) return

    const { previewSprite } = this.transformState

    // Apply transform to the preview sprite
    previewSprite.position.set(
      state.pivotX + state.translateX,
      state.pivotY + state.translateY,
    )
    previewSprite.pivot.set(state.pivotX, state.pivotY)
    previewSprite.scale.set(state.scaleX, state.scaleY)
    previewSprite.rotation = state.rotation

    // Render the transformed sprite to the layer texture
    this.app.renderer.render({
      container: previewSprite,
      target: layer.texture,
      clear: true,
    })

    this.scheduleComposite()
  }

  /** Commit the current transform (apply changes and push undo). */
  commitTransform() {
    if (!this.app || !this.transformState) return

    this.flushComposite()

    const layer = this.layerManager.getLayerById(this.transformState.layerId)
    if (layer) {
      // Extract the after snapshot
      const extracted = readPixels(this.app.renderer, layer.texture)
      const after: LayerSnapshot = {
        width: extracted.width,
        height: extracted.height,
        data: new Uint8Array(extracted.pixels.buffer, extracted.pixels.byteOffset, extracted.pixels.byteLength),
      }

      // Push undo entry
      const entry: LayerUndoEntry = {
        type: 'layer',
        layerId: this.transformState.layerId,
        before: this.transformState.beforeSnapshot,
        after,
      }
      this.brushEngine.undoManager.pushEntry(entry)
      this.brushEngine.clearSnapshotCache()

      this.recomposite()
      this.layerManager.updateThumbnails()
      this.captureTimelapseFrame()
    }

    this.cleanupTransform()
  }

  /** Cancel the current transform (restore original pixels). */
  cancelTransform() {
    if (!this.app || !this.transformState) return

    const layer = this.layerManager.getLayerById(this.transformState.layerId)
    if (layer) {
      // Restore original pixels
      this.restoreLayerSnapshot(layer.texture, this.transformState.beforeSnapshot)
      this.compositor.invalidateCache()
      this.recomposite()
    }

    this.cleanupTransform()
  }

  /** Cleanup transform state. */
  private cleanupTransform() {
    if (this.transformState) {
      this.transformState.previewTexture.destroy(true)
      this.transformState.previewSprite.destroy()
      this.transformState = null
    }
    this.transformController.cancel()
    this.requestOverlayRender()
  }

  /** Flip the active layer horizontally. */
  flipLayerHorizontal() {
    this.applyPixelTransform((pixels, w, h) => ({
      pixels: TransformManager.flipHorizontal(pixels, w, h),
      width: w,
      height: h,
    }))
  }

  /** Flip the active layer vertically. */
  flipLayerVertical() {
    this.applyPixelTransform((pixels, w, h) => ({
      pixels: TransformManager.flipVertical(pixels, w, h),
      width: w,
      height: h,
    }))
  }

  /** Rotate the active layer 90 degrees clockwise. */
  rotateLayer90CW() {
    this.applyPixelTransform((pixels, w, h) =>
      TransformManager.rotate90CW(pixels, w, h),
    )
  }

  /** Rotate the active layer 90 degrees counter-clockwise. */
  rotateLayer90CCW() {
    this.applyPixelTransform((pixels, w, h) =>
      TransformManager.rotate90CCW(pixels, w, h),
    )
  }

  /**
   * Helper: extract pixels from active layer, apply a pixel transform function,
   * write back, and push undo. If a freeform transform is active, commit it first
   * then re-begin after.
   */
  private applyPixelTransform(
    fn: (pixels: Uint8Array, w: number, h: number) => { pixels: Uint8Array; width: number; height: number },
  ) {
    if (!this.app) return

    // If freeform transform is active, commit first
    const wasTransforming = this.transformState !== null
    if (wasTransforming) {
      this.commitTransform()
    }

    const layer = this.layerManager.getActiveLayer()
    if (!layer) return

    // Extract current pixels
    const extracted = readPixels(this.app.renderer, layer.texture)
    const pixels = new Uint8Array(extracted.pixels.buffer, extracted.pixels.byteOffset, extracted.pixels.byteLength)
    const before: LayerSnapshot = {
      width: extracted.width,
      height: extracted.height,
      data: new Uint8Array(pixels),
    }

    // Apply the transform
    const result = fn(pixels, extracted.width, extracted.height)

    // For rotations that change dimensions, we need to center the result on the document
    const docW = this.documentWidth
    const docH = this.documentHeight
    let afterData: Uint8Array
    let afterW: number
    let afterH: number

    if (result.width !== extracted.width || result.height !== extracted.height) {
      // Dimensions changed (rotation) — create a doc-sized canvas and center the result
      const canvas = document.createElement('canvas')
      canvas.width = docW
      canvas.height = docH
      const ctx = get2dContext(canvas)
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = result.width
      srcCanvas.height = result.height
      const srcCtx = get2dContext(srcCanvas)
      srcCtx.putImageData(
        new ImageData(asClampedBytes(result.pixels, result.width * result.height * 4), result.width, result.height),
        0, 0,
      )
      const drawX = Math.round((docW - result.width) / 2)
      const drawY = Math.round((docH - result.height) / 2)
      ctx.drawImage(srcCanvas, drawX, drawY)
      const imgData = ctx.getImageData(0, 0, docW, docH)
      afterData = new Uint8Array(imgData.data.buffer)
      afterW = docW
      afterH = docH
    } else {
      afterData = result.pixels
      afterW = result.width
      afterH = result.height
    }

    const after: LayerSnapshot = {
      width: afterW,
      height: afterH,
      data: afterData,
    }

    // Write back to layer texture
    this.restoreLayerSnapshot(layer.texture, after)

    // Push undo
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
    this.captureTimelapseFrame()

    // Re-begin transform if it was active
    if (wasTransforming && this.activeTool === 'transform') {
      this.beginTransform()
    }
  }

  // ── Custom cursors for transform tool ───────────────────────────

  private static cursorCache: { rotate: string; scale: Record<string, string> } | null = null

  private static buildCursors() {
    if (CanvasManager.cursorCache) return CanvasManager.cursorCache

    const render = (size: number, draw: (ctx: CanvasRenderingContext2D) => void): string => {
      const c = document.createElement('canvas')
      c.width = size
      c.height = size
      const ctx = get2dContext(c)
      draw(ctx)
      return c.toDataURL('image/png')
    }

    // Rotation cursor: curved arrow (3/4 circle with arrowheads)
    const rotatePng = render(32, (ctx) => {
      const cx = 16, cy = 16, r = 10
      // Dark outline arc
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI)
      ctx.stroke()
      // Amber arc
      ctx.strokeStyle = '#F59E0B'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI)
      ctx.stroke()
      // Arrowhead at top (start of arc, pointing right)
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.moveTo(16, 2)
      ctx.lineTo(22, 6)
      ctx.lineTo(16, 10)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#F59E0B'
      ctx.beginPath()
      ctx.moveTo(16.5, 3)
      ctx.lineTo(21, 6)
      ctx.lineTo(16.5, 9)
      ctx.closePath()
      ctx.fill()
      // Arrowhead at left (end of arc, pointing down)
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.moveTo(2, 16)
      ctx.lineTo(6, 22)
      ctx.lineTo(10, 16)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#F59E0B'
      ctx.beginPath()
      ctx.moveTo(3, 16.5)
      ctx.lineTo(6, 21)
      ctx.lineTo(9, 16.5)
      ctx.closePath()
      ctx.fill()
    })

    // Scale cursors: double-arrow at different angles
    const makeScale = (angle: number) => {
      return render(24, (ctx) => {
        ctx.translate(12, 12)
        ctx.rotate((angle * Math.PI) / 180)
        ctx.translate(-12, -12)
        // Dark outline
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(12, 4)
        ctx.lineTo(12, 20)
        ctx.stroke()
        // Amber line
        ctx.strokeStyle = '#F59E0B'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(12, 4)
        ctx.lineTo(12, 20)
        ctx.stroke()
        // Top arrowhead
        ctx.fillStyle = '#000'
        ctx.beginPath()
        ctx.moveTo(12, 1)
        ctx.lineTo(17, 7)
        ctx.lineTo(7, 7)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#F59E0B'
        ctx.beginPath()
        ctx.moveTo(12, 2.5)
        ctx.lineTo(16, 7)
        ctx.lineTo(8, 7)
        ctx.closePath()
        ctx.fill()
        // Bottom arrowhead
        ctx.fillStyle = '#000'
        ctx.beginPath()
        ctx.moveTo(12, 23)
        ctx.lineTo(17, 17)
        ctx.lineTo(7, 17)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#F59E0B'
        ctx.beginPath()
        ctx.moveTo(12, 21.5)
        ctx.lineTo(16, 17)
        ctx.lineTo(8, 17)
        ctx.closePath()
        ctx.fill()
      })
    }

    const scale: Record<string, string> = {
      topLeft: `url(${makeScale(-45)}) 12 12, nwse-resize`,
      topRight: `url(${makeScale(45)}) 12 12, nesw-resize`,
      bottomLeft: `url(${makeScale(45)}) 12 12, nesw-resize`,
      bottomRight: `url(${makeScale(-45)}) 12 12, nwse-resize`,
      topCenter: `url(${makeScale(0)}) 12 12, ns-resize`,
      bottomCenter: `url(${makeScale(0)}) 12 12, ns-resize`,
      middleLeft: `url(${makeScale(90)}) 12 12, ew-resize`,
      middleRight: `url(${makeScale(90)}) 12 12, ew-resize`,
    }

    CanvasManager.cursorCache = {
      rotate: `url(${rotatePng}) 16 16, crosshair`,
      scale,
    }
    return CanvasManager.cursorCache
  }

  /** Update cursor based on transform handle hover. */
  private updateTransformCursor(canvasPoint: { x: number; y: number }) {
    if (!this.overlayCanvas) return
    if (!this.transformController.isActive()) {
      this.overlayCanvas.style.cursor = 'default'
      return
    }

    const zoom = this.viewTransform.getState().zoom
    // Keep zoom in sync so edge/rotation hit-testing uses correct thresholds
    this.transformController.setZoom(zoom)

    const handleRadius = 8 / zoom
    const handle = this.transformController.manager.hitTestHandle(canvasPoint, handleRadius, zoom)

    const cursors = CanvasManager.buildCursors()

    if (handle && handle !== 'rotation') {
      this.overlayCanvas.style.cursor = cursors.scale[handle] || 'nwse-resize'
    } else if (this.transformController.hitTestRotationZone(canvasPoint)) {
      this.overlayCanvas.style.cursor = cursors.rotate
    } else {
      // Check edge proximity (hovering on bounding box line)
      const edgeHandle = this.transformController.hitTestEdge(canvasPoint)
      if (edgeHandle) {
        this.overlayCanvas.style.cursor = cursors.scale[edgeHandle] || 'ns-resize'
      } else if (this.transformController.manager.isInsideBounds(canvasPoint)) {
        this.overlayCanvas.style.cursor = 'move'
      } else {
        this.overlayCanvas.style.cursor = 'default'
      }
    }
  }

  /** Handle hover (pointer move with no button pressed) — cursor updates. */
  private handleHover(ps: PointerState) {
    if (this.activeTool === 'transform') {
      const canvasPoint = this.viewTransform.screenToCanvas(ps.x, ps.y)
      this.updateTransformCursor(canvasPoint)
    }
  }

  // ── Overlay rendering ─────────────────────────────────────────────

  /**
   * Draw the overlay on the next animation frame. Everything that changes what
   * the overlay shows calls this, and calls within one frame draw it once.
   * While a selection is shown, its marching ants keep the overlay animating.
   */
  requestOverlayRender() {
    if (this.overlayRafId !== null || this.destroyed) return
    this.overlayRafId = requestAnimationFrame(() => {
      this.overlayRafId = null
      this.renderOverlay()
      if (this.selectionController.isAnimating()) this.requestOverlayRender()
    })
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

    // Draw transform overlay (bounding box + handles)
    this.transformController.drawOverlay(ctx, view.zoom)

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
      pressure: strokePressure(ps),
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
            pressure: strokePressure(c),
            tiltX: c.tiltX,
            tiltY: c.tiltY,
            timestamp: performance.now(),
          }
        })
      : [{
          ...this.viewTransform.screenToCanvas(ps.x, ps.y),
          pressure: strokePressure(ps),
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

  /** Apply grid, perspective, symmetry and QuickShape settings from the UI. */
  applyGuideSettings(s: GuideSettings) {
    this.guideManager.applySettings(s)
    this.requestOverlayRender()

    const se = this.symmetryEngine
    se.enabled = s.symmetryEnabled
    se.type = s.symmetryType
    se.axes = s.symmetryAxes
    se.rotation = s.symmetryRotation
    se.centerX = s.symmetryCenterX
    se.centerY = s.symmetryCenterY

    this.quickShapeEnabled = s.quickShapeEnabled
  }

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
      this.brushEngine.renderStamps(stamps)
      this.brushEngine.endStroke()

      this.recomposite()
      this.layerManager.updateThumbnails()
      this.captureTimelapseFrame()
    }).catch(() => {
      // Undo failed — stroke already ended, just recomposite
      this.recomposite()
    })
  }

  private applyViewTransform = (state: ViewState) => {
    if (!this.app) return
    const stage = this.app.stage
    stage.position.set(state.x, state.y)
    stage.scale.set(state.zoom)
    stage.rotation = state.rotation
    this.onViewChange?.(state)
    this.requestOverlayRender()
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
      // Resizing a canvas clears it.
      this.requestOverlayRender()
    }
  }

  destroy() {
    this.destroyed = true
    // Tearing down isn't a change to save.
    this.onDocumentChange = null
    this.onLayerChange = null
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
    if (this.quickShapeHoldTimer) {
      clearTimeout(this.quickShapeHoldTimer)
      this.quickShapeHoldTimer = null
    }

    // Clean up active transform if any
    if (this.transformState) {
      this.cleanupTransform()
    }

    this.brushEngine.destroy()
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
