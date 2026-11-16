import type { DocumentEngine } from '../io/persistence/DocumentSession.ts'
import type { LayerInfo, StoredLayer } from '../types/layer.ts'
import { TILE_SIZE, cutTiles, tileKey, type TileChanges, type TilePosition } from '../utils/tiles.ts'

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
 * `paint` stands in for a stroke, and changes are recorded by tile as the
 * real engine records them.
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
  /** Stands in for a stroke being drawn. */
  drawing = false
  /** Set to make every pixel read throw, as a failed GPU readback would. */
  readFailure: Error | null = null
  /** Every composite read, for checking when the thumbnail is skipped. */
  compositeReads = 0
  /** Whole layers read, and tiles read, by layer id: for checking what a save reads back. */
  readonly layerReads: string[] = []
  readonly tileReads: { id: string; tiles: string[] }[] = []
  /** Set to make tile reads return null, as under a preview whose snapshot is compressed. */
  tilesUnreadable = false
  /** Set to make the next tile read of a layer throw, once, as a readback out of memory would. */
  failNextTileRead: { id: string; error: Error } | null = null
  /** Set to make the next composite read throw, once. */
  failNextComposite: Error | null = null
  private onChange: (() => void) | null = null
  private changes = new Map<string, Set<string> | 'all'>()

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
    this.changes.clear()
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
    this.layerReads.push(id)
    return this.layers.find((l) => l.info.id === id)?.pixels.slice() ?? null
  }

  takeChanges(): Map<string, TileChanges> {
    const changes = this.changes
    this.changes = new Map()
    return changes
  }

  getLayerTiles(id: string, tiles: readonly TilePosition[]) {
    if (this.readFailure) throw this.readFailure
    if (this.failNextTileRead?.id === id) {
      const { error } = this.failNextTileRead
      this.failNextTileRead = null
      throw error
    }
    const layer = this.layers.find((l) => l.info.id === id)
    if (!layer || this.tilesUnreadable) return null
    this.tileReads.push({ id, tiles: tiles.map((t) => tileKey(t.x, t.y)).sort() })
    return cutTiles(layer.pixels, this.width, this.height, tiles)
  }

  private record(id: string, change: 'all' | string) {
    const known = this.changes.get(id)
    if (known === 'all') return
    if (change === 'all') this.changes.set(id, 'all')
    else this.changes.set(id, new Set([...(known ?? []), change]))
  }

  getCompositePixels() {
    this.compositeReads++
    const failure = this.failNextComposite
    this.failNextComposite = null
    if (failure) throw failure
    return null
  }

  isPreviewing() {
    return this.previewing
  }

  isDrawing() {
    return this.drawing
  }

  setDocumentChangeCallback(cb: (() => void) | null) {
    this.onChange = cb
  }

  /** Paint a pixel of the active layer opaque, with `value` as its red, as a stroke would, and report the change. */
  paint(value: number, x = 0, y = 0) {
    const layer = this.layers.find((l) => l.info.id === this.activeLayerId)!
    layer.pixels.set([value, 0, 0, 255], (y * this.width + x) * 4)
    this.record(layer.info.id, tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)))
    this.onChange?.()
  }

  /** Change a layer's pixels without saying where, as merging layers down does. */
  fillLayer(id: string, value: number) {
    const layer = this.layers.find((l) => l.info.id === id)!
    for (let i = 0; i < layer.pixels.length; i += 4) layer.pixels.set([value, 0, 0, 255], i)
    this.record(id, 'all')
    this.onChange?.()
  }

  /** Add an empty layer on top and make it active, reporting the change. */
  addLayer(id: string, name: string) {
    this.layers.push({ info: layerInfo(id, name), pixels: this.blank() })
    this.activeLayerId = id
    if (this.changes.get(id) !== 'all') this.changes.set(id, new Set())
    this.onChange?.()
  }

  /** Delete a layer, reporting the change. */
  removeLayer(id: string) {
    this.layers = this.layers.filter((l) => l.info.id !== id)
    this.changes.delete(id)
    if (this.activeLayerId === id) this.activeLayerId = this.layers[this.layers.length - 1].info.id
    this.onChange?.()
  }

  /** The red of a layer's pixel, as `paint` sets it. */
  red(id: string, x = 0, y = 0): number {
    return this.layers.find((l) => l.info.id === id)!.pixels[(y * this.width + x) * 4]
  }
}
