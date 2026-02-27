import { Graphics, RenderTexture, Sprite, Container, type Application } from 'pixi.js'
import { StrokeSmoother } from './StrokeSmoother.ts'
import { PathInterpolator } from './PathInterpolator.ts'
import { TileManager } from '../layers/TileManager.ts'
import { UndoManager } from '../undo/UndoManager.ts'
import type { LayerSnapshot } from '../undo/UndoManager.ts'
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

  getColor(): RGBAColor {
    return this.color
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

    // Snapshot full layer "before" state
    const beforeSnapshot = this.extractFullLayerSnapshot()
    if (beforeSnapshot) {
      this.undoManager.beginOperation(beforeSnapshot, this.activeLayerId)
    }

    this.tileManager.markDirty(point.x, point.y, this.activePreset.size / 2)
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

    // Snapshot full layer "after" state and commit
    const afterSnapshot = this.extractFullLayerSnapshot()
    if (afterSnapshot) {
      this.undoManager.commitOperation(afterSnapshot)
    }

    this.tileManager.reset()
  }

  /** Cancel an in-progress stroke. */
  cancelStroke() {
    this.strokeActive = false
    this.undoManager.cancelOperation()
    this.tileManager.reset()
  }

  /**
   * Extract full layer pixel data for undo/redo snapshots.
   */
  private extractFullLayerSnapshot(): LayerSnapshot | null {
    if (!this.app || !this.activeLayerTexture) return null

    const w = this.activeLayerTexture.width
    const h = this.activeLayerTexture.height
    const pixels = this.app.renderer.extract.pixels({ target: this.activeLayerTexture })

    return {
      width: w,
      height: h,
      data: new Uint8Array(pixels.pixels.buffer, pixels.pixels.byteOffset, pixels.pixels.byteLength),
    }
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
        // Hard edge with 1.5px anti-aliased falloff
        const feather = Math.min(1.5, halfSize * 0.15)
        const innerRadius = Math.max(0.5, halfSize - feather)
        // Solid core
        g.circle(stamp.x, stamp.y, innerRadius)
        g.fill({ color: hexColor, alpha: stamp.opacity })
        // Anti-aliased edge rings
        const aaSteps = 3
        for (let i = 1; i <= aaSteps; i++) {
          const t = i / aaSteps
          const radius = innerRadius + feather * t
          const alpha = stamp.opacity * (1 - t * 0.8)
          g.circle(stamp.x, stamp.y, radius)
          g.fill({ color: hexColor, alpha })
        }
      } else {
        // Soft edge — multiple concentric rings with fading alpha
        const rings = Math.max(4, Math.ceil(halfSize / 3))
        for (let i = rings; i >= 0; i--) {
          const t = i / rings
          const radius = halfSize * t
          // Remap hardness: at hardness=0 full soft falloff, at hardness=0.89 mostly hard with soft edge
          const hardT = Math.pow(t, 1 + this.activePreset.hardness * 4)
          const alpha = stamp.opacity * (1 - hardT)
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
