import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarchingAnts } from './MarchingAnts.ts'

// Mock canvas context
function createMockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    lineWidth: 1,
    lineDashOffset: 0,
  } as unknown as CanvasRenderingContext2D
}

describe('MarchingAnts', () => {
  let ma: MarchingAnts

  beforeEach(() => {
    ma = new MarchingAnts()
    // Mock requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: () => void) => {
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('starts not running', () => {
    expect(ma.isRunning()).toBe(false)
  })

  describe('start', () => {
    it('starts animation with segments', () => {
      const ctx = createMockCtx()
      const segments = [{ x1: 0, y1: 0, x2: 10, y2: 0 }]
      ma.start(ctx, segments)
      expect(ma.isRunning()).toBe(true)
    })

    it('does not start if no segments', () => {
      const ctx = createMockCtx()
      ma.start(ctx, [])
      expect(ma.isRunning()).toBe(false)
    })
  })

  describe('stop', () => {
    it('stops animation', () => {
      const ctx = createMockCtx()
      ma.start(ctx, [{ x1: 0, y1: 0, x2: 10, y2: 0 }])
      ma.stop()
      expect(ma.isRunning()).toBe(false)
      expect(cancelAnimationFrame).toHaveBeenCalled()
    })
  })

  describe('advance', () => {
    it('increments dash offset', () => {
      expect(ma.getDashOffset()).toBe(0)
      ma.advance()
      expect(ma.getDashOffset()).toBeGreaterThan(0)
    })

    it('wraps dash offset', () => {
      // Advance many times to trigger wrap
      for (let i = 0; i < 100; i++) {
        ma.advance()
      }
      // Should wrap at dashLength * 2 = 12
      expect(ma.getDashOffset()).toBeLessThan(12)
    })
  })

  describe('draw', () => {
    it('draws black and white dashed lines', () => {
      const ctx = createMockCtx()
      const segments = [
        { x1: 0, y1: 0, x2: 10, y2: 0 },
        { x1: 10, y1: 0, x2: 10, y2: 10 },
      ]
      ma.draw(ctx, segments, 1)

      // Should save and restore context
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      // Should stroke twice (black + white dashes)
      expect(ctx.stroke).toHaveBeenCalledTimes(2)
      // Should draw all segments in each pass
      expect(ctx.moveTo).toHaveBeenCalledTimes(4)
      expect(ctx.lineTo).toHaveBeenCalledTimes(4)
    })

    it('does nothing with empty segments', () => {
      const ctx = createMockCtx()
      ma.draw(ctx, [], 1)
      expect(ctx.stroke).not.toHaveBeenCalled()
    })

    it('scales line width and dash with zoom', () => {
      const ctx = createMockCtx()
      const segments = [{ x1: 0, y1: 0, x2: 10, y2: 0 }]
      ma.draw(ctx, segments, 2)
      // lineWidth should be 1/zoom = 0.5
      expect(ctx.lineWidth).toBe(0.5)
    })
  })

  describe('updateSegments', () => {
    it('updates segments without restarting', () => {
      const ctx = createMockCtx()
      ma.start(ctx, [{ x1: 0, y1: 0, x2: 10, y2: 0 }])
      ma.advance() // Build up some offset
      const offset = ma.getDashOffset()

      ma.updateSegments([{ x1: 5, y1: 5, x2: 15, y2: 5 }])
      // Offset should be preserved
      expect(ma.getDashOffset()).toBe(offset)
      expect(ma.isRunning()).toBe(true)
    })

    it('stops when segments are empty', () => {
      const ctx = createMockCtx()
      ma.start(ctx, [{ x1: 0, y1: 0, x2: 10, y2: 0 }])
      ma.updateSegments([])
      expect(ma.isRunning()).toBe(false)
    })
  })

  describe('destroy', () => {
    it('stops animation and clears state', () => {
      const ctx = createMockCtx()
      ma.start(ctx, [{ x1: 0, y1: 0, x2: 10, y2: 0 }])
      ma.destroy()
      expect(ma.isRunning()).toBe(false)
    })
  })
})
