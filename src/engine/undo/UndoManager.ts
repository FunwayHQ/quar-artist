const MAX_UNDO_STATES = 30

export interface LayerSnapshot {
  width: number
  height: number
  data: Uint8Array
}

export interface UndoEntry {
  layerId: string
  before: LayerSnapshot
  after: LayerSnapshot
}

export type UndoStateChangeCallback = (canUndo: boolean, canRedo: boolean) => void

/**
 * Full-layer snapshot undo/redo.
 * Stores before/after pixel data for the entire layer per operation.
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
   * Called after a stroke completes.
   * Saves the "after" state and pushes the entry onto the undo stack.
   */
  commitOperation(snapshot: LayerSnapshot) {
    if (!this.pendingBefore) return

    const entry: UndoEntry = {
      layerId: this.pendingLayerId,
      before: this.pendingBefore,
      after: snapshot,
    }

    this.undoStack.push(entry)

    // Trim oldest states if over limit
    while (this.undoStack.length > MAX_UNDO_STATES) {
      this.undoStack.shift()
    }

    // Any new operation invalidates the redo stack
    this.redoStack = []
    this.pendingBefore = null
    this.notifyChange()
  }

  /** Cancel a pending operation (e.g., stroke cancelled). */
  cancelOperation() {
    this.pendingBefore = null
  }

  /**
   * Undo the last operation.
   * Returns the full undo entry (with layerId and before snapshot), or null.
   */
  undo(): UndoEntry | null {
    const entry = this.undoStack.pop()
    if (!entry) return null

    this.redoStack.push(entry)
    this.notifyChange()
    return entry
  }

  /**
   * Redo the last undone operation.
   * Returns the full undo entry (with layerId and after snapshot), or null.
   */
  redo(): UndoEntry | null {
    const entry = this.redoStack.pop()
    if (!entry) return null

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
