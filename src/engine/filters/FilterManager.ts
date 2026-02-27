import { type Application, RenderTexture, Texture, Sprite, Container, Filter } from 'pixi.js'
import type { FilterParams, SharpenParams, CurvesParams } from '@app-types/filter.ts'
import type { LayerSnapshot } from '../undo/UndoManager.ts'
import { createFilterPipeline } from './filterFactory.ts'
import { cpuUnsharpMask } from '../shaders/filters/sharpenFilter.ts'
import { cpuApplyCurves } from '../shaders/filters/curvesFilter.ts'

/**
 * Non-destructive filter preview system.
 * Stores original layer snapshot, applies filters to a preview,
 * and can apply or cancel.
 */
export class FilterManager {
  private app: Application | null = null
  private originalSnapshot: LayerSnapshot | null = null
  private layerTexture: RenderTexture | null = null
  private layerId: string | null = null
  private selectionMask: Uint8Array | null = null
  private canvasWidth = 0
  private canvasHeight = 0
  private active = false

  setApp(app: Application) {
    this.app = app
  }

  isActive(): boolean {
    return this.active
  }

  /**
   * Begin a filter preview session.
   * Stores the original layer data so we can restore on cancel.
   */
  beginPreview(
    layerTexture: RenderTexture,
    layerId: string,
    snapshot: LayerSnapshot,
    selectionMask: Uint8Array | null,
    width: number,
    height: number,
  ): void {
    this.layerTexture = layerTexture
    this.layerId = layerId
    this.originalSnapshot = snapshot
    this.selectionMask = selectionMask
    this.canvasWidth = width
    this.canvasHeight = height
    this.active = true
  }

  /**
   * Update the preview with new filter parameters.
   * Restores original snapshot to layer texture, then applies the filter pipeline.
   */
  updatePreview(params: FilterParams): void {
    if (!this.active || !this.app || !this.layerTexture || !this.originalSnapshot) {
      return
    }

    // Restore original to layer texture first
    this.restoreSnapshot(this.layerTexture, this.originalSnapshot)

    // Create filter pipeline
    const pipeline = createFilterPipeline(
      params,
      this.canvasWidth,
      this.canvasHeight,
    )

    if (pipeline.cpuOperation === 'sharpen') {
      // Sharpen: GPU blur + CPU unsharp mask
      this.applySharpenCPU(pipeline.filters, pipeline.cpuParams as SharpenParams)
    } else if (pipeline.cpuOperation === 'curves') {
      // Curves: fully CPU-based LUT application
      this.applyCurvesCPU(pipeline.cpuParams as CurvesParams)
    } else if (pipeline.filters.length > 0) {
      // GPU-based filters (Gaussian Blur, HSB Adjustment)
      this.applyFilterPipeline(pipeline.filters)
    }

    // Selection masking (CPU post-process): blend filtered with original where mask is 0
    if (this.selectionMask) {
      this.applySelectionMask()
    }

    // Clean up GPU filters
    for (const f of pipeline.filters) f.destroy()
  }

  /**
   * Apply the filter permanently. Returns before/after snapshots for undo.
   */
  apply(): { before: LayerSnapshot; after: LayerSnapshot; layerId: string } | null {
    if (!this.active || !this.app || !this.layerTexture || !this.originalSnapshot || !this.layerId) {
      return null
    }

    const before = this.originalSnapshot
    const after = this.extractSnapshot(this.layerTexture)

    this.cleanup()
    return { before, after, layerId: this.layerId! }
  }

  /**
   * Cancel the filter and restore the original layer.
   */
  cancel(): void {
    if (!this.active || !this.app || !this.layerTexture || !this.originalSnapshot) {
      this.cleanup()
      return
    }

    this.restoreSnapshot(this.layerTexture, this.originalSnapshot)
    this.cleanup()
  }

  private cleanup(): void {
    this.originalSnapshot = null
    this.layerTexture = null
    this.selectionMask = null
    this.active = false
    // Keep layerId until after apply() returns it
  }

  /** Apply GPU filter(s) to the layer texture using a sprite+filter pipeline. */
  private applyFilterPipeline(filters: Filter[]): void {
    if (!this.app || !this.layerTexture || filters.length === 0) return

    // WebGPU forbids reading and writing the same texture in one pass.
    // Use a temp RenderTexture as intermediate: layerTexture → temp → layerTexture.
    const tempTexture = RenderTexture.create({
      width: this.canvasWidth,
      height: this.canvasHeight,
    })

    // Pass 1: render filtered layer into temp texture
    const sprite = new Sprite(this.layerTexture)
    sprite.filters = filters
    const container = new Container()
    container.addChild(sprite)

    this.app.renderer.render({
      container,
      target: tempTexture,
      clear: true,
    })
    container.destroy({ children: true })

    // Pass 2: copy temp back to layer texture
    const copySprite = new Sprite(tempTexture)
    this.app.renderer.render({
      container: copySprite,
      target: this.layerTexture,
      clear: true,
    })
    copySprite.destroy()
    tempTexture.destroy(true)
  }

  /**
   * Apply sharpen using GPU blur + CPU unsharp mask.
   * Custom GLSL shaders don't auto-transpile to WGSL, so the unsharp mask is done on CPU.
   */
  private applySharpenCPU(blurFilters: Filter[], params: SharpenParams): void {
    if (!this.app || !this.layerTexture || !this.originalSnapshot) return

    // Step 1: Apply blur to the layer texture using GPU
    this.applyFilterPipeline(blurFilters)

    // Step 2: Extract the blurred pixels
    const blurredSnapshot = this.extractSnapshot(this.layerTexture)

    // Step 3: CPU unsharp mask: original + amount * (original - blurred)
    const result = cpuUnsharpMask(
      this.originalSnapshot.data,
      blurredSnapshot.data,
      params.amount,
      params.threshold,
    )

    // Step 4: Restore the sharpened result to the layer texture
    const sharpened: LayerSnapshot = {
      width: this.originalSnapshot.width,
      height: this.originalSnapshot.height,
      data: result,
    }
    this.restoreSnapshot(this.layerTexture, sharpened)
  }

  /**
   * Apply curves using CPU-based LUT lookup.
   * Custom GLSL shaders don't auto-transpile to WGSL, so curves are computed on CPU.
   */
  private applyCurvesCPU(params: CurvesParams): void {
    if (!this.app || !this.layerTexture || !this.originalSnapshot) return

    const result = cpuApplyCurves(this.originalSnapshot.data, params.channels)

    const curved: LayerSnapshot = {
      width: this.originalSnapshot.width,
      height: this.originalSnapshot.height,
      data: result,
    }
    this.restoreSnapshot(this.layerTexture, curved)
  }

  /** CPU-side selection mask blend: only keep filtered pixels where mask > 0. */
  private applySelectionMask(): void {
    if (!this.app || !this.layerTexture || !this.originalSnapshot || !this.selectionMask) return

    const filtered = this.extractSnapshot(this.layerTexture)
    const original = this.originalSnapshot.data
    const mask = this.selectionMask
    const result = new Uint8Array(filtered.data.length)

    for (let i = 0; i < mask.length; i++) {
      const maskWeight = mask[i] / 255
      const pi = i * 4
      result[pi] = Math.round(original[pi] * (1 - maskWeight) + filtered.data[pi] * maskWeight)
      result[pi + 1] = Math.round(original[pi + 1] * (1 - maskWeight) + filtered.data[pi + 1] * maskWeight)
      result[pi + 2] = Math.round(original[pi + 2] * (1 - maskWeight) + filtered.data[pi + 2] * maskWeight)
      result[pi + 3] = Math.round(original[pi + 3] * (1 - maskWeight) + filtered.data[pi + 3] * maskWeight)
    }

    const blended: LayerSnapshot = {
      width: filtered.width,
      height: filtered.height,
      data: result,
    }
    this.restoreSnapshot(this.layerTexture, blended)
  }

  /** Extract pixel data from a RenderTexture as a LayerSnapshot. */
  private extractSnapshot(texture: RenderTexture): LayerSnapshot {
    if (!this.app) {
      return { width: 0, height: 0, data: new Uint8Array(0) }
    }

    const extracted = this.app.renderer.extract.pixels({ target: texture })
    return {
      width: extracted.width,
      height: extracted.height,
      data: new Uint8Array(
        extracted.pixels.buffer,
        extracted.pixels.byteOffset,
        extracted.pixels.byteLength,
      ),
    }
  }

  /** Restore a LayerSnapshot to a RenderTexture. */
  private restoreSnapshot(layerTexture: RenderTexture, snapshot: LayerSnapshot): void {
    if (!this.app) return

    const { width: w, height: h, data } = snapshot
    if (w <= 0 || h <= 0) return

    const expectedLen = w * h * 4
    if (data.length < expectedLen) return

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

    const tex = Texture.from(canvas)
    const sprite = new Sprite(tex)
    this.app.renderer.render({
      container: sprite,
      target: layerTexture,
      clear: true,
    })
    tex.destroy(true)
  }

  destroy(): void {
    this.cleanup()
    this.app = null
    this.layerId = null
  }
}
