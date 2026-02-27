import { type Application, RenderTexture, Texture, Sprite, Container, Filter } from 'pixi.js'
import type { FilterParams } from '@app-types/filter.ts'
import type { LayerSnapshot } from '../undo/UndoManager.ts'
import { createFilterPipeline } from './filterFactory.ts'
import { createGaussianBlurFilters } from '../shaders/filters/gaussianBlurFilter.ts'

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
    if (!this.active || !this.app || !this.layerTexture || !this.originalSnapshot) return

    // Restore original to layer texture first
    this.restoreSnapshot(this.layerTexture, this.originalSnapshot)

    // Create filter pipeline
    const { filters, preBlurRadius } = createFilterPipeline(
      params,
      this.canvasWidth,
      this.canvasHeight,
    )

    // For sharpen: we need to render a blurred version first
    if (preBlurRadius !== undefined && preBlurRadius > 0) {
      this.applySharpenPipeline(filters, preBlurRadius)
    } else {
      this.applyFilterPipeline(filters)
    }

    // Selection masking (CPU post-process): blend filtered with original where mask is 0
    if (this.selectionMask) {
      this.applySelectionMask()
    }

    // Clean up filters
    for (const f of filters) f.destroy()
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

  /** Apply filter(s) to the layer texture using a sprite+filter pipeline. */
  private applyFilterPipeline(filters: Filter[]): void {
    if (!this.app || !this.layerTexture) return

    const sprite = new Sprite(this.layerTexture)
    sprite.filters = filters

    // Render filtered sprite to a temp container, then back to layer texture
    const container = new Container()
    container.addChild(sprite)

    this.app.renderer.render({
      container,
      target: this.layerTexture,
      clear: true,
    })

    container.destroy({ children: true })
  }

  /** Apply sharpen using pre-blur + unsharp mask. */
  private applySharpenPipeline(sharpenFilters: Filter[], blurRadius: number): void {
    if (!this.app || !this.layerTexture) return

    // Step 1: Create blurred version in a temp texture
    const tempTexture = RenderTexture.create({
      width: this.canvasWidth,
      height: this.canvasHeight,
    })

    // Copy layer to temp
    const copySprite = new Sprite(this.layerTexture)
    this.app.renderer.render({
      container: copySprite,
      target: tempTexture,
      clear: true,
    })

    // Apply blur to temp
    const blurFilters = createGaussianBlurFilters(blurRadius, this.canvasWidth, this.canvasHeight)
    const blurSprite = new Sprite(tempTexture)
    blurSprite.filters = blurFilters
    const blurContainer = new Container()
    blurContainer.addChild(blurSprite)
    this.app.renderer.render({
      container: blurContainer,
      target: tempTexture,
      clear: true,
    })
    blurContainer.destroy({ children: true })

    // Step 2: Apply unsharp mask with blurred texture
    // Set the blur texture uniform on the sharpen filter
    const sharpenFilter = sharpenFilters[0]
    const res = sharpenFilter.resources.sharpenUniforms as any
    if (res) {
      const u = res.uniforms ?? res
      if (u.uBlurTexture) u.uBlurTexture.value = tempTexture
    }

    this.applyFilterPipeline(sharpenFilters)

    // Clean up
    for (const f of blurFilters) f.destroy()
    tempTexture.destroy(true)
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
