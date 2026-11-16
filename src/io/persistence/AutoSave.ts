import type { MetadataDB } from './MetadataDB.ts'
import { isStaleSave, type DocumentStore, type SaveLayer, type SaveReport } from '../tiles/TileStore.ts'
import type { StoredImage } from '../../types/project.ts'

/** Pending: changes are waiting for the next save. */
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
export type SaveStatusCallback = (status: SaveStatus, error?: unknown) => void

/** A save starts this long after the last change (plan M1.3)... */
export const SAVE_DEBOUNCE_MS = 2000
/** ...and never later than this after the first change it saves, however long changes keep coming. */
export const SAVE_MAX_WAIT_MS = 30_000

/**
 * Debounced auto-save and immediate saves for one project. Collects the
 * document through an extraction callback, saves its layers to the document
 * store (as tiles, only the changed ones where it can, plan M1.2 and M1.3)
 * and then updates the project record.
 *
 * Saves run one at a time. A save requested while one is running runs again
 * right after it, so no change is dropped, and a failed save leaves the
 * changes marked unsaved.
 */
export class AutoSave {
  private metaDb: MetadataDB
  private store: DocumentStore
  private debounceMs: number
  /** The longest a change waits for its save. */
  readonly maxWaitMs: number
  private timerId: ReturnType<typeof setTimeout> | null = null
  private maxTimerId: ReturnType<typeof setTimeout> | null = null
  private projectId: string | null = null
  private running: Promise<boolean> | null = null
  private again = false
  private againUrgent = false
  private dirty = false
  /** When the oldest change that no save has read yet was made. */
  private pendingSince: number | null = null
  private error: unknown = null
  private statusCallback: SaveStatusCallback | null = null
  private extractLayerData: ((urgent: boolean, queued: boolean) => LayerDataSet | null) | null = null
  /** A document read while a save ran (`capture`), to write right after it. */
  private queued: LayerDataSet | null = null

  constructor(metaDb: MetadataDB, store: DocumentStore, debounceMs = SAVE_DEBOUNCE_MS, maxWaitMs = SAVE_MAX_WAIT_MS) {
    this.metaDb = metaDb
    this.store = store
    this.debounceMs = debounceMs
    this.maxWaitMs = Math.max(maxWaitMs, debounceMs)
  }

  setProjectId(id: string) {
    this.projectId = id
  }

  setStatusCallback(cb: SaveStatusCallback) {
    this.statusCallback = cb
  }

  /**
   * Set the callback that extracts current layer data for saving. `urgent`
   * is true for saves that can't wait (Ctrl+S, flushes): ones that should
   * bring everything up to date, the Gallery thumbnail too. `queued` is true
   * for a read made while a save runs, to be written once that save is done.
   * Returns null when there is nothing to read now (no engine): the changes
   * then wait for the next save.
   */
  setDataExtractor(fn: (urgent: boolean, queued: boolean) => LayerDataSet | null) {
    this.extractLayerData = fn
  }

  /**
   * Record a change and save it once the debounce passes (called after each
   * stroke), or once the longest wait does if changes keep coming.
   */
  scheduleSave() {
    const wasClean = !this.dirty
    this.markUnsaved()
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
    }
    this.timerId = setTimeout(() => {
      this.timerId = null
      void this.save(false)
    }, this.debounceMs)
    this.maxTimerId ??= setTimeout(() => {
      this.maxTimerId = null
      void this.save(false)
    }, this.maxWaitMs)
    if (wasClean && this.running === null && this.error === null) this.statusCallback?.('pending')
  }

  /** Save immediately (Ctrl+S), changed or not. Resolves true once everything is saved. */
  saveNow(): Promise<boolean> {
    return this.save(true)
  }

  /**
   * Save any unsaved changes now and wait for a save already running.
   * Resolves true when nothing is left unsaved.
   */
  flush(): Promise<boolean> {
    this.cancel()
    if (this.dirty) return this.save(true)
    return this.running ?? Promise.resolve(true)
  }

  /** Forget unsaved changes and any save waiting to run: the engine that had them is gone. */
  forgetUnsaved() {
    this.cancel()
    this.markRead()
  }

  /**
   * Whether a change has waited for its save as long as any should
   * (`maxWaitMs`): a save that could wait (for a stroke to end) shouldn't.
   */
  get overdue(): boolean {
    return this.pendingSince !== null && Date.now() - this.pendingSince >= this.maxWaitMs
  }

  /** Every change so far is read for a save: the next ones wait for the next. */
  private markRead() {
    this.dirty = false
    this.pendingSince = null
  }

  private markUnsaved() {
    this.dirty = true
    this.pendingSince ??= Date.now()
  }

  /** Cancel any pending debounced save. */
  cancel() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
    if (this.maxTimerId !== null) {
      clearTimeout(this.maxTimerId)
      this.maxTimerId = null
    }
  }

  get hasPendingSave(): boolean {
    return this.timerId !== null || this.maxTimerId !== null
  }

  /** Wait for a save that is running, if one is. */
  async settled(): Promise<void> {
    while (this.running) await this.running
  }

  /**
   * Save unsaved changes, reading them now: for when what they are read from
   * may go soon (the page is hidden, or the app crashed). What a running
   * save doesn't cover is read now and written right after it. `force`
   * saves even without changes, when no save is running. Resolves like `flush`.
   */
  capture(force = false): Promise<boolean> {
    this.cancel()
    const running = this.running
    if (!running) return this.dirty || force ? this.save(true) : Promise.resolve(true)
    if (!this.dirty) return running
    // One queued read is enough: an older one's changes go back to be read again.
    this.dropQueued()
    let data: LayerDataSet | null
    try {
      data = this.extractLayerData?.(true, true) ?? null
    } catch (err) {
      this.error = err
      this.statusCallback?.('error', err)
      // The changes wait for a save as they did before.
      this.scheduleSave()
      return running.then(() => false)
    }
    if (data) {
      // The running save's loop writes it once that save is done. Changes
      // made after it was read are left to saves of their own.
      this.queued = data
      this.markRead()
    }
    return running
  }

  /** Give up a queued read: the changes it took are read again by the next save. */
  private dropQueued() {
    const queued = this.queued
    this.queued = null
    queued?.settled?.(null, new Error('a later read replaced it'))
  }

  /** Whether some change hasn't been written by a finished save. */
  get hasUnsavedChanges(): boolean {
    return this.dirty || this.running !== null
  }

  /** Why the last save failed, or null if it succeeded. */
  get lastError(): unknown {
    return this.error
  }

  private save(urgent: boolean): Promise<boolean> {
    // This save takes every change so far: the timers start again with the next one.
    this.cancel()
    if (this.running) {
      this.again = true
      this.againUrgent ||= urgent
      return this.running
    }
    this.running = (async () => {
      try {
        let ok = true
        let now = urgent
        do {
          if (this.queued) {
            // A read made while the last save ran (`capture`): it doesn't
            // answer the saves asked for since, which run after it.
            ok = await this.saveOnce(true)
            continue
          }
          this.again = false
          now ||= this.againUrgent
          this.againUrgent = false
          ok = await this.saveOnce(now)
          now = false
        } while (this.again || this.queued)
        return ok
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  private async saveOnce(urgent: boolean): Promise<boolean> {
    // A read `capture` queued: changes since it was read are still unsaved.
    let queued = this.queued
    this.queued = null
    if (this.projectId === null) {
      queued?.settled?.(null, new Error('there is no project to save to'))
      return false
    }
    const projectId = this.projectId

    try {
      for (let attempt = 0; ; attempt++) {
        let data: LayerDataSet | null
        if (queued) {
          data = queued
          queued = null
        } else {
          // Reading the pixels back can fail too (a large document runs out of memory).
          data = this.extractLayerData?.(urgent, false) ?? null
          // A retry reads whole layers, which covers a read queued meanwhile.
          if (data && attempt > 0) this.dropQueued()
          // Changes made from here on belong to the next save.
          if (data) this.markRead()
        }
        if (!data) {
          // Nothing to read now. After a refused save, that leaves its changes unsaved.
          if (attempt === 0) return true
          this.markUnsaved()
          return false
        }

        this.statusCallback?.('saving')

        // The layers, all at once: until this commits, the last save stays as it was.
        let report: SaveReport
        try {
          const base = typeof data.base === 'function' ? data.base() : data.base
          report = await this.store.save(projectId, {
            width: data.width,
            height: data.height,
            layers: data.layers,
            ...(base !== undefined ? { base } : {}),
          })
        } catch (err) {
          data.settled?.(null, err)
          // It built on a save that isn't the last one any more (another tab
          // saved since): save whole layers instead, at once.
          if (isStaleSave(err) && attempt === 0) continue
          throw err
        }
        data.settled?.(report)
        await this.finishSave(projectId, data)
        return true
      }
    } catch (err) {
      this.markUnsaved()
      this.error = err
      this.statusCallback?.('error', err)
      return false
    }
  }

  /** After the layers: the thumbnail and the project record. */
  private async finishSave(projectId: string, data: LayerDataSet) {
    // The thumbnail is a nicety: failing to encode it doesn't fail the save
    const thumbnail = data.thumbnail ? await data.thumbnail().catch(() => null) : null

    // Update the project record, which also stamps it as modified
    await this.metaDb.updateProject(projectId, {
      width: data.width,
      height: data.height,
      ...(data.activeLayerId !== undefined ? { activeLayerId: data.activeLayerId } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    })

    this.error = null
    // Changes made while it ran are still waiting for the next save.
    this.statusCallback?.(this.dirty ? 'pending' : 'saved')
  }

  destroy() {
    this.cancel()
    this.statusCallback = null
    this.extractLayerData = null
    this.queued = null
  }
}

export interface LayerDataSet {
  /** The document size, kept in the project record too. */
  width: number
  height: number
  /** Bottom first. Their pixel buffers are handed over to the store. */
  layers: SaveLayer[]
  /**
   * The save that layers without pixels build on (`DocumentToSave.base`).
   * A function gives it just before the save, for a document read while
   * another save ran: it builds on whatever that save leaves, and throws a
   * StaleSaveError when that is nothing it can build on.
   */
  base?: number | (() => number)
  activeLayerId?: string
  /** Encodes the Gallery thumbnail. Called after the layers are written. */
  thumbnail?: () => Promise<StoredImage | null>
  /** Told how saving the layers went: the store's report, or null and why it failed. */
  settled?: (report: SaveReport | null, error?: unknown) => void
}
