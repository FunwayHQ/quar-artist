import { MetadataDB } from './MetadataDB.ts'
import type { LayerInfo } from '../../types/layer.ts'
import type { StoredImage } from '../../types/project.ts'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type SaveStatusCallback = (status: SaveStatus, error?: unknown) => void

/**
 * Debounced auto-save and immediate saves for one project.
 * Collects layer pixel data via an extraction callback and persists
 * metadata + tiles to IndexedDB.
 *
 * Saves run one at a time. A save requested while one is running runs again
 * right after it, so no change is dropped, and a failed save leaves the
 * changes marked unsaved. Incremental tile saves, the 2 s / 30 s timing and
 * saving when the page is hidden arrive with plan M1.3.
 */
export class AutoSave {
  private metaDb: MetadataDB
  private debounceMs: number
  private timerId: ReturnType<typeof setTimeout> | null = null
  private projectId: string | null = null
  private running: Promise<boolean> | null = null
  private again = false
  private dirty = false
  private error: unknown = null
  private statusCallback: SaveStatusCallback | null = null
  private extractLayerData: (() => LayerDataSet | null) | null = null

  constructor(metaDb: MetadataDB, debounceMs = 5000) {
    this.metaDb = metaDb
    this.debounceMs = debounceMs
  }

  setProjectId(id: string) {
    this.projectId = id
  }

  setStatusCallback(cb: SaveStatusCallback) {
    this.statusCallback = cb
  }

  /**
   * Set the callback that extracts current layer data for saving.
   * Returns null if no data available (e.g., engine not initialized).
   */
  setDataExtractor(fn: () => LayerDataSet | null) {
    this.extractLayerData = fn
  }

  /** Record a change and save it once the debounce passes (called after each stroke). */
  scheduleSave() {
    this.dirty = true
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
    }
    this.timerId = setTimeout(() => {
      this.timerId = null
      void this.save()
    }, this.debounceMs)
  }

  /** Save immediately (Ctrl+S), changed or not. Resolves true once everything is saved. */
  saveNow(): Promise<boolean> {
    this.cancel()
    return this.save()
  }

  /**
   * Save any unsaved changes now and wait for a save already running.
   * Resolves true when nothing is left unsaved.
   */
  flush(): Promise<boolean> {
    this.cancel()
    if (this.dirty) return this.save()
    return this.running ?? Promise.resolve(true)
  }

  /** Forget unsaved changes and any save waiting to run: the engine that had them is gone. */
  forgetUnsaved() {
    this.cancel()
    this.dirty = false
  }

  /** Cancel any pending debounced save. */
  cancel() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }

  get hasPendingSave(): boolean {
    return this.timerId !== null
  }

  /** Whether some change hasn't been written by a finished save. */
  get hasUnsavedChanges(): boolean {
    return this.dirty || this.running !== null
  }

  /** Why the last save failed, or null if it succeeded. */
  get lastError(): unknown {
    return this.error
  }

  private save(): Promise<boolean> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        let ok: boolean
        do {
          this.again = false
          ok = await this.saveOnce()
        } while (this.again)
        return ok
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  private async saveOnce(): Promise<boolean> {
    if (this.projectId === null || !this.extractLayerData) return false
    const projectId = this.projectId

    try {
      // Reading the pixels back can fail too (a large document runs out of memory).
      const data = this.extractLayerData()
      if (!data) return true

      // Changes made from here on belong to the next save.
      this.dirty = false
      this.statusCallback?.('saving')

      // Save layer metadata
      await this.metaDb.saveLayers(projectId, data.layerInfos)

      // Save pixel data for each layer
      for (const entry of data.layerPixels) {
        await this.metaDb.saveTile(
          projectId,
          entry.layerId,
          'full',
          // Copy into a standalone ArrayBuffer (also narrows away SharedArrayBuffer)
          new Uint8Array(entry.pixels).buffer,
        )
      }

      // Drop the pixels of layers that were deleted since the last save
      await this.metaDb.deleteTilesExcept(projectId, new Set(data.layerInfos.map((l) => l.id)))

      // The thumbnail is a nicety: failing to encode it doesn't fail the save
      const thumbnail = data.thumbnail ? await data.thumbnail().catch(() => null) : null

      // Update the project record, which also stamps it as modified
      await this.metaDb.updateProject(projectId, {
        ...(data.width !== undefined && data.height !== undefined ? { width: data.width, height: data.height } : {}),
        ...(data.activeLayerId !== undefined ? { activeLayerId: data.activeLayerId } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      })

      this.error = null
      this.statusCallback?.('saved')
      return true
    } catch (err) {
      this.dirty = true
      this.error = err
      this.statusCallback?.('error', err)
      return false
    }
  }

  destroy() {
    this.cancel()
    this.statusCallback = null
    this.extractLayerData = null
  }
}

export interface LayerDataSet {
  layerInfos: LayerInfo[]
  layerPixels: { layerId: string; pixels: Uint8Array }[]
  /** The document size, kept in the project record. */
  width?: number
  height?: number
  activeLayerId?: string
  /** Encodes the Gallery thumbnail. Called after the layers are written. */
  thumbnail?: () => Promise<StoredImage | null>
}
