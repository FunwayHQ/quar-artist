import { AutoSave, type LayerDataSet, type SaveStatusCallback } from './AutoSave.ts'
import type { MetadataDB } from './MetadataDB.ts'
import { encodeThumbnail } from './thumbnail.ts'
import type { LayerInfo, StoredLayer } from '../../types/layer.ts'

/** What a document session needs from the engine showing it. CanvasManager implements it. */
export interface DocumentEngine {
  /** Replace every layer with stored ones, keeping their ids, and start an empty history. */
  loadDocument(layers: readonly StoredLayer[], activeLayerId: string | null): void
  getDocumentSize(): { width: number; height: number }
  getLayerInfos(): LayerInfo[]
  getActiveLayerId(): string
  /** A layer's pixels, straight RGBA. */
  getLayerPixels(id: string): Uint8Array | null
  getCompositePixels(): { pixels: Uint8ClampedArray; width: number; height: number } | null
  /**
   * Whether a filter or transform preview is on screen. It isn't part of the
   * document until applied: `getLayerPixels` gives the pixels from before it.
   */
  isPreviewing(): boolean
  /** Called after every change worth saving. Null stops the calls. */
  setDocumentChangeCallback(cb: (() => void) | null): void
}

/**
 * One open project: binds the engine that shows it to an AutoSave that only
 * ever writes to this project. Every project opened gets a new session, so a
 * save can't land in another project after a switch (part of F08).
 */
export class DocumentSession {
  readonly projectId: string
  private readonly autosave: AutoSave
  private engine: DocumentEngine | null = null
  private lastEngine: DocumentEngine | null = null

  constructor(projectId: string, metaDb: MetadataDB, onStatus?: SaveStatusCallback, debounceMs?: number) {
    this.projectId = projectId
    this.autosave = new AutoSave(metaDb, debounceMs)
    this.autosave.setProjectId(projectId)
    if (onStatus) this.autosave.setStatusCallback(onStatus)
    this.autosave.setDataExtractor(() => this.extract())
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

  /** Save the engine's document from now on, after each change. */
  attach(engine: DocumentEngine) {
    this.detach()
    this.engine = engine
    this.lastEngine = engine
    engine.setDocumentChangeCallback(() => this.autosave.scheduleSave())
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

  /** Save unsaved changes now. Resolves true when nothing is left unsaved. */
  flush(): Promise<boolean> {
    return this.autosave.flush()
  }

  /** Save now, changed or not (Ctrl+S). */
  saveNow(): Promise<boolean> {
    return this.autosave.saveNow()
  }

  /**
   * Save, then stop. Resolves false and stays usable when the save failed,
   * so the caller can keep the document open instead of losing work.
   */
  async close(): Promise<boolean> {
    // A change made while a save runs needs a save of its own: keep saving
    // until none is left. Without an engine, there is nothing more to read.
    do {
      if (!(await this.flush())) return false
    } while (this.engine !== null && this.autosave.hasUnsavedChanges)
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
  }

  /** Stop without saving, for a session whose document closes or opens again elsewhere. */
  discard() {
    this.detach()
    this.autosave.destroy()
  }

  private extract(): LayerDataSet | null {
    const engine = this.engine
    if (!engine) return null
    const { width, height } = engine.getDocumentSize()
    const layerInfos = engine.getLayerInfos()
    const layerPixels: LayerDataSet['layerPixels'] = []
    for (const info of layerInfos) {
      const pixels = engine.getLayerPixels(info.id)
      if (pixels) layerPixels.push({ layerId: info.id, pixels })
    }
    // Keep the last thumbnail while a preview shows: the layers saved are the pixels from before it.
    const composite = engine.isPreviewing() ? null : engine.getCompositePixels()
    return {
      layerInfos,
      layerPixels,
      width,
      height,
      activeLayerId: engine.getActiveLayerId(),
      thumbnail: composite
        ? () => encodeThumbnail(composite.pixels, composite.width, composite.height)
        : undefined,
    }
  }
}
