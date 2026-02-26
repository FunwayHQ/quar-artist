import { type Application, Texture, Sprite, Graphics, Container, RenderTexture } from 'pixi.js'
import { ViewTransform } from './ViewTransform.ts'
import { InputManager } from '../input/InputManager.ts'
import { BrushEngine } from '../brush/BrushEngine.ts'
import { LayerManager, type LayerChangeCallback } from '../layers/LayerManager.ts'
import { LayerCompositor } from '../layers/LayerCompositor.ts'
import { createRenderer } from '../renderer.ts'
import type { ViewState, PointerState } from '../../types/engine.ts'
import type { StrokePoint } from '../../types/brush.ts'
import { TILE_SIZE } from '../layers/TileManager.ts'
import type { TileSnapshot } from '../undo/UndoManager.ts'

/**
 * Manages the two-canvas architecture:
 *   1. Static canvas — PixiJS Application (artwork rendering)
 *   2. Interactive canvas — HTML overlay (cursor, selection, guides)
 *
 * Owns ViewTransform, InputManager, BrushEngine, LayerManager, LayerCompositor.
 * No React.
 */
export class CanvasManager {
  private app: Application | null = null
  private staticCanvas: HTMLCanvasElement | null = null
  private overlayCanvas: HTMLCanvasElement | null = null
  private overlayCtx: CanvasRenderingContext2D | null = null
  private destroyed = false

  readonly viewTransform = new ViewTransform()
  readonly inputManager = new InputManager(this.viewTransform)
  readonly brushEngine = new BrushEngine()
  readonly layerManager = new LayerManager()
  readonly compositor = new LayerCompositor()

  private resizeObserver: ResizeObserver | null = null
  private container: HTMLElement | null = null

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

    // Wire input to brush engine
    this.inputManager.setStrokeCallbacks({
      onPointerDown: (ps) => this.handleStrokeStart(ps),
      onPointerMove: (ps, coalesced) => this.handleStrokeMove(ps, coalesced),
      onPointerUp: () => this.handleStrokeEnd(),
    })

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

  /** Undo the last brush operation — restore tile pixels and recomposite. */
  performUndo(): boolean {
    const entry = this.brushEngine.undoManager.undo()
    if (!entry) return false

    const layer = this.layerManager.getLayerById(entry.layerId)
    if (!layer) return false

    this.restoreTileSnapshots(layer.texture, entry.before)
    this.recomposite()
    this.layerManager.updateThumbnails()
    return true
  }

  /** Redo the last undone operation — restore tile pixels and recomposite. */
  performRedo(): boolean {
    const entry = this.brushEngine.undoManager.redo()
    if (!entry) return false

    const layer = this.layerManager.getLayerById(entry.layerId)
    if (!layer) return false

    this.restoreTileSnapshots(layer.texture, entry.after)
    this.recomposite()
    this.layerManager.updateThumbnails()
    return true
  }

  /**
   * Write tile snapshots back to a layer's RenderTexture.
   * For each tile: erase the region, then paint the snapshot pixels.
   */
  private restoreTileSnapshots(layerTexture: RenderTexture, snapshots: TileSnapshot[]) {
    if (!this.app || snapshots.length === 0) return

    const texW = layerTexture.width
    const texH = layerTexture.height

    for (const snapshot of snapshots) {
      const parts = snapshot.key.split('_')
      const tx = Number(parts[0])
      const ty = Number(parts[1])
      const px = tx * TILE_SIZE
      const py = ty * TILE_SIZE

      const w = Math.min(TILE_SIZE, texW - px)
      const h = Math.min(TILE_SIZE, texH - py)
      if (w <= 0 || h <= 0) continue

      // Step 1: Erase the tile region
      const eraseG = new Graphics()
      eraseG.rect(px, py, w, h)
      eraseG.fill({ color: 0xffffff, alpha: 1 })
      const eraseContainer = new Container()
      eraseContainer.addChild(eraseG)
      eraseContainer.blendMode = 'erase'
      this.app.renderer.render({
        container: eraseContainer,
        target: layerTexture,
        clear: false,
      })

      // Step 2: Paint the snapshot pixels from a temp canvas
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      const imageData = new ImageData(
        new Uint8ClampedArray(snapshot.data.buffer, snapshot.data.byteOffset, snapshot.data.byteLength),
        w,
        h,
      )
      ctx.putImageData(imageData, 0, 0)

      const tex = Texture.from(canvas)
      const sprite = new Sprite(tex)
      sprite.position.set(px, py)
      this.app.renderer.render({
        container: sprite,
        target: layerTexture,
        clear: false,
      })
      tex.destroy(true)
    }
  }

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
