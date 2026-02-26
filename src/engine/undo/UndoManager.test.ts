import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UndoManager } from './UndoManager.ts'
import type { TileSnapshot } from './UndoManager.ts'

function snapshot(key: string, data: number[]): TileSnapshot {
  return { key, data: new Uint8Array(data) }
}

describe('UndoManager', () => {
  let undo: UndoManager

  beforeEach(() => {
    undo = new UndoManager()
  })

  it('starts with empty stacks', () => {
    expect(undo.canUndo).toBe(false)
    expect(undo.canRedo).toBe(false)
    expect(undo.undoDepth).toBe(0)
    expect(undo.redoDepth).toBe(0)
  })

  describe('beginOperation / commitOperation', () => {
    it('push an entry onto the undo stack', () => {
      undo.beginOperation([snapshot('0_0', [1, 2, 3])])
      undo.commitOperation([snapshot('0_0', [4, 5, 6])])
      expect(undo.canUndo).toBe(true)
      expect(undo.undoDepth).toBe(1)
    })

    it('clears the redo stack on new commit', () => {
      // Do an operation, undo it, then do a new operation
      undo.beginOperation([])
      undo.commitOperation([])
      undo.undo()
      expect(undo.canRedo).toBe(true)

      undo.beginOperation([])
      undo.commitOperation([])
      expect(undo.canRedo).toBe(false)
    })
  })

  describe('undo', () => {
    it('returns before tiles', () => {
      const before = [snapshot('0_0', [1, 2, 3])]
      const after = [snapshot('0_0', [4, 5, 6])]
      undo.beginOperation(before)
      undo.commitOperation(after)

      const result = undo.undo()
      expect(result).not.toBeNull()
      expect(result!.before).toHaveLength(1)
      expect(result!.before[0].key).toBe('0_0')
      expect(Array.from(result!.before[0].data)).toEqual([1, 2, 3])
    })

    it('returns null when nothing to undo', () => {
      expect(undo.undo()).toBeNull()
    })

    it('moves entry to redo stack', () => {
      undo.beginOperation([])
      undo.commitOperation([])
      undo.undo()
      expect(undo.canUndo).toBe(false)
      expect(undo.canRedo).toBe(true)
    })
  })

  describe('redo', () => {
    it('returns after tiles', () => {
      const before = [snapshot('0_0', [1, 2, 3])]
      const after = [snapshot('0_0', [4, 5, 6])]
      undo.beginOperation(before)
      undo.commitOperation(after)
      undo.undo()

      const result = undo.redo()
      expect(result).not.toBeNull()
      expect(result!.after).toHaveLength(1)
      expect(Array.from(result!.after[0].data)).toEqual([4, 5, 6])
    })

    it('returns null when nothing to redo', () => {
      expect(undo.redo()).toBeNull()
    })

    it('moves entry back to undo stack', () => {
      undo.beginOperation([])
      undo.commitOperation([])
      undo.undo()
      undo.redo()
      expect(undo.canUndo).toBe(true)
      expect(undo.canRedo).toBe(false)
    })
  })

  describe('stack depth limit', () => {
    it('trims undo stack at 50 entries', () => {
      for (let i = 0; i < 60; i++) {
        undo.beginOperation([snapshot(`tile_${i}`, [i])])
        undo.commitOperation([snapshot(`tile_${i}`, [i + 100])])
      }
      expect(undo.undoDepth).toBe(50)
    })
  })

  describe('cancelOperation', () => {
    it('discards pending operation without pushing to undo stack', () => {
      undo.beginOperation([snapshot('0_0', [1])])
      undo.cancelOperation()
      expect(undo.canUndo).toBe(false)
    })

    it('commitOperation after cancel does nothing', () => {
      undo.beginOperation([snapshot('0_0', [1])])
      undo.cancelOperation()
      undo.commitOperation([snapshot('0_0', [2])])
      expect(undo.canUndo).toBe(false)
    })
  })

  describe('change callback', () => {
    it('fires on commit', () => {
      const cb = vi.fn()
      undo.setChangeCallback(cb)
      undo.beginOperation([])
      undo.commitOperation([])
      expect(cb).toHaveBeenCalledWith(true, false)
    })

    it('fires on undo', () => {
      const cb = vi.fn()
      undo.beginOperation([])
      undo.commitOperation([])
      undo.setChangeCallback(cb)
      undo.undo()
      expect(cb).toHaveBeenCalledWith(false, true)
    })

    it('fires on redo', () => {
      const cb = vi.fn()
      undo.beginOperation([])
      undo.commitOperation([])
      undo.undo()
      undo.setChangeCallback(cb)
      undo.redo()
      expect(cb).toHaveBeenCalledWith(true, false)
    })
  })

  describe('clear', () => {
    it('empties both stacks', () => {
      undo.beginOperation([])
      undo.commitOperation([])
      undo.beginOperation([])
      undo.commitOperation([])
      undo.undo()

      undo.clear()
      expect(undo.canUndo).toBe(false)
      expect(undo.canRedo).toBe(false)
    })
  })
})
