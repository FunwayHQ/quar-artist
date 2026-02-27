import { RenderTexture, Sprite, Container, type Application } from 'pixi.js'
import type { Layer } from './LayerManager.ts'
import type { BlendMode } from '../../types/layer.ts'
import { PerfMonitor } from '../perf/PerfMonitor.ts'

/**
 * Composites all visible layers bottom-to-top onto the output RenderTexture.
 * Uses PixiJS built-in blend modes for all 8 supported modes.
 *
 * Dirty-layer caching: caches the composite of layers below the active layer
 * so that during painting fewer draws are needed (1 + active + foreground vs N).
 */

/** Map our BlendMode type to PixiJS blend mode strings. */
const PIXI_BLEND_MAP: Record<BlendMode, string> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  softLight: 'soft-light',
  add: 'add',
  color: 'color',
  luminosity: 'luminosity',
}
export class LayerCompositor {
  private app: Application | null = null
  private outputTexture: RenderTexture | null = null
  private outputSprite: Sprite | null = null
  private compositeContainer = new Container()

  // ── Dirty-layer caching ──
  // Only the background (layers below active) is cached. Foreground layers
  // must be composited individually because non-normal blend modes and partial
  // opacity require the actual content below (not a transparent background).
  private cachedBackground: RenderTexture | null = null
  private cacheActiveLayerId: string = ''
  private cacheDirty = true
  private cachedLayers: readonly Layer[] = []

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

    // Background cache (all layers below active)
    const bgSprite = new Sprite(this.cachedBackground)
    this.compositeContainer.addChild(bgSprite)

    // Active layer
    const activeLayer = layers[activeIdx]
    if (activeLayer.info.visible) {
      const activeSprite = new Sprite(activeLayer.texture)
      activeSprite.alpha = activeLayer.info.opacity
      activeSprite.blendMode = PIXI_BLEND_MAP[activeLayer.info.blendMode] ?? 'normal'
      this.compositeContainer.addChild(activeSprite)
    }

    // Foreground layers composited individually (correct blend mode behavior)
    for (let i = activeIdx + 1; i < layers.length; i++) {
      const layer = layers[i]
      if (!layer.info.visible) continue

      const layerSprite = new Sprite(layer.texture)
      layerSprite.alpha = layer.info.opacity
      layerSprite.blendMode = PIXI_BLEND_MAP[layer.info.blendMode] ?? 'normal'

      if (layer.info.clippingMask && i > 0) {
        const baseLayer = layers[i - 1]
        if (baseLayer.info.visible) {
          const maskSprite = new Sprite(baseLayer.texture)
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

  /**
   * Full composite: renders all layers and rebuilds the cache textures.
   */
  private compositeFullAndCache(layers: readonly Layer[], activeIdx: number) {
    if (!this.app || !this.outputTexture) return

    // Always do the full composite for correctness
    this.compositeContainer.removeChildren()

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (!layer.info.visible) continue

      const layerSprite = new Sprite(layer.texture)
      layerSprite.alpha = layer.info.opacity
      layerSprite.blendMode = PIXI_BLEND_MAP[layer.info.blendMode] ?? 'normal'

      if (layer.info.clippingMask && i > 0) {
        const baseLayer = layers[i - 1]
        if (baseLayer.info.visible) {
          const maskSprite = new Sprite(baseLayer.texture)
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

    // Rebuild background cache if active layer has layers below it
    if (activeIdx > 0) {
      this.rebuildCache(layers, activeIdx)
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
    for (let i = 0; i < activeIdx; i++) {
      const layer = layers[i]
      if (!layer.info.visible) continue
      const s = new Sprite(layer.texture)
      s.alpha = layer.info.opacity
      s.blendMode = PIXI_BLEND_MAP[layer.info.blendMode] ?? 'normal'
      if (layer.info.clippingMask && i > 0) {
        const baseLayer = layers[i - 1]
        if (baseLayer.info.visible) {
          const maskSprite = new Sprite(baseLayer.texture)
          s.mask = maskSprite
          bgContainer.addChild(maskSprite)
        }
      }
      bgContainer.addChild(s)
    }
    if (bgContainer.children.length > 0) {
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
    this.cachedLayers = []
    this.app = null
  }
}
