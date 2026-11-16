import { PerfMonitor } from '../perf/PerfMonitor.ts'
import { compressSnapshot, decompressSnapshot, isCompressionAvailable } from './compression.ts'
import { changedTiles, type TileChanges } from '../../utils/tiles.ts'

const MAX_UNDO_STATES = 50

export interface LayerSnapshot {
  width: number
  height: number
  data: Uint8Array
  /** Whether `data` is gzip-compressed. */
  compressed?: boolean
  /** Pending compression promise — must be awaited before reading data. */
  _compressing?: Promise<void>
}

export interface LayerUndoEntry {
  type: 'layer'
  layerId: string
  before: LayerSnapshot
  after: LayerSnapshot
  /**
   * The 256 × 256 tiles that differ between before and after, worked out
   * when the entry is recorded: undoing or redoing it changes just these.
   */
  tiles?: TileChanges
}

export interface SelectionUndoEntry {
  type: 'selection'
  before: Uint8Array
  after: Uint8Array
}

export type UndoEntry = LayerUndoEntry | SelectionUndoEntry

export type UndoStateChangeCallback = (canUndo: boolean, canRedo: boolean) => void

/** Reports the tiles of a layer that an operation changed, once its pixels are in place. */
export type PixelChangeCallback = (layerId: string, tiles: TileChanges) => void

/**
 * The tiles two snapshots of a layer differ in; the whole layer when they
 * can't be compared. `beforePixels` are the before snapshot's pixels
 * uncompressed, for a snapshot compressed since it was read.
 */
function snapshotChanges(before: LayerSnapshot, after: LayerSnapshot, beforePixels?: Uint8Array | null): TileChanges {
  const { width, height } = after
  const size = width * height * 4
  const old = beforePixels ?? (before.compressed ? null : before.data)
  if (
    !old || after.compressed || before.width !== width || before.height !== height ||
    old.length < size || after.data.length < size
  ) {
    return 'all'
  }
  return new Set(changedTiles(old, after.data, width, height))
}

/**
 * Wait for any pending compression, then decompress if needed.
 * This avoids the race where compression's .then() mutates data
 * between the `compressed` flag check and the actual data read.
 */
async function ensureDecompressed(snapshot: LayerSnapshot): Promise<Uint8Array> {
  // Wait for any in-flight compression to finish first
  if (snapshot._compressing) {
    await snapshot._compressing
  }
  if (snapshot.compressed) {
    snapshot.data = await decompressSnapshot(snapshot.data)
    snapshot.compressed = false
  }
  return snapshot.data
}

/**
 * Asynchronously compress a snapshot's data in-place (fire-and-forget).
 * Stores the promise on the snapshot so ensureDecompressed can await it.
 */
function compressInBackground(snapshot: LayerSnapshot): void {
  if (!isCompressionAvailable || snapshot.compressed) return
  const original = snapshot.data
  snapshot._compressing = compressSnapshot(original).then((compressed) => {
    // Only replace if compression actually helped
    if (compressed.byteLength < original.byteLength) {
      snapshot.data = compressed
      snapshot.compressed = true
    }
    snapshot._compressing = undefined
  }).catch(() => {
    // Compression failed — keep original uncompressed data
    snapshot._compressing = undefined
  })
}

/**
 * Full-layer snapshot undo/redo.
 * Stores before/after pixel data for the entire layer per operation.
 * Snapshots are asynchronously compressed to reduce memory usage.
 */
export class UndoManager {
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  private pendingBefore: LayerSnapshot | null = null
  private pendingLayerId: string = ''
  /** The pending snapshot's pixels uncompressed, when it may be compressed by now. */
  private pendingPixels: Uint8Array | null = null
  private onChange: UndoStateChangeCallback | null = null
  private onPixelChange: PixelChangeCallback | null = null

  setChangeCallback(cb: UndoStateChangeCallback) {
    this.onChange = cb
  }

  /** Called with the tiles each recorded layer operation changed (for saving only what changed, plan M1.3). */
  setPixelChangeCallback(cb: PixelChangeCallback | null) {
    this.onPixelChange = cb
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * Called before a stroke begins.
   * Saves full layer pixel snapshot.
   */
  /**
   * Start an operation from the layer's snapshot. `pixels` are the
   * snapshot's pixels uncompressed, for a snapshot that may have been
   * compressed since it was read (a stroke reusing the last one's).
   */
  beginOperation(snapshot: LayerSnapshot, layerId: string = '', pixels?: Uint8Array) {
    this.pendingBefore = snapshot
    this.pendingLayerId = layerId
    this.pendingPixels = pixels ?? null
  }

  /**
   * Push a fully-formed undo entry directly (e.g., selection operations).
   */
  pushEntry(entry: UndoEntry) {
    PerfMonitor.mark('undo-push-start')
    this.undoStack.push(entry)

    if (entry.type === 'layer') {
      // Before compression replaces the pixels.
      entry.tiles ??= snapshotChanges(entry.before, entry.after)
      this.onPixelChange?.(entry.layerId, entry.tiles)
      // Compress layer snapshots in the background
      compressInBackground(entry.before)
      compressInBackground(entry.after)
    }

    while (this.undoStack.length > MAX_UNDO_STATES) {
      this.undoStack.shift()
    }

    this.redoStack = []
    this.notifyChange()
    PerfMonitor.measure('undo-push', 'undo-push-start')
  }

  /**
   * Called after a stroke completes.
   * Saves the "after" state and pushes the entry onto the undo stack.
   */
  commitOperation(snapshot: LayerSnapshot) {
    if (!this.pendingBefore) return
    PerfMonitor.mark('undo-push-start')

    const entry: LayerUndoEntry = {
      type: 'layer',
      layerId: this.pendingLayerId,
      before: this.pendingBefore,
      after: snapshot,
      tiles: snapshotChanges(this.pendingBefore, snapshot, this.pendingPixels),
    }

    this.undoStack.push(entry)
    this.onPixelChange?.(entry.layerId, entry.tiles!)

    // Compress snapshots asynchronously (doesn't block stroke)
    compressInBackground(entry.before)
    compressInBackground(entry.after)

    // Trim oldest states if over limit
    while (this.undoStack.length > MAX_UNDO_STATES) {
      this.undoStack.shift()
    }

    // Any new operation invalidates the redo stack
    this.redoStack = []
    this.pendingBefore = null
    this.pendingPixels = null
    this.notifyChange()
    PerfMonitor.measure('undo-push', 'undo-push-start')
  }

  /**
   * The layer changed outside the history (merged onto, resized): undoing or
   * redoing any of its steps now restores more than that step's tiles, so
   * each counts the whole layer as changed (plan M1.3).
   */
  forgetTiles(layerId: string) {
    for (const entry of [...this.undoStack, ...this.redoStack]) {
      if (entry.type === 'layer' && entry.layerId === layerId) entry.tiles = 'all'
    }
  }

  /**
   * Cancel a pending operation (e.g., stroke cancelled). What it already
   * drew stays, with no entry to say where: the whole layer counts as changed.
   */
  cancelOperation() {
    if (this.pendingBefore) this.onPixelChange?.(this.pendingLayerId, 'all')
    this.pendingBefore = null
    this.pendingPixels = null
  }

  /**
   * Undo the last operation.
   * Returns the full undo entry (with layerId and before snapshot), or null.
   * Decompresses snapshots if needed (async — callers must await).
   */
  async undo(): Promise<UndoEntry | null> {
    const entry = this.undoStack.pop()
    if (!entry) return null

    // Decompress if needed before returning
    if (entry.type === 'layer') {
      await ensureDecompressed(entry.before)
      await ensureDecompressed(entry.after)
    }

    this.redoStack.push(entry)
    this.notifyChange()
    return entry
  }

  /**
   * Redo the last undone operation.
   * Returns the full undo entry (with layerId and after snapshot), or null.
   * Decompresses snapshots if needed (async — callers must await).
   */
  async redo(): Promise<UndoEntry | null> {
    const entry = this.redoStack.pop()
    if (!entry) return null

    // Decompress if needed before returning
    if (entry.type === 'layer') {
      await ensureDecompressed(entry.before)
      await ensureDecompressed(entry.after)
    }

    this.undoStack.push(entry)
    this.notifyChange()
    return entry
  }

  /** Clear all undo/redo history. */
  clear() {
    this.undoStack = []
    this.redoStack = []
    this.pendingBefore = null
    this.notifyChange()
  }

  get undoDepth(): number {
    return this.undoStack.length
  }

  get redoDepth(): number {
    return this.redoStack.length
  }

  private notifyChange() {
    this.onChange?.(this.canUndo, this.canRedo)
  }
}
