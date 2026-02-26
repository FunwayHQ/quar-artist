import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RectangleSelection } from './RectangleSelection.ts'
import type { SelectionManager } from '../SelectionManager.ts'

function createMockManager(): SelectionManager {
  return {
    fillRect: vi.fn(),
  } as unknown as SelectionManager
}

describe('RectangleSelection', () => {
  let tool: RectangleSelection
  let manager: ReturnType<typeof createMockManager>

  beforeEach(() => {
    tool = new RectangleSelection()
    manager = createMockManager()
  })

  it('starts inactive', () => {
    expect(tool.isActive()).toBe(false)
  })

  describe('begin', () => {
    it('activates the tool', () => {
      tool.begin({ x: 10, y: 20 })
      expect(tool.isActive()).toBe(true)
    })
  })

  describe('update', () => {
    it('does nothing when not active', () => {
      tool.update({ x: 50, y: 50 })
      expect(tool.isActive()).toBe(false)
    })

    it('updates current point when active', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 100, y: 50 })
      const preview = tool.getPreviewRect(false)
      expect(preview).not.toBeNull()
      expect(preview!.width).toBe(100)
      expect(preview!.height).toBe(50)
    })
  })

  describe('commit', () => {
    it('applies rectangle to manager and deactivates', () => {
      tool.begin({ x: 10, y: 20 })
      tool.update({ x: 60, y: 70 })
      tool.commit(manager, 'replace', false)

      expect(manager.fillRect).toHaveBeenCalledWith(10, 20, 50, 50, 'replace')
      expect(tool.isActive()).toBe(false)
    })

    it('does nothing when not active', () => {
      tool.commit(manager, 'replace', false)
      expect(manager.fillRect).not.toHaveBeenCalled()
    })

    it('does not apply zero-size rectangle', () => {
      tool.begin({ x: 10, y: 20 })
      // current equals origin — zero size
      tool.commit(manager, 'replace', false)
      expect(manager.fillRect).not.toHaveBeenCalled()
    })

    it('passes selection mode through', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 50, y: 50 })
      tool.commit(manager, 'add', false)
      expect(manager.fillRect).toHaveBeenCalledWith(0, 0, 50, 50, 'add')
    })
  })

  describe('constrain to square', () => {
    it('constrains preview to square', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 100, y: 50 })
      const rect = tool.getPreviewRect(true)
      expect(rect).not.toBeNull()
      expect(rect!.width).toBe(rect!.height)
      expect(rect!.width).toBe(100) // max of width/height
    })

    it('constrains commit to square', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 100, y: 50 })
      tool.commit(manager, 'replace', true)
      const call = (manager.fillRect as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(call[2]).toBe(call[3]) // width === height
    })
  })

  describe('drag direction handling', () => {
    it('handles drag from bottom-right to top-left', () => {
      tool.begin({ x: 100, y: 100 })
      tool.update({ x: 20, y: 30 })
      const rect = tool.getPreviewRect(false)
      expect(rect).not.toBeNull()
      expect(rect!.x).toBe(20)
      expect(rect!.y).toBe(30)
      expect(rect!.width).toBe(80)
      expect(rect!.height).toBe(70)
    })

    it('constrain handles negative drag direction', () => {
      tool.begin({ x: 100, y: 100 })
      tool.update({ x: 50, y: 30 })
      const rect = tool.getPreviewRect(true)
      expect(rect).not.toBeNull()
      // Square should be max(50, 70) = 70
      expect(rect!.width).toBe(rect!.height)
      // Origin should adjust for the constrained square
      expect(rect!.x).toBe(100 - 70)
      expect(rect!.y).toBe(100 - 70)
    })
  })

  describe('cancel', () => {
    it('deactivates and clears state', () => {
      tool.begin({ x: 10, y: 20 })
      tool.cancel()
      expect(tool.isActive()).toBe(false)
      expect(tool.getPreviewRect(false)).toBeNull()
    })
  })

  describe('getPreviewRect', () => {
    it('returns null when not active', () => {
      expect(tool.getPreviewRect(false)).toBeNull()
    })

    it('returns current rectangle dimensions', () => {
      tool.begin({ x: 10, y: 20 })
      tool.update({ x: 60, y: 80 })
      const rect = tool.getPreviewRect(false)
      expect(rect).toEqual({ x: 10, y: 20, width: 50, height: 60 })
    })
  })
})
