import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UndoManager } from './UndoManager.ts'
import type { LayerSnapshot } from './UndoManager.ts'

function snapshot(data: number[]): LayerSnapshot {
  return { width: 1, height: Math.ceil(data.length / 4) || 1, data: new Uint8Array(data) }
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
      undo.beginOperation(snapshot([1, 2, 3]))
      undo.commitOperation(snapshot([4, 5, 6]))
      expect(undo.canUndo).toBe(true)
      expect(undo.undoDepth).toBe(1)
    })

    it('clears the redo stack on new commit', async () => {
      // Do an operation, undo it, then do a new operation
      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      await undo.undo()
      expect(undo.canRedo).toBe(true)

      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      expect(undo.canRedo).toBe(false)
    })
  })

  describe('undo', () => {
    it('returns before snapshot', async () => {
      const before = snapshot([1, 2, 3])
      const after = snapshot([4, 5, 6])
      undo.beginOperation(before)
      undo.commitOperation(after)

      const result = await undo.undo()
      expect(result).not.toBeNull()
      expect(result!.type).toBe('layer')
      if (result!.type === 'layer') {
        expect(Array.from(result!.before.data)).toEqual([1, 2, 3])
      }
    })

    it('returns null when nothing to undo', async () => {
      expect(await undo.undo()).toBeNull()
    })

    it('moves entry to redo stack', async () => {
      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      await undo.undo()
      expect(undo.canUndo).toBe(false)
      expect(undo.canRedo).toBe(true)
    })
  })

  describe('redo', () => {
    it('returns after snapshot', async () => {
      const before = snapshot([1, 2, 3])
      const after = snapshot([4, 5, 6])
      undo.beginOperation(before)
      undo.commitOperation(after)
      await undo.undo()

      const result = await undo.redo()
      expect(result).not.toBeNull()
      expect(result!.type).toBe('layer')
      if (result!.type === 'layer') {
        expect(Array.from(result!.after.data)).toEqual([4, 5, 6])
      }
    })

    it('returns null when nothing to redo', async () => {
      expect(await undo.redo()).toBeNull()
    })

    it('moves entry back to undo stack', async () => {
      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      await undo.undo()
      await undo.redo()
      expect(undo.canUndo).toBe(true)
      expect(undo.canRedo).toBe(false)
    })
  })

  describe('stack depth limit', () => {
    it('trims undo stack at 50 entries', () => {
      for (let i = 0; i < 60; i++) {
        undo.beginOperation(snapshot([i]))
        undo.commitOperation(snapshot([i + 100]))
      }
      expect(undo.undoDepth).toBe(50)
    })
  })

  describe('cancelOperation', () => {
    it('discards pending operation without pushing to undo stack', () => {
      undo.beginOperation(snapshot([1]))
      undo.cancelOperation()
      expect(undo.canUndo).toBe(false)
    })

    it('commitOperation after cancel does nothing', () => {
      undo.beginOperation(snapshot([1]))
      undo.cancelOperation()
      undo.commitOperation(snapshot([2]))
      expect(undo.canUndo).toBe(false)
    })
  })

  describe('change callback', () => {
    it('fires on commit', () => {
      const cb = vi.fn()
      undo.setChangeCallback(cb)
      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      expect(cb).toHaveBeenCalledWith(true, false)
    })

    it('fires on undo', async () => {
      const cb = vi.fn()
      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      undo.setChangeCallback(cb)
      await undo.undo()
      expect(cb).toHaveBeenCalledWith(false, true)
    })

    it('fires on redo', async () => {
      const cb = vi.fn()
      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      await undo.undo()
      undo.setChangeCallback(cb)
      await undo.redo()
      expect(cb).toHaveBeenCalledWith(true, false)
    })
  })

  describe('pushEntry (selection undo)', () => {
    it('pushes a selection entry onto the undo stack', () => {
      undo.pushEntry({
        type: 'selection',
        before: new Uint8Array([0, 0, 0]),
        after: new Uint8Array([255, 255, 255]),
      })
      expect(undo.canUndo).toBe(true)
      expect(undo.undoDepth).toBe(1)
    })

    it('clears redo stack on push', async () => {
      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      await undo.undo()
      expect(undo.canRedo).toBe(true)

      undo.pushEntry({
        type: 'selection',
        before: new Uint8Array([0]),
        after: new Uint8Array([1]),
      })
      expect(undo.canRedo).toBe(false)
    })

    it('selection entry can be undone and redone', async () => {
      undo.pushEntry({
        type: 'selection',
        before: new Uint8Array([0, 0]),
        after: new Uint8Array([255, 255]),
      })
      const entry = await undo.undo()
      expect(entry).not.toBeNull()
      expect(entry!.type).toBe('selection')
      if (entry!.type === 'selection') {
        expect(Array.from(entry!.before)).toEqual([0, 0])
      }

      const redone = await undo.redo()
      expect(redone).not.toBeNull()
      if (redone!.type === 'selection') {
        expect(Array.from(redone!.after)).toEqual([255, 255])
      }
    })

    it('interleaves with layer entries', async () => {
      undo.beginOperation(snapshot([10]))
      undo.commitOperation(snapshot([20]))
      undo.pushEntry({
        type: 'selection',
        before: new Uint8Array([0]),
        after: new Uint8Array([1]),
      })
      undo.beginOperation(snapshot([30]))
      undo.commitOperation(snapshot([40]))

      expect(undo.undoDepth).toBe(3)

      // Undo layer entry
      const e3 = await undo.undo()
      expect(e3!.type).toBe('layer')

      // Undo selection entry
      const e2 = await undo.undo()
      expect(e2!.type).toBe('selection')

      // Undo first layer entry
      const e1 = await undo.undo()
      expect(e1!.type).toBe('layer')
    })

    it('respects max undo states', () => {
      for (let i = 0; i < 55; i++) {
        undo.pushEntry({
          type: 'selection',
          before: new Uint8Array([i]),
          after: new Uint8Array([i + 100]),
        })
      }
      expect(undo.undoDepth).toBe(50)
    })
  })

  describe('clear', () => {
    it('empties both stacks', async () => {
      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      undo.beginOperation(snapshot([]))
      undo.commitOperation(snapshot([]))
      await undo.undo()

      undo.clear()
      expect(undo.canUndo).toBe(false)
      expect(undo.canRedo).toBe(false)
    })
  })
})
