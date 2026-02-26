import { RenderTexture, Sprite, Container, type Application } from 'pixi.js'
import type { Layer } from './LayerManager.ts'
import type { BlendMode } from '../../types/layer.ts'

/**
 * Composites all visible layers bottom-to-top onto the output RenderTexture.
 * Uses PixiJS built-in blend modes for all 8 supported modes.
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
  }

  /** Get the sprite that displays the composited result. Add to stage. */
  getOutputSprite(): Sprite | null {
    return this.outputSprite
  }

  /** Get the output texture for reading. */
  getOutputTexture(): RenderTexture | null {
    return this.outputTexture
  }

  /**
   * Composite all visible layers bottom-to-top.
   * Call after every stroke completion, layer change, or metadata update.
   */
  composite(layers: readonly Layer[]) {
    if (!this.app || !this.outputTexture) return

    // Clear composite container
    this.compositeContainer.removeChildren()

    // Add visible layers bottom-to-top
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (!layer.info.visible) continue

      // Clone sprite for compositing (don't modify the source sprite)
      const layerSprite = new Sprite(layer.texture)
      layerSprite.alpha = layer.info.opacity
      layerSprite.blendMode = PIXI_BLEND_MAP[layer.info.blendMode] ?? 'normal'

      // Clipping mask: only show where the layer below has content
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

    // Render to output
    this.app.renderer.render({
      container: this.compositeContainer,
      target: this.outputTexture,
      clear: true,
    })
  }

  destroy() {
    if (this.outputTexture) {
      this.outputTexture.destroy(true)
      this.outputTexture = null
    }
    this.outputSprite = null
    this.compositeContainer.removeChildren()
    this.app = null
  }
}
