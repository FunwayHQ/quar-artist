import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TransformController } from './TransformController.ts'

describe('TransformController', () => {
  let ctrl: TransformController

  beforeEach(() => {
    ctrl = new TransformController()
  })

  it('starts inactive', () => {
    expect(ctrl.isActive()).toBe(false)
  })

  describe('begin', () => {
    it('activates the transform', () => {
      ctrl.begin({ x: 0, y: 0, width: 100, height: 100 })
      expect(ctrl.isActive()).toBe(true)
    })
  })

  describe('cancel', () => {
    it('deactivates the transform', () => {
      ctrl.begin({ x: 0, y: 0, width: 100, height: 100 })
      ctrl.cancel()
      expect(ctrl.isActive()).toBe(false)
    })
  })

  describe('apply', () => {
    it('returns final state and deactivates', () => {
      ctrl.begin({ x: 0, y: 0, width: 100, height: 100 })
      const result = ctrl.apply()
      expect(result).not.toBeNull()
      expect(ctrl.isActive()).toBe(false)
    })

    it('returns null when not active', () => {
      expect(ctrl.apply()).toBeNull()
    })
  })

  describe('pointer events', () => {
    beforeEach(() => {
      ctrl.begin({ x: 0, y: 0, width: 100, height: 100 })
    })

    it('handlePointerDown returns true when hitting a handle', () => {
      // Bottom-right handle is at (100, 100)
      const result = ctrl.handlePointerDown({ x: 100, y: 100 })
      expect(result).toBe(true)
    })

    it('handlePointerDown returns true when inside bounds', () => {
      const result = ctrl.handlePointerDown({ x: 50, y: 50 })
      expect(result).toBe(true)
    })

    it('handlePointerDown returns false when outside bounds', () => {
      const result = ctrl.handlePointerDown({ x: 200, y: 200 })
      expect(result).toBe(false)
    })

    it('handlePointerDown returns false when not active', () => {
      ctrl.cancel()
      const result = ctrl.handlePointerDown({ x: 50, y: 50 })
      expect(result).toBe(false)
    })

    it('move drag translates the transform', () => {
      ctrl.handlePointerDown({ x: 50, y: 50 }) // inside bounds
      ctrl.handlePointerMove({ x: 70, y: 80 })

      const state = ctrl.manager.getState()
      expect(state).not.toBeNull()
      expect(state!.translateX).toBe(20)
      expect(state!.translateY).toBe(30)
    })

    it('handle drag scales the transform', () => {
      // bottomRight handle at (100, 100)
      ctrl.handlePointerDown({ x: 100, y: 100 })
      ctrl.handlePointerMove({ x: 150, y: 150 })

      const state = ctrl.manager.getState()
      expect(state).not.toBeNull()
      expect(state!.scaleX).toBeGreaterThan(1)
      expect(state!.scaleY).toBeGreaterThan(1)
    })

    it('handlePointerUp ends drag', () => {
      ctrl.handlePointerDown({ x: 50, y: 50 })
      ctrl.handlePointerUp()
      // Further moves should not affect transform
      ctrl.handlePointerMove({ x: 200, y: 200 })
      const state = ctrl.manager.getState()
      expect(state!.translateX).toBe(0)
    })
  })

  describe('drawOverlay', () => {
    it('does nothing when not active', () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
      } as unknown as CanvasRenderingContext2D
      ctrl.drawOverlay(ctx, 1)
      expect(ctx.save).not.toHaveBeenCalled()
    })

    it('draws when active', () => {
      ctrl.begin({ x: 0, y: 0, width: 100, height: 100 })
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        arc: vi.fn(),
        setLineDash: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
      } as unknown as CanvasRenderingContext2D
      ctrl.drawOverlay(ctx, 1)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      // Should draw bounding box and handles
      expect(ctx.stroke).toHaveBeenCalled()
      expect(ctx.fillRect).toHaveBeenCalled()
    })
  })
})
