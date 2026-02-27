import { RenderTexture, Sprite, Container, type Application } from 'pixi.js'
import { TileManager } from './TileManager.ts'
import type { LayerInfo, BlendMode } from '../../types/layer.ts'
import { MAX_LAYERS } from '../../types/layer.ts'

let nextId = 1
function generateLayerId(): string {
  return `layer_${nextId++}`
}

export interface Layer {
  info: LayerInfo
  texture: RenderTexture
  sprite: Sprite
  tileManager: TileManager
}

export type LayerChangeCallback = (layers: LayerInfo[], activeId: string) => void
export type StructuralChangeCallback = () => void

/**
 * Manages multiple painting layers, each backed by a PixiJS RenderTexture.
 * No React — communicates via callback.
 */
export class LayerManager {
  private layers: Layer[] = []
  private activeLayerId: string = ''
  private app: Application | null = null
  private canvasWidth = 1024
  private canvasHeight = 768
  private onChange: LayerChangeCallback | null = null
  private onStructuralChange: StructuralChangeCallback | null = null

  setApp(app: Application) {
    this.app = app
  }

  setSize(width: number, height: number) {
    this.canvasWidth = width
    this.canvasHeight = height
  }

  /**
   * Resize all existing layer textures to new dimensions, preserving content.
   * Content is rendered top-left aligned; areas beyond old size become transparent.
   */
  resizeAllLayers(width: number, height: number) {
    if (!this.app) return
    if (width === this.canvasWidth && height === this.canvasHeight) return

    this.canvasWidth = width
    this.canvasHeight = height

    for (const layer of this.layers) {
      const oldTexture = layer.texture
      const newTexture = RenderTexture.create({ width, height })

      // Clear new texture to transparent
      const emptyContainer = new Container()
      this.app.renderer.render({ container: emptyContainer, target: newTexture, clear: true })

      // Copy old content into new texture (top-left aligned)
      const sprite = new Sprite(oldTexture)
      this.app.renderer.render({ container: sprite, target: newTexture, clear: false })

      layer.texture = newTexture
      layer.sprite.texture = newTexture
      oldTexture.destroy(true)
    }

    this.notifyStructuralChange()
    this.notifyChange()
  }

  setChangeCallback(cb: LayerChangeCallback) {
    this.onChange = cb
  }

  /** Set callback for structural changes (layer add/remove/reorder/visibility/opacity/blend/active change). */
  setStructuralChangeCallback(cb: StructuralChangeCallback) {
    this.onStructuralChange = cb
  }

  /** Initialize with a single default layer. */
  init() {
    if (this.layers.length === 0) {
      this.createLayer('Layer 1')
    }
  }

  /** Create a new layer above the active layer. Returns the new layer's id. */
  createLayer(name?: string): string | null {
    if (this.layers.length >= MAX_LAYERS) return null

    const id = generateLayerId()
    const texture = RenderTexture.create({
      width: this.canvasWidth,
      height: this.canvasHeight,
    })
    // Clear to transparent — GPU memory may be uninitialized
    if (this.app) {
      const emptyContainer = new Container()
      this.app.renderer.render({ container: emptyContainer, target: texture, clear: true })
    }
    const sprite = new Sprite(texture)
    const info: LayerInfo = {
      id,
      name: name ?? `Layer ${this.layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      alphaLock: false,
      clippingMask: false,
      locked: false,
    }
    const layer: Layer = {
      info,
      texture,
      sprite,
      tileManager: new TileManager(),
    }

    // Insert above active layer, or at top if no active
    const activeIdx = this.layers.findIndex((l) => l.info.id === this.activeLayerId)
    const insertIdx = activeIdx >= 0 ? activeIdx + 1 : this.layers.length
    this.layers.splice(insertIdx, 0, layer)
    this.activeLayerId = id
    this.notifyStructuralChange()
    this.notifyChange()
    return id
  }

  /** Delete a layer by id. Cannot delete the last layer. */
  deleteLayer(id: string): boolean {
    if (this.layers.length <= 1) return false
    const idx = this.layers.findIndex((l) => l.info.id === id)
    if (idx < 0) return false

    const [removed] = this.layers.splice(idx, 1)
    removed.texture.destroy(true)

    if (this.activeLayerId === id) {
      // Select the layer below, or the first remaining
      this.activeLayerId = this.layers[Math.max(0, idx - 1)].info.id
    }

    this.notifyStructuralChange()
    this.notifyChange()
    return true
  }

  /** Duplicate a layer. */
  duplicateLayer(id: string): string | null {
    if (this.layers.length >= MAX_LAYERS) return null
    const sourceIdx = this.layers.findIndex((l) => l.info.id === id)
    if (sourceIdx < 0) return null

    const source = this.layers[sourceIdx]
    const newId = generateLayerId()
    const texture = RenderTexture.create({
      width: this.canvasWidth,
      height: this.canvasHeight,
    })

    // Copy pixel data from source to new texture
    if (this.app) {
      this.app.renderer.render({
        container: source.sprite,
        target: texture,
        clear: true,
      })
    }

    const sprite = new Sprite(texture)
    const newLayer: Layer = {
      info: {
        ...source.info,
        id: newId,
        name: `${source.info.name} copy`,
      },
      texture,
      sprite,
      tileManager: new TileManager(),
    }

    this.layers.splice(sourceIdx + 1, 0, newLayer)
    this.activeLayerId = newId
    this.notifyStructuralChange()
    this.notifyChange()
    return newId
  }

  /** Reorder layers. Takes an array of layer ids in the new order (bottom to top). */
  reorderLayers(orderedIds: string[]) {
    const reordered: Layer[] = []
    for (const id of orderedIds) {
      const layer = this.layers.find((l) => l.info.id === id)
      if (layer) reordered.push(layer)
    }
    if (reordered.length === this.layers.length) {
      this.layers = reordered
      this.notifyStructuralChange()
      this.notifyChange()
    }
  }

  /** Merge a layer down onto the layer below it. */
  mergeDown(id: string): boolean {
    const idx = this.layers.findIndex((l) => l.info.id === id)
    if (idx <= 0) return false // Can't merge the bottom layer

    const source = this.layers[idx]
    const target = this.layers[idx - 1]

    if (!this.app) return false

    // Composite source onto target with its opacity
    source.sprite.alpha = source.info.opacity
    this.app.renderer.render({
      container: source.sprite,
      target: target.texture,
      clear: false,
    })
    source.sprite.alpha = 1

    // Remove source layer
    this.layers.splice(idx, 1)
    source.texture.destroy(true)

    this.activeLayerId = target.info.id
    this.notifyStructuralChange()
    this.notifyChange()
    return true
  }

  /** Set the active layer. */
  setActiveLayer(id: string) {
    if (this.layers.find((l) => l.info.id === id)) {
      this.activeLayerId = id
      this.notifyStructuralChange()
      this.notifyChange()
    }
  }

  /** Update layer metadata. */
  updateLayerInfo(id: string, updates: Partial<Omit<LayerInfo, 'id'>>) {
    const layer = this.layers.find((l) => l.info.id === id)
    if (!layer) return
    // Structural changes that affect compositing
    if ('visible' in updates || 'opacity' in updates || 'blendMode' in updates || 'clippingMask' in updates) {
      this.notifyStructuralChange()
    }
    Object.assign(layer.info, updates)
    this.notifyChange()
  }

  /** Set layer visibility. */
  setVisibility(id: string, visible: boolean) {
    this.updateLayerInfo(id, { visible })
  }

  /** Set layer opacity. */
  setLayerOpacity(id: string, opacity: number) {
    this.updateLayerInfo(id, { opacity: Math.max(0, Math.min(1, opacity)) })
  }

  /** Set layer blend mode. */
  setBlendMode(id: string, blendMode: BlendMode) {
    this.updateLayerInfo(id, { blendMode })
  }

  /** Toggle alpha lock. */
  toggleAlphaLock(id: string) {
    const layer = this.layers.find((l) => l.info.id === id)
    if (layer) {
      this.updateLayerInfo(id, { alphaLock: !layer.info.alphaLock })
    }
  }

  /** Toggle clipping mask. */
  toggleClippingMask(id: string) {
    const layer = this.layers.find((l) => l.info.id === id)
    if (layer) {
      this.updateLayerInfo(id, { clippingMask: !layer.info.clippingMask })
    }
  }

  /** Get a layer by id. */
  getLayerById(id: string): Layer | null {
    return this.layers.find((l) => l.info.id === id) ?? null
  }

  /** Get the active layer. */
  getActiveLayer(): Layer | null {
    return this.layers.find((l) => l.info.id === this.activeLayerId) ?? null
  }

  /** Get the active layer's RenderTexture. */
  getActiveTexture(): RenderTexture | null {
    return this.getActiveLayer()?.texture ?? null
  }

  /** Get all layers (bottom to top order). */
  getLayers(): readonly Layer[] {
    return this.layers
  }

  /** Get all layer info objects. */
  getLayerInfos(): LayerInfo[] {
    return this.layers.map((l) => ({ ...l.info }))
  }

  /** Get the active layer id. */
  getActiveLayerId(): string {
    return this.activeLayerId
  }

  /** Get layer count. */
  get count(): number {
    return this.layers.length
  }

  /** Rename a layer. */
  renameLayer(id: string, name: string) {
    this.updateLayerInfo(id, { name })
  }

  /** Generate thumbnails for all layers. Call after stroke completion. */
  updateThumbnails() {
    if (!this.app) return

    const thumbSize = 40
    const thumbTex = RenderTexture.create({ width: thumbSize, height: thumbSize })

    for (const layer of this.layers) {
      const scaleX = thumbSize / this.canvasWidth
      const scaleY = thumbSize / this.canvasHeight
      const layerSprite = new Sprite(layer.texture)
      layerSprite.scale.set(scaleX, scaleY)

      const thumbContainer = new Container()
      thumbContainer.addChild(layerSprite)

      this.app.renderer.render({
        container: thumbContainer,
        target: thumbTex,
        clear: true,
      })

      // Extract to a data URL via canvas
      const pixels = this.app.renderer.extract.pixels({ target: thumbTex })
      const canvas = document.createElement('canvas')
      canvas.width = thumbSize
      canvas.height = thumbSize
      const ctx = canvas.getContext('2d')!
      const imageData = new ImageData(
        new Uint8ClampedArray(pixels.pixels.buffer, pixels.pixels.byteOffset, pixels.pixels.byteLength),
        thumbSize,
        thumbSize,
      )
      ctx.putImageData(imageData, 0, 0)
      layer.info.thumbnail = canvas.toDataURL('image/png')
    }

    thumbTex.destroy(true)
    this.notifyChange()
  }

  /** Destroy all layers and free GPU resources. */
  destroy() {
    for (const layer of this.layers) {
      layer.texture.destroy(true)
    }
    this.layers = []
    this.activeLayerId = ''
    this.app = null
  }

  private notifyChange() {
    this.onChange?.(this.getLayerInfos(), this.activeLayerId)
  }

  private notifyStructuralChange() {
    this.onStructuralChange?.()
  }
}

/** Reset the id counter (for testing). */
export function _resetLayerIdCounter() {
  nextId = 1
}
