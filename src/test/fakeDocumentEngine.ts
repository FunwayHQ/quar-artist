import type { DocumentEngine } from '../io/persistence/DocumentSession.ts'
import type { LayerInfo, StoredLayer } from '../types/layer.ts'

export function layerInfo(id: string, name: string, extra: Partial<LayerInfo> = {}): LayerInfo {
  return {
    id,
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    alphaLock: false,
    clippingMask: false,
    locked: false,
    ...extra,
  }
}

/**
 * A DocumentEngine without a GPU, for tests: layers are plain byte arrays,
 * and `paint` stands in for a stroke.
 */
export class FakeDocumentEngine implements DocumentEngine {
  readonly width: number
  readonly height: number
  layers: { info: LayerInfo; pixels: Uint8Array }[]
  activeLayerId: string
  /** Every document loaded into this engine, in order. */
  readonly loads: { layers: readonly StoredLayer[]; activeLayerId: string | null }[] = []
  /** Stands in for a filter or transform preview on screen. */
  previewing = false
  /** Set to make every pixel read throw, as a failed GPU readback would. */
  readFailure: Error | null = null
  /** Every composite read, for checking when the thumbnail is skipped. */
  compositeReads = 0
  private onChange: (() => void) | null = null

  constructor(width = 2, height = 2) {
    this.width = width
    this.height = height
    this.layers = [{ info: layerInfo('default', 'Layer 1'), pixels: this.blank() }]
    this.activeLayerId = 'default'
  }

  get following(): boolean {
    return this.onChange !== null
  }

  private blank() {
    return new Uint8Array(this.width * this.height * 4)
  }

  loadDocument(layers: readonly StoredLayer[], activeLayerId: string | null) {
    this.loads.push({ layers, activeLayerId })
    this.layers = layers.map((l) => ({ info: { ...l.info }, pixels: l.pixels ? new Uint8Array(l.pixels) : this.blank() }))
    if (this.layers.length === 0) this.layers = [{ info: layerInfo('default', 'Layer 1'), pixels: this.blank() }]
    const ids = this.layers.map((l) => l.info.id)
    this.activeLayerId = activeLayerId && ids.includes(activeLayerId) ? activeLayerId : ids[ids.length - 1]
  }

  getDocumentSize() {
    return { width: this.width, height: this.height }
  }

  getLayerInfos() {
    return this.layers.map((l) => ({ ...l.info }))
  }

  getActiveLayerId() {
    return this.activeLayerId
  }

  /** A copy, as the real engine gives: the caller owns it. */
  getLayerPixels(id: string) {
    if (this.readFailure) throw this.readFailure
    return this.layers.find((l) => l.info.id === id)?.pixels.slice() ?? null
  }

  getCompositePixels() {
    this.compositeReads++
    return null
  }

  isPreviewing() {
    return this.previewing
  }

  setDocumentChangeCallback(cb: (() => void) | null) {
    this.onChange = cb
  }

  /** Set the first byte of the active layer, as a stroke would change pixels, and report the change. */
  /** Paint the first pixel of the active layer opaque, with `value` as its red. */
  paint(value: number) {
    const layer = this.layers.find((l) => l.info.id === this.activeLayerId)!
    layer.pixels.set([value, 0, 0, 255], 0)
    this.onChange?.()
  }

  /** Add a layer on top and make it active, reporting the change. */
  addLayer(id: string, name: string) {
    this.layers.push({ info: layerInfo(id, name), pixels: this.blank() })
    this.activeLayerId = id
    this.onChange?.()
  }
}
