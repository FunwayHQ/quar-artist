import { Graphics, RenderTexture, Sprite, Container, type Application } from 'pixi.js'
import { StrokeSmoother } from './StrokeSmoother.ts'
import { PathInterpolator } from './PathInterpolator.ts'
import { TileManager } from '../layers/TileManager.ts'
import { UndoManager } from '../undo/UndoManager.ts'
import { PerfMonitor } from '../perf/PerfMonitor.ts'
import type { SymmetryEngine } from '../guides/SymmetryEngine.ts'
import type { LayerSnapshot } from '../undo/UndoManager.ts'
import { evaluatePressureCurve, LINEAR_CURVE } from './PressureCurve.ts'
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
  private eraserMode: boolean = false
  private strokeActive = false
  private color: RGBAColor = { r: 1, g: 1, b: 1, a: 1 }

  /** Cached post-stroke snapshot per layer — avoids redundant GPU readbacks. */
  private lastSnapshot = new Map<string, LayerSnapshot>()

  /** Symmetry engine — when set, stamps are mirrored across symmetry axes. */
  symmetryEngine: SymmetryEngine | null = null

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
    if (id !== this.activeLayerId) {
      this.lastSnapshot.delete(this.activeLayerId)
    }
    this.activeLayerId = id
  }

  /** Clear cached snapshots (call on undo/redo, layer delete, import). */
  clearSnapshotCache(): void {
    this.lastSnapshot.clear()
  }

  /** Set whether the active layer has alpha lock enabled. */
  setAlphaLock(locked: boolean) {
    this.alphaLock = locked
  }

  /** Set eraser mode (based on active tool, independent of preset). */
  setEraserMode(enabled: boolean) {
    this.eraserMode = enabled
  }

  /** Called on pointerdown — begin a new stroke. */
  beginStroke(point: StrokePoint) {
    if (!this.activePreset || !this.activeLayerTexture || !this.app) return
    PerfMonitor.mark('stroke-begin')

    this.strokeActive = true
    this.smoother.reset()
    this.interpolator.reset()
    this.tileManager.reset()

    // Snapshot full layer "before" state — reuse cached post-stroke snapshot if available
    const cached = this.lastSnapshot.get(this.activeLayerId)
    let beforeSnapshot: LayerSnapshot | null
    if (cached) {
      beforeSnapshot = cached
    } else {
      PerfMonitor.mark('snapshot-extract-start')
      beforeSnapshot = this.extractFullLayerSnapshot()
      PerfMonitor.measure('gpu-readback', 'snapshot-extract-start')
    }
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
    PerfMonitor.mark('snapshot-extract-start')
    const afterSnapshot = this.extractFullLayerSnapshot()
    PerfMonitor.measure('gpu-readback', 'snapshot-extract-start')
    if (afterSnapshot) {
      this.undoManager.commitOperation(afterSnapshot)
      // Cache for next stroke's "before" snapshot
      this.lastSnapshot.set(this.activeLayerId, afterSnapshot)
    }

    this.tileManager.reset()
    PerfMonitor.measure('stroke-total', 'stroke-begin')
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
      data: new Uint8Array(pixels.pixels.buffer.slice(pixels.pixels.byteOffset, pixels.pixels.byteOffset + pixels.pixels.byteLength)),
    }
  }

  /** Get accumulated points from the current stroke (for QuickShape). */
  getLastStrokePoints(): StrokePoint[] {
    return this.interpolator.getAccumulatedPoints()
  }

  /** Destroy GPU resources held by the brush engine. */
  destroy() {
    this.stampGraphics.destroy?.()
    this.stampContainer.destroy?.()
    this.lastSnapshot.clear()
    this.activeLayerTexture = null
    this.app = null
  }

  /** Render stamp positions to the active layer texture. */
  private renderStamps(stamps: StampPosition[]) {
    if (!this.app || !this.activeLayerTexture || !this.activePreset) return

    // Apply symmetry mirroring if enabled
    const allStamps = this.symmetryEngine?.getMirroredStamps(stamps) ?? stamps

    const g = this.stampGraphics
    g.clear()

    const r = Math.round(this.color.r * 255)
    const gVal = Math.round(this.color.g * 255)
    const b = Math.round(this.color.b * 255)
    const hexColor = (r << 16) | (gVal << 8) | b

    for (const stamp of allStamps) {
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
    const isErasing = this.eraserMode || this.activePreset.isEraser
    if (isErasing) {
      this.stampContainer.blendMode = 'erase'
    } else {
      this.stampContainer.blendMode = 'normal'
    }

    if (this.alphaLock && !isErasing) {
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

      // Destroy temp GPU resources to prevent leaks
      maskedContainer.destroy()
      stampSprite.destroy()
      maskSprite.destroy()
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
