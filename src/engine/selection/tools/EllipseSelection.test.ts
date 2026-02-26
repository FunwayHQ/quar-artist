import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EllipseSelection } from './EllipseSelection.ts'
import type { SelectionManager } from '../SelectionManager.ts'

function createMockManager(): SelectionManager {
  return {
    fillEllipse: vi.fn(),
  } as unknown as SelectionManager
}

describe('EllipseSelection', () => {
  let tool: EllipseSelection
  let manager: ReturnType<typeof createMockManager>

  beforeEach(() => {
    tool = new EllipseSelection()
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
      tool.update({ x: 100, y: 60 })
      const preview = tool.getPreviewEllipse(false)
      expect(preview).not.toBeNull()
      expect(preview!.rx).toBe(50)
      expect(preview!.ry).toBe(30)
    })
  })

  describe('commit', () => {
    it('applies ellipse to manager and deactivates', () => {
      tool.begin({ x: 10, y: 20 })
      tool.update({ x: 110, y: 80 })
      tool.commit(manager, 'replace', false)

      // Center = (60, 50), rx = 50, ry = 30
      expect(manager.fillEllipse).toHaveBeenCalledWith(60, 50, 50, 30, 'replace')
      expect(tool.isActive()).toBe(false)
    })

    it('does nothing when not active', () => {
      tool.commit(manager, 'replace', false)
      expect(manager.fillEllipse).not.toHaveBeenCalled()
    })

    it('does not apply zero-radius ellipse', () => {
      tool.begin({ x: 10, y: 20 })
      // current equals origin — zero radii
      tool.commit(manager, 'replace', false)
      expect(manager.fillEllipse).not.toHaveBeenCalled()
    })

    it('passes selection mode through', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 100, y: 100 })
      tool.commit(manager, 'subtract', false)
      expect(manager.fillEllipse).toHaveBeenCalledWith(50, 50, 50, 50, 'subtract')
    })
  })

  describe('constrain to circle', () => {
    it('constrains preview to circle', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 100, y: 50 })
      const ellipse = tool.getPreviewEllipse(true)
      expect(ellipse).not.toBeNull()
      expect(ellipse!.rx).toBe(ellipse!.ry)
      expect(ellipse!.rx).toBe(50) // max(100, 50)/2
    })

    it('constrains commit to circle', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 100, y: 50 })
      tool.commit(manager, 'replace', true)
      const call = (manager.fillEllipse as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(call[2]).toBe(call[3]) // rx === ry
    })
  })

  describe('drag direction handling', () => {
    it('handles drag from bottom-right to top-left', () => {
      tool.begin({ x: 100, y: 100 })
      tool.update({ x: 20, y: 40 })
      const ellipse = tool.getPreviewEllipse(false)
      expect(ellipse).not.toBeNull()
      expect(ellipse!.cx).toBe(60) // center x
      expect(ellipse!.cy).toBe(70) // center y
      expect(ellipse!.rx).toBe(40) // half of 80
      expect(ellipse!.ry).toBe(30) // half of 60
    })
  })

  describe('cancel', () => {
    it('deactivates and clears state', () => {
      tool.begin({ x: 10, y: 20 })
      tool.cancel()
      expect(tool.isActive()).toBe(false)
      expect(tool.getPreviewEllipse(false)).toBeNull()
    })
  })

  describe('getPreviewEllipse', () => {
    it('returns null when not active', () => {
      expect(tool.getPreviewEllipse(false)).toBeNull()
    })

    it('returns current ellipse parameters', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 200, y: 100 })
      const ellipse = tool.getPreviewEllipse(false)
      expect(ellipse).toEqual({ cx: 100, cy: 50, rx: 100, ry: 50 })
    })
  })
})
