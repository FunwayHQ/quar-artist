import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MagicWandSelection } from './MagicWandSelection.ts'
import type { SelectionManager } from '../SelectionManager.ts'

function createMockManager(): SelectionManager {
  return {
    magicWand: vi.fn(),
  } as unknown as SelectionManager
}

describe('MagicWandSelection', () => {
  let tool: MagicWandSelection
  let manager: ReturnType<typeof createMockManager>

  beforeEach(() => {
    tool = new MagicWandSelection()
    manager = createMockManager()
  })

  describe('defaults', () => {
    it('starts with tolerance 10 and contiguous true', () => {
      const opts = tool.getOptions()
      expect(opts.tolerance).toBe(10)
      expect(opts.contiguous).toBe(true)
    })
  })

  describe('setOptions', () => {
    it('updates tolerance', () => {
      tool.setOptions({ tolerance: 50 })
      expect(tool.getOptions().tolerance).toBe(50)
    })

    it('updates contiguous', () => {
      tool.setOptions({ contiguous: false })
      expect(tool.getOptions().contiguous).toBe(false)
    })

    it('clamps tolerance to 0-255', () => {
      tool.setOptions({ tolerance: -10 })
      expect(tool.getOptions().tolerance).toBe(0)
      tool.setOptions({ tolerance: 300 })
      expect(tool.getOptions().tolerance).toBe(255)
    })

    it('accepts partial updates', () => {
      tool.setOptions({ tolerance: 50 })
      tool.setOptions({ contiguous: false })
      expect(tool.getOptions().tolerance).toBe(50)
      expect(tool.getOptions().contiguous).toBe(false)
    })
  })

  describe('getOptions', () => {
    it('returns a copy (not a reference)', () => {
      const opts = tool.getOptions()
      ;(opts as { tolerance: number }).tolerance = 999
      expect(tool.getOptions().tolerance).toBe(10)
    })
  })

  describe('select', () => {
    it('calls manager.magicWand with correct parameters', () => {
      const pixels = new Uint8Array(100 * 4)
      tool.select(5, 3, pixels, manager, 'replace')

      expect(manager.magicWand).toHaveBeenCalledWith(
        5, 3, pixels, 10, true, 'replace',
      )
    })

    it('passes current options to manager', () => {
      tool.setOptions({ tolerance: 30, contiguous: false })
      const pixels = new Uint8Array(100 * 4)
      tool.select(10, 10, pixels, manager, 'add')

      expect(manager.magicWand).toHaveBeenCalledWith(
        10, 10, pixels, 30, false, 'add',
      )
    })

    it('passes different selection modes', () => {
      const pixels = new Uint8Array(100 * 4)
      tool.select(0, 0, pixels, manager, 'subtract')
      expect((manager.magicWand as ReturnType<typeof vi.fn>).mock.calls[0][5]).toBe('subtract')

      tool.select(0, 0, pixels, manager, 'intersect')
      expect((manager.magicWand as ReturnType<typeof vi.fn>).mock.calls[1][5]).toBe('intersect')
    })
  })
})
