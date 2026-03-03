import { RenderTexture, Sprite, Container, Texture, type Application } from 'pixi.js'
import type { Layer } from './LayerManager.ts'
import type { BlendMode } from '../../types/layer.ts'
import { CUSTOM_BLEND_MODES } from '../shaders/blend/blendFilters.ts'
import { cpuBlendLayers } from '../shaders/blend/cpuBlend.ts'
import { PerfMonitor } from '../perf/PerfMonitor.ts'

/**
 * Composites all visible layers bottom-to-top onto the output RenderTexture.
 * Uses PixiJS built-in blend modes for all 8 supported modes.
 *
 * Dirty-layer caching: caches the composite of layers below the active layer
 * so that during painting fewer draws are needed (1 + active + foreground vs N).
 */

/** Map our BlendMode type to PixiJS blend mode strings.
 *  Modes with native PixiJS support map directly.
 *  Custom shader modes (vividLight, linearLight, etc.) fall back to 'normal'
 *  here — the compositor detects them and uses the filter pipeline instead.
 */
const PIXI_BLEND_MAP: Record<BlendMode, string> = {
  normal: 'normal',
  // Darken group
  darken: 'darken',
  multiply: 'multiply',
  colorBurn: 'color-burn',
  // Lighten group
  lighten: 'lighten',
  screen: 'screen',
  colorDodge: 'color-dodge',
  add: 'add',
  // Contrast group
  overlay: 'overlay',
  softLight: 'soft-light',
  hardLight: 'hard-light',
  vividLight: 'normal',    // custom shader
  linearLight: 'normal',   // custom shader
  pinLight: 'normal',      // custom shader
  hardMix: 'normal',       // custom shader
  // Comparative group
  difference: 'difference',
  exclusion: 'exclusion',
  subtract: 'normal',      // custom shader
  divide: 'normal',        // custom shader
  // Component group
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  // Special
  darkerColor: 'normal',   // custom shader
  lighterColor: 'normal',  // custom shader
  dissolve: 'normal',      // custom shader
}
export class LayerCompositor {
  private app: Application | null = null
  private outputTexture: RenderTexture | null = null
  private outputSprite: Sprite | null = null
  private compositeContainer = new Container()

  // ── Sprite pool ──
  // Reuse Sprite instances to avoid per-frame allocations
  private spritePool: Sprite[] = []
  private spritePoolIdx = 0

  // ── Dirty-layer caching ──
  // Only the background (layers below active) is cached. Foreground layers
  // must be composited individually because non-normal blend modes and partial
  // opacity require the actual content below (not a transparent background).
  private cachedBackground: RenderTexture | null = null
  private cacheActiveLayerId: string = ''
  private cacheDirty = true
  private cachedLayers: readonly Layer[] = []

  /** Get a sprite from the pool (or create one). */
  private acquireSprite(texture: RenderTexture): Sprite {
    if (this.spritePoolIdx < this.spritePool.length) {
      const sprite = this.spritePool[this.spritePoolIdx++]
      sprite.texture = texture
      sprite.alpha = 1
      sprite.blendMode = 'normal'
      sprite.mask = null
      return sprite
    }
    const sprite = new Sprite(texture)
    this.spritePool.push(sprite)
    this.spritePoolIdx++
    return sprite
  }

  /** Reset pool index for next composite pass. */
  private resetSpritePool() {
    this.spritePoolIdx = 0
  }

  setApp(app: Application) {
    this.app = app
  }

  /** Create or resize the output composite texture. */
  setSize(width: number, height: number) {
    if (this.outputTexture) {
      this.outputTexture.destroy(true)
    }
    this.outputTexture = RenderTexture.create({ width, height })
    if (this.outputSprite) {
      this.outputSprite.texture = this.outputTexture
    } else {
      this.outputSprite = new Sprite(this.outputTexture)
    }
    this.destroyCacheTextures()
    this.cacheDirty = true
  }

  /** Get the sprite that displays the composited result. Add to stage. */
  getOutputSprite(): Sprite | null {
    return this.outputSprite
  }

  /** Get the output texture for reading. */
  getOutputTexture(): RenderTexture | null {
    return this.outputTexture
  }

  /** Mark the cache as dirty — must be rebuilt on next composite. */
  invalidateCache(): void {
    this.cacheDirty = true
  }

  /**
   * Composite all visible layers bottom-to-top.
   * Uses cached background/foreground when the cache is clean (fast path).
   */
  composite(layers: readonly Layer[]) {
    if (!this.app || !this.outputTexture) return
    PerfMonitor.mark('composite-start')

    this.cachedLayers = layers

    // Find the active layer index (the one being painted on)
    const activeIdx = this.findActiveLayerIndex(layers)

    // Determine if we can use the fast path
    if (!this.cacheDirty && activeIdx >= 0 && this.cachedBackground) {
      this.compositeFastPath(layers, activeIdx)
    } else {
      // Full recomposite & rebuild cache
      this.compositeFullAndCache(layers, activeIdx)
    }

    PerfMonitor.measure('composite', 'composite-start')
  }

  /**
   * Fast path: render cached background + active layer + foreground layers.
   * Saves (activeIdx) draws by using the background cache, while foreground
   * layers are composited individually for correct blend mode behavior.
   */
  private compositeFastPath(layers: readonly Layer[], activeIdx: number) {
    if (!this.app || !this.outputTexture || !this.cachedBackground) return

    this.compositeContainer.removeChildren()
    this.resetSpritePool()

    // Background cache (all layers below active)
    const bgSprite = this.acquireSprite(this.cachedBackground)
    this.compositeContainer.addChild(bgSprite)

    // Active layer
    const activeLayer = layers[activeIdx]
    if (activeLayer.info.visible) {
      const activeSprite = this.acquireSprite(activeLayer.texture)
      activeSprite.alpha = activeLayer.info.opacity
      activeSprite.blendMode = PIXI_BLEND_MAP[activeLayer.info.blendMode] ?? 'normal'
      this.compositeContainer.addChild(activeSprite)
    }

    // Foreground layers composited individually (correct blend mode behavior)
    // Check if any foreground layer uses a custom blend mode
    let hasFgCustom = false
    for (let i = activeIdx + 1; i < layers.length; i++) {
      if (layers[i].info.visible && CUSTOM_BLEND_MODES.has(layers[i].info.blendMode) && !layers[i].info.clippingMask) {
        hasFgCustom = true
        break
      }
    }

    if (hasFgCustom) {
      // Render bg + active to output first, then handle foreground incrementally
      this.app.renderer.render({
        container: this.compositeContainer,
        target: this.outputTexture,
        clear: true,
      })
      this.compositeContainer.removeChildren()
      this.resetSpritePool()

      for (let i = activeIdx + 1; i < layers.length; i++) {
        const layer = layers[i]
        if (!layer.info.visible) continue

        if (CUSTOM_BLEND_MODES.has(layer.info.blendMode) && !layer.info.clippingMask) {
          // Flush any pending GPU layers
          if (this.compositeContainer.children.length > 0) {
            const w = this.outputTexture.width
            const h = this.outputTexture.height
            const tempTex = RenderTexture.create({ width: w, height: h })
            this.app.renderer.render({
              container: this.compositeContainer,
              target: tempTex,
              clear: true,
            })
            const tempSprite = new Sprite(tempTex)
            this.app.renderer.render({
              container: tempSprite,
              target: this.outputTexture,
              clear: false,
            })
            tempSprite.destroy()
            tempTex.destroy(true)
            this.compositeContainer.removeChildren()
            this.resetSpritePool()
          }
          this.cpuBlendLayer(layer, this.outputTexture)
        } else {
          const layerSprite = this.acquireSprite(layer.texture)
          layerSprite.alpha = layer.info.opacity
          layerSprite.blendMode = PIXI_BLEND_MAP[layer.info.blendMode] ?? 'normal'

          if (layer.info.clippingMask && i > 0) {
            const baseLayer = layers[i - 1]
            if (baseLayer.info.visible) {
              const maskSprite = this.acquireSprite(baseLayer.texture)
              layerSprite.mask = maskSprite
              this.compositeContainer.addChild(maskSprite)
            }
          }
          this.compositeContainer.addChild(layerSprite)
        }
      }

      // Flush remaining GPU foreground layers
      if (this.compositeContainer.children.length > 0) {
        const w = this.outputTexture.width
        const h = this.outputTexture.height
        const tempTex = RenderTexture.create({ width: w, height: h })
        this.app.renderer.render({
          container: this.compositeContainer,
          target: tempTex,
          clear: true,
        })
        const tempSprite = new Sprite(tempTex)
        this.app.renderer.render({
          container: tempSprite,
          target: this.outputTexture,
          clear: false,
        })
        tempSprite.destroy()
        tempTex.destroy(true)
      }
    } else {
      for (let i = activeIdx + 1; i < layers.length; i++) {
        const layer = layers[i]
        if (!layer.info.visible) continue

        const layerSprite = this.acquireSprite(layer.texture)
        layerSprite.alpha = layer.info.opacity
        layerSprite.blendMode = PIXI_BLEND_MAP[layer.info.blendMode] ?? 'normal'

        if (layer.info.clippingMask && i > 0) {
          const baseLayer = layers[i - 1]
          if (baseLayer.info.visible) {
            const maskSprite = this.acquireSprite(baseLayer.texture)
            layerSprite.mask = maskSprite
            this.compositeContainer.addChild(maskSprite)
          }
        }

        this.compositeContainer.addChild(layerSprite)
      }

      this.app.renderer.render({
        container: this.compositeContainer,
        target: this.outputTexture,
        clear: true,
      })
    }
  }

  /**
   * Full composite: renders all layers and rebuilds the cache textures.
   */
  private compositeFullAndCache(layers: readonly Layer[], activeIdx: number) {
    if (!this.app || !this.outputTexture) return

    // Check if any visible layer uses a custom blend mode
    const hasCustomBlend = layers.some(
      l => l.info.visible && CUSTOM_BLEND_MODES.has(l.info.blendMode) && !l.info.clippingMask,
    )

    this.compositeContainer.removeChildren()
    this.resetSpritePool()

    if (hasCustomBlend) {
      // Incremental composite: GPU layers are batched, custom layers flush & CPU blend
      this.compositeIncrementally(layers)
    } else {
      // Fast path: all layers use GPU-native blend modes
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]
        if (!layer.info.visible) continue

        const layerSprite = this.acquireSprite(layer.texture)
        layerSprite.alpha = layer.info.opacity
        layerSprite.blendMode = PIXI_BLEND_MAP[layer.info.blendMode] ?? 'normal'

        if (layer.info.clippingMask && i > 0) {
          const baseLayer = layers[i - 1]
          if (baseLayer.info.visible) {
            const maskSprite = this.acquireSprite(baseLayer.texture)
            layerSprite.mask = maskSprite
            this.compositeContainer.addChild(maskSprite)
          }
        }

        this.compositeContainer.addChild(layerSprite)
      }

      this.app.renderer.render({
        container: this.compositeContainer,
        target: this.outputTexture,
        clear: true,
      })
    }

    // Always rebuild background cache to prevent stale content in fast path
    // (e.g. after merge-down leaves a single layer, old cache must be cleared)
    if (activeIdx >= 0) {
      this.rebuildCache(layers, activeIdx)
    } else {
      this.destroyCacheTextures()
    }

    this.cacheDirty = false
  }

  /**
   * Build background cache (layers below active).
   * Foreground layers are composited individually in the fast path
   * to ensure correct blend mode behavior.
   */
  private rebuildCache(layers: readonly Layer[], activeIdx: number) {
    if (!this.app || !this.outputTexture) return

    const w = this.outputTexture.width
    const h = this.outputTexture.height

    // Destroy old cache texture
    this.destroyCacheTextures()

    const emptyContainer = new Container()

    // Background: layers 0..activeIdx-1
    this.cachedBackground = RenderTexture.create({ width: w, height: h })
    const bgContainer = new Container()
    let hasBgLayers = false
    for (let i = 0; i < activeIdx; i++) {
      const layer = layers[i]
      if (!layer.info.visible) continue
      const s = this.acquireSprite(layer.texture)
      s.alpha = layer.info.opacity
      s.blendMode = PIXI_BLEND_MAP[layer.info.blendMode] ?? 'normal'
      if (layer.info.clippingMask && i > 0) {
        const baseLayer = layers[i - 1]
        if (baseLayer.info.visible) {
          const maskSprite = this.acquireSprite(baseLayer.texture)
          s.mask = maskSprite
          bgContainer.addChild(maskSprite)
        }
      }
      bgContainer.addChild(s)
      hasBgLayers = true
    }
    if (hasBgLayers) {
      this.app.renderer.render({ container: bgContainer, target: this.cachedBackground, clear: true })
    } else {
      this.app.renderer.render({ container: emptyContainer, target: this.cachedBackground, clear: true })
    }

    this.cacheActiveLayerId = layers[activeIdx].info.id
  }

  /**
   * Find the index of the active layer — the one currently tracked by the cache.
   * Returns -1 if not found or if the active layer changed (triggers cache rebuild).
   */
  private findActiveLayerIndex(layers: readonly Layer[]): number {
    if (!this.cacheActiveLayerId) return -1
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].info.id === this.cacheActiveLayerId) return i
    }
    return -1
  }

  /** Set which layer is being painted on (for cache identification). */
  setActiveLayerId(layerId: string): void {
    if (layerId !== this.cacheActiveLayerId) {
      this.cacheActiveLayerId = layerId
      this.cacheDirty = true
    }
  }

  /**
   * Incremental composite for layers that include custom blend modes.
   * GPU-blendable layers are batched; custom layers flush the batch and CPU-blend.
   */
  private compositeIncrementally(layers: readonly Layer[]) {
    if (!this.app || !this.outputTexture) return

    let outputInitialized = false

    const flushGpuBatch = () => {
      if (this.compositeContainer.children.length === 0) return
      if (!this.app || !this.outputTexture) return

      if (!outputInitialized) {
        // First batch — clear the output
        this.app.renderer.render({
          container: this.compositeContainer,
          target: this.outputTexture,
          clear: true,
        })
        outputInitialized = true
      } else {
        // Subsequent batches — render to temp, then composite onto output
        const w = this.outputTexture.width
        const h = this.outputTexture.height
        const tempTex = RenderTexture.create({ width: w, height: h })
        this.app.renderer.render({
          container: this.compositeContainer,
          target: tempTex,
          clear: true,
        })
        const tempSprite = new Sprite(tempTex)
        this.app.renderer.render({
          container: tempSprite,
          target: this.outputTexture,
          clear: false,
        })
        tempSprite.destroy()
        tempTex.destroy(true)
      }

      this.compositeContainer.removeChildren()
      this.resetSpritePool()
    }

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (!layer.info.visible) continue

      if (CUSTOM_BLEND_MODES.has(layer.info.blendMode) && !layer.info.clippingMask) {
        // Flush pending GPU layers
        flushGpuBatch()

        if (!outputInitialized) {
          // No GPU layers before this — clear output first
          const emptyContainer = new Container()
          this.app.renderer.render({
            container: emptyContainer,
            target: this.outputTexture,
            clear: true,
          })
          outputInitialized = true
        }

        // CPU blend this layer
        this.cpuBlendLayer(layer, this.outputTexture)
      } else {
        // GPU-blendable layer — accumulate in container
        const layerSprite = this.acquireSprite(layer.texture)
        layerSprite.alpha = layer.info.opacity
        layerSprite.blendMode = PIXI_BLEND_MAP[layer.info.blendMode] ?? 'normal'

        if (layer.info.clippingMask && i > 0) {
          const baseLayer = layers[i - 1]
          if (baseLayer.info.visible) {
            const maskSprite = this.acquireSprite(baseLayer.texture)
            layerSprite.mask = maskSprite
            this.compositeContainer.addChild(maskSprite)
          }
        }

        this.compositeContainer.addChild(layerSprite)
      }
    }

    // Flush remaining GPU layers
    flushGpuBatch()

    if (!outputInitialized) {
      // No visible layers — clear to transparent
      const emptyContainer = new Container()
      this.app.renderer.render({
        container: emptyContainer,
        target: this.outputTexture,
        clear: true,
      })
    }
  }

  /**
   * Apply a custom blend mode layer via CPU blending.
   * Extracts current composite pixels, extracts layer pixels,
   * blends them on CPU, and renders the result back.
   */
  private cpuBlendLayer(
    layer: Layer,
    targetTexture: RenderTexture,
  ) {
    if (!this.app) return

    const w = targetTexture.width
    const h = targetTexture.height

    // Guard: extraction requires renderer.extract (not available in test/mock environments)
    if (!this.app.renderer.extract?.pixels) {
      // Fall back to normal composite (custom blend treated as normal)
      const fallbackSprite = new Sprite(layer.texture)
      fallbackSprite.alpha = layer.info.opacity
      this.app.renderer.render({ container: fallbackSprite, target: targetTexture, clear: false })
      fallbackSprite.destroy?.()
      return
    }

    // Extract current composite pixels
    const dstExtract = this.app.renderer.extract.pixels({ target: targetTexture })
    if (!dstExtract?.pixels) {
      const fallbackSprite = new Sprite(layer.texture)
      fallbackSprite.alpha = layer.info.opacity
      this.app.renderer.render({ container: fallbackSprite, target: targetTexture, clear: false })
      fallbackSprite.destroy?.()
      return
    }
    const dstPixels = new Uint8ClampedArray(
      dstExtract.pixels.buffer,
      dstExtract.pixels.byteOffset,
      dstExtract.pixels.byteLength,
    )

    // Extract layer pixels
    const srcExtract = this.app.renderer.extract.pixels({ target: layer.texture })
    if (!srcExtract?.pixels) {
      const fallbackSprite = new Sprite(layer.texture)
      fallbackSprite.alpha = layer.info.opacity
      this.app.renderer.render({ container: fallbackSprite, target: targetTexture, clear: false })
      fallbackSprite.destroy?.()
      return
    }
    const srcPixels = new Uint8ClampedArray(
      srcExtract.pixels.buffer,
      srcExtract.pixels.byteOffset,
      srcExtract.pixels.byteLength,
    )

    // CPU blend
    const blended = cpuBlendLayers(srcPixels, dstPixels, layer.info.blendMode, layer.info.opacity)

    // Write result back to a canvas, then to texture
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imageData = new ImageData(blended, w, h)
    ctx.putImageData(imageData, 0, 0)

    // Render canvas texture onto target
    const resultTex = Texture.from(canvas)
    const resultSprite = new Sprite(resultTex)

    this.app.renderer.render({
      container: resultSprite,
      target: targetTexture,
      clear: true,
    })

    resultSprite.destroy()
    resultTex.destroy(true)
  }

  private destroyCacheTextures() {
    if (this.cachedBackground) {
      this.cachedBackground.destroy(true)
      this.cachedBackground = null
    }
  }

  destroy() {
    this.destroyCacheTextures()
    if (this.outputTexture) {
      this.outputTexture.destroy(true)
      this.outputTexture = null
    }
    this.outputSprite = null
    this.compositeContainer.removeChildren()
    // Destroy pooled sprites
    for (const sprite of this.spritePool) {
      sprite.destroy?.()
    }
    this.spritePool = []
    this.spritePoolIdx = 0
    this.cachedLayers = []
    this.app = null
  }
}
