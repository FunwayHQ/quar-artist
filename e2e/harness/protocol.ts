/**
 * Types shared by the engine harness page (browser side, `main.ts`) and the
 * Playwright tests (Node side, `e2e/support/quar.ts`).
 *
 * Colours are RGBA8 with straight (non-premultiplied) alpha, in 0–255.
 * Pixel buffers are row-major, top row first.
 */
import type { BlendMode, LayerInfo } from '../../src/types/layer.ts'
import type { PsdNotes } from '../../src/io/formats/psd/PsdReader.ts'
import type { ToolType } from '../../src/types/engine.ts'
import type { BoundingBox } from '../../src/types/selection.ts'

export type RGBA = [r: number, g: number, b: number, a: number]

export type RendererPreference = 'webgl' | 'webgpu'

export interface HarnessInfo {
  /** Backend the engine actually runs on (it may fall back from WebGPU). */
  backend: 'webgl2' | 'webgpu'
  width: number
  height: number
}

export interface EncodedFile {
  /** The file's bytes, base64-encoded. */
  base64: string
}

export interface EncodedPixels {
  width: number
  height: number
  /** RGBA8, straight alpha, top row first, base64-encoded. */
  base64: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PointInput {
  x: number
  y: number
  /** Defaults to 0.5. */
  pressure?: number
  tiltX?: number
  tiltY?: number
}

export interface PointerOptions {
  pointerType?: 'mouse' | 'pen' | 'touch'
  /** DOM `button` of the press: 0 primary, 1 middle, 2 secondary. Defaults to 0. */
  button?: number
}

export interface BrushOptions {
  /** Diameter in document pixels. Defaults to 8. */
  size?: number
  /** Defaults to 1. */
  opacity?: number
  /** Defaults to 1 (hard edge). */
  hardness?: number
  /** Stamp spacing as a fraction of the size. Defaults to 0.1. */
  spacing?: number
  /** Defaults to opaque red. */
  color?: RGBA
  pressureSize?: boolean
  pressureOpacity?: boolean
}

export interface LayerProps {
  opacity?: number
  blendMode?: BlendMode
  visible?: boolean
  alphaLock?: boolean
  clippingMask?: boolean
}

export interface SelectionState {
  active: boolean
  bounds: BoundingBox | null
}

/** A tile by column and row, 256 × 256 document pixels each. */
export interface TileAt {
  x: number
  y: number
}

/** A tile as an incremental save reads it back, and as a whole-layer save would (plan M1.3). */
export interface ReadTile extends TileAt {
  read: EncodedPixels
  whole: EncodedPixels
}

/** What changed since the last call, by layer id: the tiles touched ("x_y", sorted), or 'all'. */
export type ChangedTiles = Record<string, string[] | 'all'>

/** A PSD file as the harness opened it (plan M1.7). */
export interface OpenedPsd {
  /** The layers it became, bottom to top. */
  layers: LayerInfo[]
  activeLayerId: string
  /** What it had that the app leaves out. */
  notes: PsdNotes
}

/** How `reopen` opens the saved document again. */
export type ReopenVia = 'tiles' | 'layers'

/** The API the harness page exposes as `window.__quar`. */
export interface QuarHarness {
  readonly info: HarnessInfo

  /** Layer infos, bottom to top. */
  layers(): LayerInfo[]
  activeLayerId(): string
  /** Add a layer above the active one and make it active (like the Layers panel). */
  addLayer(name?: string): string
  selectLayer(id: string): void
  setLayerProps(id: string, props: LayerProps): void
  /** Merge a layer onto the one below (like the Layers panel). */
  mergeDown(id: string): void

  /**
   * Test setup: paint a solid rectangle straight into a layer's texture with
   * source-over. Bypasses tools and undo. Defaults to the whole layer.
   */
  fillRect(layerId: string, color: RGBA, rect?: Rect): void

  setBrush(options: BrushOptions): void
  setTool(tool: ToolType): void
  /** Press, move through `points` and release, as real pointer events on the canvas. */
  stroke(points: PointInput[], options?: PointerOptions): Promise<void>
  /** Press and release at one point. */
  tap(x: number, y: number, options?: PointerOptions): Promise<void>
  /** Drag out a rectangle selection (replace mode). Leaves the selection tool active. */
  selectRect(rect: Rect): Promise<void>
  selection(): SelectionState

  undo(): Promise<boolean>
  redo(): Promise<boolean>

  /**
   * Read every layer as a save does and open them again as opening a project
   * does: the round trip a saved document makes. By default as tiles (plan
   * M1.4): empty layers, then the tiles with something in them, premultiplied
   * and padded as they are stored, put in a few at a time. Or as whole layers,
   * as projects saved before M1.2 open (M1.1).
   */
  reopen(via?: ReopenVia): void

  /**
   * Open a PSD file as the app opens one (plan M1.7): the app's PSD reader
   * reads it, and its layers take the place of the document's. The page must
   * be open at the file's size.
   */
  openPsd(file: EncodedFile): Promise<OpenedPsd>

  /**
   * Read tiles of a layer back as an incremental save does, each with the
   * same tile cut from the layer read whole (plan M1.3). Cut at the
   * document's edges, straight alpha.
   */
  readTiles(layerId: string, tiles: TileAt[]): ReadTile[]
  /** The tiles changed since the last call, by layer, as saves take them (plan M1.3). */
  takeChanges(): ChangedTiles

  /** Read back a layer's texture. */
  readLayer(layerId: string): EncodedPixels
  /** Recomposite all layers (no cache) and read back the result. */
  readComposite(): EncodedPixels
  /** Run the PNG export path and return the file it produces. */
  exportPng(): Promise<EncodedFile>
}

declare global {
  interface Window {
    /** Set once the engine is ready. */
    __quar?: QuarHarness
    /** Resolves when the harness has booted, rejects if the engine failed to start. */
    __quarBoot?: Promise<HarnessInfo>
  }
}
