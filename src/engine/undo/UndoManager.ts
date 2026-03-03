import { PerfMonitor } from '../perf/PerfMonitor.ts'
import { compressSnapshot, decompressSnapshot, isCompressionAvailable } from './compression.ts'

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
}

export interface SelectionUndoEntry {
  type: 'selection'
  before: Uint8Array
  after: Uint8Array
}

export type UndoEntry = LayerUndoEntry | SelectionUndoEntry

export type UndoStateChangeCallback = (canUndo: boolean, canRedo: boolean) => void

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
  private onChange: UndoStateChangeCallback | null = null

  setChangeCallback(cb: UndoStateChangeCallback) {
    this.onChange = cb
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
  beginOperation(snapshot: LayerSnapshot, layerId: string = '') {
    this.pendingBefore = snapshot
    this.pendingLayerId = layerId
  }

  /**
   * Push a fully-formed undo entry directly (e.g., selection operations).
   */
  pushEntry(entry: UndoEntry) {
    PerfMonitor.mark('undo-push-start')
    this.undoStack.push(entry)

    // Compress layer snapshots in the background
    if (entry.type === 'layer') {
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
    }

    this.undoStack.push(entry)

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
    this.notifyChange()
    PerfMonitor.measure('undo-push', 'undo-push-start')
  }

  /** Cancel a pending operation (e.g., stroke cancelled). */
  cancelOperation() {
    this.pendingBefore = null
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
