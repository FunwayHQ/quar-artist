import { MetadataDB } from './MetadataDB.ts'
import type { LayerInfo } from '../../types/layer.ts'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type SaveStatusCallback = (status: SaveStatus) => void

/**
 * Manages debounced auto-save and immediate Ctrl+S save.
 * Collects layer pixel data via an extraction callback and
 * persists metadata + tiles to IndexedDB.
 */
export class AutoSave {
  private metaDb: MetadataDB
  private debounceMs: number
  private timerId: ReturnType<typeof setTimeout> | null = null
  private projectId: number | null = null
  private statusCallback: SaveStatusCallback | null = null
  private extractLayerData: (() => LayerDataSet | null) | null = null

  constructor(metaDb: MetadataDB, debounceMs = 5000) {
    this.metaDb = metaDb
    this.debounceMs = debounceMs
  }

  setProjectId(id: number) {
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

  /** Trigger a debounced save (called after each stroke). */
  scheduleSave() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
    }
    this.timerId = setTimeout(() => {
      this.timerId = null
      this.save()
    }, this.debounceMs)
  }

  /** Save immediately (Ctrl+S). Cancels any pending debounced save. */
  async saveNow(): Promise<void> {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
    await this.save()
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

  private async save(): Promise<void> {
    if (this.projectId === null || !this.extractLayerData) return

    const data = this.extractLayerData()
    if (!data) return

    this.statusCallback?.('saving')

    try {
      // Save layer metadata
      await this.metaDb.saveLayers(this.projectId, data.layerInfos)

      // Save pixel data for each layer
      for (const entry of data.layerPixels) {
        await this.metaDb.saveTile(
          this.projectId,
          entry.layerId,
          'full',
          entry.pixels.buffer.slice(
            entry.pixels.byteOffset,
            entry.pixels.byteOffset + entry.pixels.byteLength,
          ),
        )
      }

      // Update project timestamp
      await this.metaDb.updateProject(this.projectId, {})

      this.statusCallback?.('saved')
    } catch {
      this.statusCallback?.('error')
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
}
