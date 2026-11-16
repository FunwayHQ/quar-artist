import { AutoSave, type LayerDataSet, type SaveStatusCallback } from './AutoSave.ts'
import type { MetadataDB } from './MetadataDB.ts'
import { encodeThumbnail } from './thumbnail.ts'
import { StaleSaveError, isStaleSave, type DocumentStore, type SaveLayer } from '../tiles/TileStore.ts'
import { savedLayerInfo } from '../tiles/tileFormat.ts'
import type { LayerInfo, StoredLayer } from '../../types/layer.ts'
import { parseTileKey, type TileChanges, type TilePixels, type TilePosition } from '../../utils/tiles.ts'

/** What a document session needs from the engine showing it. CanvasManager implements it. */
export interface DocumentEngine {
  /** Replace every layer with stored ones, keeping their ids, and start an empty history. */
  loadDocument(layers: readonly StoredLayer[], activeLayerId: string | null): void
  getDocumentSize(): { width: number; height: number }
  getLayerInfos(): LayerInfo[]
  getActiveLayerId(): string
  /** A layer's pixels, straight RGBA, in a buffer of the caller's own. */
  getLayerPixels(id: string): Uint8Array | null
  /**
   * What changed since the last call, by layer: the tiles changes touched,
   * 'all' for a layer changed throughout, an empty set for a layer made
   * empty. Starts a new record (loading a document starts one too).
   */
  takeChanges(): Map<string, TileChanges>
  /** Some of a layer's tiles, straight RGBA, each in a buffer of the caller's own. Null when they can't be read now. */
  getLayerTiles(id: string, tiles: readonly TilePosition[]): TilePixels[] | null
  getCompositePixels(): { pixels: Uint8ClampedArray; width: number; height: number } | null
  /**
   * Whether a filter or transform preview is on screen. It isn't part of the
   * document until applied: `getLayerPixels` gives the pixels from before it.
   */
  isPreviewing(): boolean
  /** Whether a stroke is being drawn. A save that can wait waits for it to end, so reading back doesn't stall it. */
  isDrawing(): boolean
  /** Called after every change worth saving. Null stops the calls. */
  setDocumentChangeCallback(cb: (() => void) | null): void
}

/** A save of the document as the engine has it, that the next save can build on (plan M1.3). */
export interface SavedBase {
  /** The save's number in the store. */
  seq: number
  width: number
  height: number
  /** The layers it has. */
  layers: ReadonlySet<string>
}

/** The Gallery thumbnail is brought up to date at most this often, and at every flush. */
export const THUMBNAIL_EVERY_MS = 30_000

/** Closing saves at most this many times over, for changes made while it saves. */
const CLOSE_PASSES = 5

function mergeChange(into: Map<string, Set<string> | 'all'>, layerId: string, change: TileChanges) {
  const known = into.get(layerId)
  if (known === 'all') return
  if (change === 'all') {
    into.set(layerId, 'all')
    return
  }
  const set = known ?? new Set<string>()
  for (const key of change) set.add(key)
  into.set(layerId, set)
}

/**
 * One open project: binds the engine that shows it to an AutoSave that only
 * ever writes to this project. Every project opened gets a new session, so a
 * save can't land in another project after a switch (part of F08).
 *
 * Saves are incremental (plan M1.3): the engine reports which tiles each
 * change touched, and a save reads back and writes just those, on top of the
 * save it last made or loaded (its base). Without a base, and for layers
 * whose changes it doesn't know, it saves whole layers.
 */
export class DocumentSession {
  readonly projectId: string
  private readonly autosave: AutoSave
  private engine: DocumentEngine | null = null
  private lastEngine: DocumentEngine | null = null
  private base: SavedBase | null = null
  /** Changes taken from the engine and not saved yet, by layer. */
  private pending = new Map<string, Set<string> | 'all'>()
  /** What each save read and not settled yet reads again, by layer. */
  private readonly outstanding = new Set<ReadonlyMap<string, Set<string> | 'all'>>()
  /** When the thumbnail was last brought up to date, and whether the document changed since. */
  private thumbnailAt = 0
  private thumbnailStale = false

  constructor(
    projectId: string,
    metaDb: MetadataDB,
    store: DocumentStore,
    onStatus?: SaveStatusCallback,
    debounceMs?: number,
    maxWaitMs?: number,
  ) {
    this.projectId = projectId
    this.autosave = new AutoSave(metaDb, store, debounceMs, maxWaitMs)
    this.autosave.setProjectId(projectId)
    if (onStatus) this.autosave.setStatusCallback(onStatus)
    this.autosave.setDataExtractor((urgent, whole) => this.extract(urgent, whole))
  }

  /**
   * Whether another engine showed this document before. A new engine starts
   * empty, so the document has to be loaded into it again before attaching.
   * The same engine coming back (React StrictMode runs effects twice) still
   * has it.
   */
  isNewEngine(engine: DocumentEngine): boolean {
    return this.lastEngine !== null && this.lastEngine !== engine
  }

  get hasUnsavedChanges(): boolean {
    return this.autosave.hasUnsavedChanges
  }

  /** Why the last save failed, or null if it succeeded. */
  get lastError(): unknown {
    return this.autosave.lastError
  }

  /**
   * The save the engine's document is, as just loaded into it: later saves
   * build on it. Null (a new project, or one saved before the tile store)
   * makes the next save write whole layers.
   */
  setBase(base: SavedBase | null) {
    this.base = base
    this.pending.clear()
  }

  /** Save the engine's document from now on, after each change. */
  attach(engine: DocumentEngine) {
    this.detach()
    this.engine = engine
    this.lastEngine = engine
    engine.setDocumentChangeCallback(() => {
      this.thumbnailStale = true
      this.autosave.scheduleSave()
    })
  }

  /**
   * Stop following the engine. Unsaved changes stay marked unsaved: the engine
   * may already be gone, so nothing is read from it here.
   */
  detach() {
    if (!this.engine) return
    this.engine.setDocumentChangeCallback(null)
    this.engine = null
    this.autosave.cancel()
  }

  /** Save unsaved changes now, the Gallery thumbnail too. Resolves true when nothing is left unsaved. */
  async flush(): Promise<boolean> {
    if (!(await this.autosave.flush())) return false
    // Saves in between bring the thumbnail up to date at most every 30 s: a flush always does, when it can.
    if (this.thumbnailDue()) return this.autosave.saveNow()
    return true
  }

  /**
   * Save what the engine has that isn't saved, reading it now: for when the
   * engine is about to go (its view closes, or the app crashed). Resolves
   * like `flush` once the save is done.
   */
  capture(): Promise<boolean> {
    if (!this.engine) return this.autosave.settled().then(() => !this.autosave.hasUnsavedChanges)
    return this.autosave.capture(this.thumbnailDue())
  }

  /** Whether the thumbnail is behind the document, and can be made now (not under a preview). */
  private thumbnailDue(): boolean {
    return this.thumbnailStale && this.engine !== null && !this.engine.isPreviewing()
  }

  /** Save now, changed or not (Ctrl+S). */
  saveNow(): Promise<boolean> {
    return this.autosave.saveNow()
  }

  /** Wait for a save that is running, if one is. */
  settled(): Promise<void> {
    return this.autosave.settled()
  }

  /**
   * Save, then stop. Resolves false and stays usable when the save failed,
   * so the caller can keep the document open instead of losing work.
   */
  async close(): Promise<boolean> {
    // A change made while a save runs needs a save of its own: keep saving
    // until none is left. Without an engine, there is nothing more to read,
    // and tiles that can't be read now won't be by saving again and again.
    for (let pass = 1; ; pass++) {
      if (!(await this.flush())) return false
      if (this.engine === null || !this.autosave.hasUnsavedChanges || pass === CLOSE_PASSES) break
    }
    this.detach()
    this.autosave.destroy()
    return true
  }

  /**
   * Forget unsaved changes. For when the engine that had them was replaced:
   * they went with it, and saving its empty successor would lose the project.
   */
  forgetUnsaved() {
    this.autosave.forgetUnsaved()
    this.pending.clear()
    this.thumbnailStale = false
  }

  /** Stop without saving, for a session whose document closes or opens again elsewhere. */
  discard() {
    this.detach()
    this.autosave.destroy()
  }

  /**
   * The document to save: the changed tiles on top of the base, or whole
   * layers where there is no base or the changes aren't known by tile. The
   * changes it covers leave the pending record, and go back if it fails.
   *
   * `queued` is for a read made while a save runs, written once that save
   * is done: it reads that save's changes again too, so it holds whether
   * that save works or not, and builds on whatever save is the last by then.
   */
  private extract(urgent: boolean, queued: boolean): LayerDataSet | null {
    const engine = this.engine
    if (!engine) return null
    if (!urgent && engine.isDrawing() && !this.autosave.overdue) {
      // Save once the stroke ends, so reading back doesn't stall it: but not
      // once a change has waited as long as any should (30 s).
      this.autosave.scheduleSave()
      return null
    }
    const { width, height } = engine.getDocumentSize()
    const infos = engine.getLayerInfos()
    const present = new Set(infos.map((i) => i.id))
    // The engine's changes join the ones not saved yet. Layers deleted since need nothing.
    for (const [id, change] of engine.takeChanges()) mergeChange(this.pending, id, change)
    for (const id of [...this.pending.keys()]) if (!present.has(id)) this.pending.delete(id)
    const base = this.base && this.base.width === width && this.base.height === height ? this.base : null

    // What to read again, by layer.
    const toRead = new Map<string, Set<string> | 'all'>()
    for (const [id, change] of this.pending) mergeChange(toRead, id, change)
    if (queued) for (const covered of this.outstanding) for (const [id, change] of covered) mergeChange(toRead, id, change)

    // The layers read. Their changes leave the pending record only once every
    // read has worked: a read that throws leaves them all to read again.
    const read: string[] = []
    const layers: SaveLayer[] = infos.map((raw) => {
      const info = savedLayerInfo(raw)
      const change = toRead.get(info.id)
      if (base && change !== 'all' && (base.layers.has(info.id) || change !== undefined)) {
        // On top of the base: its tiles, with the changed ones read back (a
        // new layer has nothing under them).
        if (!change || change.size === 0) {
          read.push(info.id)
          return { info, pixels: null, tiles: [] }
        }
        const tiles = engine.getLayerTiles(info.id, [...change].map(parseTileKey))
        if (!tiles) return { info, pixels: null, tiles: [] } // under a preview: they wait for the next save
        read.push(info.id)
        return { info, pixels: null, tiles }
      }
      const pixels = engine.getLayerPixels(info.id)
      if (pixels) {
        read.push(info.id)
        return { info, pixels }
      }
      // It can't be read now, so it keeps what was saved for it: read it whole next time.
      mergeChange(this.pending, info.id, 'all')
      return { info, pixels: null }
    })

    // Keep the last thumbnail while a preview shows: the layers saved are the pixels from before it.
    const thumbnail =
      (urgent || Date.now() - this.thumbnailAt >= THUMBNAIL_EVERY_MS) && !engine.isPreviewing()
    let composite: ReturnType<DocumentEngine['getCompositePixels']> = null
    if (thumbnail) {
      // The layers are what matters: a composite that can't be read (it is
      // the largest readback of all) leaves the last thumbnail.
      try {
        composite = engine.getCompositePixels()
      } catch (err) {
        console.warn('The Gallery thumbnail could not be read back:', err)
      }
      // Done either way: trying again at every flush wouldn't help.
      this.thumbnailAt = Date.now()
      this.thumbnailStale = false
    }

    // Every read worked: the changes read leave the pending record.
    const taken = new Map<string, Set<string> | 'all'>()
    for (const id of read) {
      const change = this.pending.get(id)
      if (change === undefined) continue
      taken.set(id, change)
      this.pending.delete(id)
    }
    this.outstanding.add(toRead)

    return {
      layers,
      width,
      height,
      ...(base ? { base: queued ? () => this.baseSeq(width, height) : base.seq } : {}),
      activeLayerId: engine.getActiveLayerId(),
      thumbnail: composite
        ? () => encodeThumbnail(composite.pixels, composite.width, composite.height)
        : undefined,
      settled: (report, error) => {
        this.outstanding.delete(toRead)
        if (!report) {
          // Still to save.
          for (const [id, change] of taken) mergeChange(this.pending, id, change)
          if (thumbnail) this.thumbnailStale = true
          // Built on a save another tab replaced: the next try saves whole layers.
          if (isStaleSave(error)) this.base = null
          return
        }
        this.base = { seq: report.seq, width, height, layers: present }
        // Tiles that couldn't be read this time: not saved yet, so say so, and try again.
        if (this.pending.size > 0) this.autosave.scheduleSave()
      },
    }
  }

  /** The last save, for a queued read to build on: the base when it was read, or the save that ran meanwhile. */
  private baseSeq(width: number, height: number): number {
    const base = this.base
    if (!base || base.width !== width || base.height !== height) throw new StaleSaveError()
    return base.seq
  }
}
