import { AutoSave, type LayerDataSet, type SaveStatusCallback } from './AutoSave.ts'
import type { MetadataDB } from './MetadataDB.ts'
import { encodeThumbnail } from './thumbnail.ts'
import { StaleSaveError, isStaleSave, type DocumentStore, type SaveLayer } from '../tiles/TileStore.ts'
import { savedLayerInfo } from '../tiles/tileFormat.ts'
import type { ProjectRecord } from '../../db/schema.ts'
import type { SavedView } from '../../types/engine.ts'
import type { LayerInfo, StoredLayer } from '../../types/layer.ts'
import { parseTileKey, type TileChanges, type TilePixels, type TilePosition } from '../../utils/tiles.ts'

/** A saved tile to put into a layer: premultiplied RGBA8, 256 × 256, as the tile store keeps it. */
export interface PlacedTile {
  x: number
  y: number
  data: Uint8Array
}

/**
 * What a project keeps besides its pixels (plan M1.4): how it was left (the
 * view and the selected layer) and its guides. Written with every save, and
 * when it closes, since choosing a layer or zooming isn't an edit.
 */
export type DocumentSettings = Partial<Pick<ProjectRecord, 'view' | 'guides' | 'activeLayerId'>>

/** What a document session needs from the engine showing it. CanvasManager implements it. */
export interface DocumentEngine {
  /**
   * Replace every layer with stored ones, keeping their ids, and start an
   * empty history. A layer without pixels starts empty. Returns the ids of
   * the layers made, bottom first (a repeated id gets a fresh one, and
   * layers past the limit are left out).
   */
  loadDocument(layers: readonly StoredLayer[], activeLayerId: string | null): readonly string[]
  /** Put saved tiles into a layer loaded empty (plan M1.4). Not a change to save. */
  placeTiles(layerId: string, tiles: readonly PlacedTile[]): void
  /** Every saved tile is in place: show the document. */
  finishLoading(): void
  /** How the document is shown, to save with it; null when it can't be measured. */
  getView(): SavedView | null
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

type SettingsKey = keyof DocumentSettings
const SETTINGS_KEYS: readonly SettingsKey[] = ['view', 'guides', 'activeLayerId']

/** Each setting there is, as it compares: as JSON. */
function settingsJson(settings: DocumentSettings): Partial<Record<SettingsKey, string>> {
  const json: Partial<Record<SettingsKey, string>> = {}
  for (const key of SETTINGS_KEYS) {
    const value = settings[key]
    if (value !== undefined && value !== null && value !== '') json[key] = JSON.stringify(value)
  }
  return json
}

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
  private readonly metaDb: MetadataDB
  /** Where the settings saved with the document come from, besides the engine's view. */
  private settingsSource: (() => DocumentSettings) | null = null
  /** The settings as last written to the project record, to write them only when they changed. */
  /**
   * Each setting as the project record has it, as far as this session knows:
   * as the project opened, then as this session last wrote it (plan M1.4).
   */
  private settingsWritten: Partial<Record<SettingsKey, string>> = {}

  constructor(
    projectId: string,
    metaDb: MetadataDB,
    store: DocumentStore,
    onStatus?: SaveStatusCallback,
    debounceMs?: number,
    maxWaitMs?: number,
  ) {
    this.projectId = projectId
    this.metaDb = metaDb
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

  /**
   * The document is being loaded into this engine (plan M1.4). It isn't
   * saved from it until `attach`, once it has all of it; and another engine
   * from now on is a new one, that it has to be loaded into again.
   */
  beginLoad(engine: DocumentEngine) {
    this.lastEngine = engine
  }

  /**
   * Where the settings saved with the document come from (its guides), and
   * how they were when it opened. The engine gives its view and selected layer.
   */
  setSettingsSource(source: (() => DocumentSettings) | null, opened: DocumentSettings = {}) {
    this.settingsSource = source
    this.settingsWritten = settingsJson(opened)
  }

  /** The settings changed (the guides): save them with the next save, as any change. */
  noteSettingsChange() {
    // Without an engine there is nothing to save yet; the next save writes them.
    if (this.engine) this.autosave.scheduleSave()
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
    // The view and selected layer too, which don't count as changes: the page may not come back.
    void this.writeSettings()
    return this.autosave.capture(this.thumbnailDue())
  }

  /** The settings to keep with the document now: the engine's view and selected layer, and the rest from the source. */
  private currentSettings(): DocumentSettings {
    let settings: DocumentSettings = {}
    try {
      settings = { ...this.settingsSource?.() }
      const view = this.engine?.getView()
      if (view) settings.view = view
      const active = this.engine?.getActiveLayerId()
      if (active) settings.activeLayerId = active
    } catch (err) {
      console.warn('[QUAR] The view, guides and selected layer could not be read for saving:', err)
    }
    return settings
  }

  /**
   * The settings that changed since the record last had them, counted as
   * written from now on: for a write of the project record about to start.
   * The record's writes land in the order they start, so it ends up with what
   * was taken last. Only what changed here is written: a setting another tab
   * changed since stays as that tab left it.
   */
  private takeSettingsChanges(): DocumentSettings {
    const settings = this.currentSettings()
    const json = settingsJson(settings)
    const changes: Record<string, unknown> = {}
    for (const key of SETTINGS_KEYS) {
      if (json[key] === undefined || json[key] === this.settingsWritten[key]) continue
      changes[key] = settings[key]
      this.settingsWritten[key] = json[key]
    }
    return changes as DocumentSettings
  }

  /** Settings taken for a write that failed: unknown again, so the next write has them. */
  private settingsNotWritten(changes: DocumentSettings) {
    for (const key of Object.keys(changes) as SettingsKey[]) delete this.settingsWritten[key]
  }

  /**
   * Write the settings that changed to the project record: the view and the
   * selected layer change without a save (neither is an edit), so closing and
   * hiding the page write them. Its modified date stays.
   */
  private async writeSettings(): Promise<void> {
    const changes = this.takeSettingsChanges()
    if (Object.keys(changes).length === 0) return
    try {
      await this.metaDb.updateProject(this.projectId, changes, { touch: false })
    } catch (err) {
      this.settingsNotWritten(changes)
      // A nicety: the project opens fitted to the window instead.
      console.warn('[QUAR] The view, guides and selected layer could not be saved:', err)
    }
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
    // While the engine is still there to give its view.
    if (this.engine) await this.writeSettings()
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

    // The settings, unlike the pixels, as they are when the record is written.
    let settings: DocumentSettings = {}

    return {
      layers,
      width,
      height,
      ...(base ? { base: queued ? () => this.baseSeq(width, height) : base.seq } : {}),
      settings: () => (settings = this.takeSettingsChanges()),
      recordFailed: () => this.settingsNotWritten(settings),
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
