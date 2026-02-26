import { Graphics, RenderTexture, Sprite, Container, Rectangle, type Application } from 'pixi.js'
import { StrokeSmoother } from './StrokeSmoother.ts'
import { PathInterpolator } from './PathInterpolator.ts'
import { TileManager, TILE_SIZE } from '../layers/TileManager.ts'
import { UndoManager } from '../undo/UndoManager.ts'
import type { TileSnapshot } from '../undo/UndoManager.ts'
import type { StrokePoint, StampPosition, BrushPreset } from '../../types/brush.ts'
import type { RGBAColor } from '../../types/color.ts'

/**
 * Stamp-based brush rendering pipeline.
 * Receives pointer input, smooths, interpolates, and renders stamps
 * to the active layer's RenderTexture.
 */
export class BrushEngine {
  private app: Application | null = null
  private smoother = new StrokeSmoother()
  private interpolator = new PathInterpolator()
  private tileManager = new TileManager()
  readonly undoManager = new UndoManager()

  private activePreset: BrushPreset | null = null
  private activeLayerTexture: RenderTexture | null = null
  private activeLayerId: string = ''
  private alphaLock: boolean = false
  private strokeActive = false
  private color: RGBAColor = { r: 1, g: 1, b: 1, a: 1 }

  /** Reusable stamp graphics to minimize object allocation */
  private stampGraphics = new Graphics()
  private stampContainer = new Container()

  setApp(app: Application) {
    this.app = app
    this.stampContainer.addChild(this.stampGraphics)
  }

  setPreset(preset: BrushPreset) {
    this.activePreset = preset
    this.smoother.setAlpha(1 - preset.smoothing)
  }

  setColor(color: RGBAColor) {
    this.color = color
  }

  setActiveLayerTexture(texture: RenderTexture) {
    this.activeLayerTexture = texture
  }

  /** Set which layer the brush is painting on (for undo tracking). */
  setActiveLayerId(id: string) {
    this.activeLayerId = id
  }

  /** Set whether the active layer has alpha lock enabled. */
  setAlphaLock(locked: boolean) {
    this.alphaLock = locked
  }

  /** Called on pointerdown — begin a new stroke. */
  beginStroke(point: StrokePoint) {
    if (!this.activePreset || !this.activeLayerTexture || !this.app) return

    this.strokeActive = true
    this.smoother.reset()
    this.interpolator.reset()
    this.tileManager.reset()

    // Mark initial tile dirty
    this.tileManager.markDirty(point.x, point.y, this.activePreset.size / 2)

    // Snapshot "before" state of the tiles we're about to paint on
    const beforeSnapshots = this.extractTileSnapshots()
    this.undoManager.beginOperation(beforeSnapshots, this.activeLayerId)

    const smoothed = this.smoother.smooth(point)
    const stamps = this.interpolator.addPoint(smoothed, this.activePreset)
    this.renderStamps(stamps)
  }

  /** Called on pointermove — continue the stroke with new points. */
  continueStroke(points: StrokePoint[]) {
    if (!this.strokeActive || !this.activePreset || !this.activeLayerTexture || !this.app) return

    const allStamps: StampPosition[] = []

    for (const point of points) {
      this.tileManager.markDirty(point.x, point.y, this.activePreset.size / 2)
      const smoothed = this.smoother.smooth(point)
      const stamps = this.interpolator.addPoint(smoothed, this.activePreset)
      allStamps.push(...stamps)
    }

    if (allStamps.length > 0) {
      this.renderStamps(allStamps)
    }
  }

  /** Called on pointerup — finalize the stroke and commit to undo. */
  endStroke() {
    if (!this.strokeActive) return
    this.strokeActive = false

    // Snapshot "after" state of dirty tiles and commit to undo
    const afterSnapshots = this.extractTileSnapshots()
    this.undoManager.commitOperation(afterSnapshots)

    this.tileManager.reset()
  }

  /** Cancel an in-progress stroke. */
  cancelStroke() {
    this.strokeActive = false
    this.undoManager.cancelOperation()
    this.tileManager.reset()
  }

  /**
   * Extract pixel data for all dirty tiles from the active layer texture.
   * Returns snapshots that can be stored for undo/redo.
   */
  private extractTileSnapshots(): TileSnapshot[] {
    if (!this.app || !this.activeLayerTexture) return []

    const dirtyTiles = this.tileManager.getDirtyTiles()
    const snapshots: TileSnapshot[] = []
    const texW = this.activeLayerTexture.width
    const texH = this.activeLayerTexture.height

    for (const tile of dirtyTiles) {
      const px = tile.tx * TILE_SIZE
      const py = tile.ty * TILE_SIZE
      // Clamp to texture bounds
      if (px >= texW || py >= texH || px + TILE_SIZE <= 0 || py + TILE_SIZE <= 0) continue

      const w = Math.min(TILE_SIZE, texW - px)
      const h = Math.min(TILE_SIZE, texH - py)
      if (w <= 0 || h <= 0) continue

      const frame = new Rectangle(px, py, w, h)
      const pixels = this.app.renderer.extract.pixels({
        target: this.activeLayerTexture,
        frame,
      })
      snapshots.push({
        key: `${tile.tx}_${tile.ty}`,
        data: new Uint8Array(pixels.pixels.buffer, pixels.pixels.byteOffset, pixels.pixels.byteLength),
      })
    }

    return snapshots
  }

  /** Render stamp positions to the active layer texture. */
  private renderStamps(stamps: StampPosition[]) {
    if (!this.app || !this.activeLayerTexture || !this.activePreset) return

    const g = this.stampGraphics
    g.clear()

    const r = Math.round(this.color.r * 255)
    const gVal = Math.round(this.color.g * 255)
    const b = Math.round(this.color.b * 255)
    const hexColor = (r << 16) | (gVal << 8) | b

    for (const stamp of stamps) {
      const halfSize = stamp.size / 2

      if (this.activePreset.hardness >= 0.9) {
        // Hard edge — filled circle
        g.circle(stamp.x, stamp.y, halfSize)
        g.fill({ color: hexColor, alpha: stamp.opacity })
      } else {
        // Soft edge — multiple concentric rings with fading alpha
        const rings = Math.max(3, Math.ceil(halfSize / 4))
        for (let i = rings; i >= 0; i--) {
          const t = i / rings
          const radius = halfSize * t
          const alpha = stamp.opacity * (1 - t) * (1 - this.activePreset.hardness)
          if (radius > 0 && alpha > 0.001) {
            g.circle(stamp.x, stamp.y, radius)
            g.fill({ color: hexColor, alpha })
          }
        }
      }
    }

    // For eraser, use destination-out to remove pixels
    if (this.activePreset.isEraser) {
      this.stampContainer.blendMode = 'erase'
    } else {
      this.stampContainer.blendMode = 'normal'
    }

    if (this.alphaLock && !this.activePreset.isEraser) {
      // Alpha lock: paint only where existing layer alpha > 0.
      // 1. Copy current layer to a temp texture (preserves the alpha mask)
      const w = this.activeLayerTexture.width
      const h = this.activeLayerTexture.height
      const maskTex = RenderTexture.create({ width: w, height: h })
      const copySprite = new Sprite(this.activeLayerTexture)
      this.app.renderer.render({ container: copySprite, target: maskTex, clear: true })

      // 2. Render stamps to another temp texture
      const stampTex = RenderTexture.create({ width: w, height: h })
      this.app.renderer.render({ container: this.stampContainer, target: stampTex, clear: true })

      // 3. Mask the stamps by the saved layer alpha
      const stampSprite = new Sprite(stampTex)
      const maskSprite = new Sprite(maskTex)
      stampSprite.mask = maskSprite
      const maskedContainer = new Container()
      maskedContainer.addChild(maskSprite)
      maskedContainer.addChild(stampSprite)

      // 4. Render masked stamps onto the layer (additive, keeping existing content)
      this.app.renderer.render({
        container: maskedContainer,
        target: this.activeLayerTexture,
        clear: false,
      })

      maskTex.destroy(true)
      stampTex.destroy(true)
    } else {
      // Normal / eraser render directly to the layer's FBO
      this.app.renderer.render({
        container: this.stampContainer,
        target: this.activeLayerTexture,
        clear: false,
      })
    }
  }
}
