import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FreehandSelection } from './FreehandSelection.ts'
import type { SelectionManager } from '../SelectionManager.ts'

function createMockManager(): SelectionManager {
  return {
    fillPolygon: vi.fn(),
  } as unknown as SelectionManager
}

describe('FreehandSelection', () => {
  let tool: FreehandSelection
  let manager: ReturnType<typeof createMockManager>

  beforeEach(() => {
    tool = new FreehandSelection()
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

    it('stores the initial point', () => {
      tool.begin({ x: 10, y: 20 })
      const points = tool.getPoints()
      expect(points).toHaveLength(1)
      expect(points[0]).toEqual({ x: 10, y: 20 })
    })
  })

  describe('update', () => {
    it('does nothing when not active', () => {
      tool.update({ x: 50, y: 50 })
      expect(tool.isActive()).toBe(false)
    })

    it('adds points when moved enough', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 10, y: 10 }) // distance > 2px
      expect(tool.getPoints()).toHaveLength(2)
    })

    it('ignores points too close together', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 1, y: 0 }) // distance = 1px < 2px threshold
      expect(tool.getPoints()).toHaveLength(1)
    })

    it('accumulates multiple distant points', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 10, y: 0 })
      tool.update({ x: 20, y: 0 })
      tool.update({ x: 30, y: 10 })
      expect(tool.getPoints()).toHaveLength(4)
    })

    it('uses minimum 2px distance threshold', () => {
      tool.begin({ x: 0, y: 0 })
      // Exactly sqrt(4) = 2px — threshold is dx*dx + dy*dy >= 4
      tool.update({ x: 2, y: 0 })
      expect(tool.getPoints()).toHaveLength(2)
    })
  })

  describe('commit', () => {
    it('applies polygon to manager when 3+ points exist', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 50, y: 0 })
      tool.update({ x: 50, y: 50 })
      tool.commit(manager, 'replace')

      expect(manager.fillPolygon).toHaveBeenCalledTimes(1)
      const callPoints = (manager.fillPolygon as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callPoints).toHaveLength(3)
      expect((manager.fillPolygon as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('replace')
      expect(tool.isActive()).toBe(false)
    })

    it('cancels when fewer than 3 points', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 50, y: 0 })
      tool.commit(manager, 'replace')

      expect(manager.fillPolygon).not.toHaveBeenCalled()
      expect(tool.isActive()).toBe(false)
    })

    it('does nothing when not active', () => {
      tool.commit(manager, 'replace')
      expect(manager.fillPolygon).not.toHaveBeenCalled()
    })

    it('passes selection mode through', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 50, y: 0 })
      tool.update({ x: 50, y: 50 })
      tool.commit(manager, 'intersect')
      expect((manager.fillPolygon as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('intersect')
    })

    it('clears points after commit', () => {
      tool.begin({ x: 0, y: 0 })
      tool.update({ x: 50, y: 0 })
      tool.update({ x: 50, y: 50 })
      tool.commit(manager, 'replace')
      expect(tool.getPoints()).toHaveLength(0)
    })
  })

  describe('cancel', () => {
    it('deactivates and clears points', () => {
      tool.begin({ x: 10, y: 20 })
      tool.update({ x: 50, y: 60 })
      tool.cancel()
      expect(tool.isActive()).toBe(false)
      expect(tool.getPoints()).toHaveLength(0)
    })
  })

  describe('getPoints', () => {
    it('returns readonly array', () => {
      tool.begin({ x: 0, y: 0 })
      const points = tool.getPoints()
      // Should be readonly — can't push (TypeScript enforces, runtime check the length)
      expect(points).toHaveLength(1)
    })

    it('returns copies of input points (not references)', () => {
      const p = { x: 10, y: 20 }
      tool.begin(p)
      p.x = 999
      expect(tool.getPoints()[0].x).toBe(10)
    })
  })
})
