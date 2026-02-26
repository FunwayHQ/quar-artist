import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ViewTransform } from './ViewTransform.ts'

describe('ViewTransform', () => {
  let vt: ViewTransform

  beforeEach(() => {
    vt = new ViewTransform()
  })

  describe('initial state', () => {
    it('starts at identity (0,0), zoom=1, rotation=0', () => {
      const s = vt.getState()
      expect(s.x).toBe(0)
      expect(s.y).toBe(0)
      expect(s.zoom).toBe(1)
      expect(s.rotation).toBe(0)
    })
  })

  describe('pan', () => {
    it('translates by delta', () => {
      vt.pan(10, 20)
      expect(vt.getState().x).toBe(10)
      expect(vt.getState().y).toBe(20)
    })

    it('accumulates multiple pans', () => {
      vt.pan(5, 5)
      vt.pan(-3, 10)
      expect(vt.getState().x).toBe(2)
      expect(vt.getState().y).toBe(15)
    })

    it('fires change callback', () => {
      const cb = vi.fn()
      vt.setChangeCallback(cb)
      vt.pan(1, 1)
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ x: 1, y: 1 }))
    })
  })

  describe('zoomAt', () => {
    it('zooms in with negative delta', () => {
      vt.zoomAt(0, 0, -100)
      expect(vt.getState().zoom).toBeGreaterThan(1)
    })

    it('zooms out with positive delta', () => {
      vt.zoomAt(0, 0, 100)
      expect(vt.getState().zoom).toBeLessThan(1)
    })

    it('clamps zoom to minimum 0.1', () => {
      vt.zoomAt(0, 0, 999999)
      expect(vt.getState().zoom).toBeGreaterThanOrEqual(0.1)
    })

    it('clamps zoom to maximum 64', () => {
      vt.zoomAt(0, 0, -999999)
      expect(vt.getState().zoom).toBeLessThanOrEqual(64)
    })

    it('zooms centered at the given screen point', () => {
      // Zoom in at the origin — pan should stay at 0
      vt.zoomAt(0, 0, -100)
      expect(vt.getState().x).toBe(0)
      expect(vt.getState().y).toBe(0)
    })

    it('adjusts pan when zooming at non-origin point', () => {
      vt.zoomAt(500, 300, -100)
      const s = vt.getState()
      // Pan should shift to keep the zoom centered at (500, 300)
      expect(s.x).not.toBe(0)
      expect(s.y).not.toBe(0)
    })
  })

  describe('setZoom', () => {
    it('sets zoom directly', () => {
      vt.setZoom(4, 0, 0)
      expect(vt.getState().zoom).toBe(4)
    })

    it('clamps to min/max', () => {
      vt.setZoom(0.01, 0, 0)
      expect(vt.getState().zoom).toBe(0.1)

      vt.setZoom(200, 0, 0)
      expect(vt.getState().zoom).toBe(64)
    })
  })

  describe('rotate', () => {
    it('rotates by delta radians', () => {
      vt.rotate(Math.PI / 4, 0, 0)
      expect(vt.getState().rotation).toBeCloseTo(Math.PI / 4)
    })

    it('accumulates rotation', () => {
      vt.rotate(Math.PI / 4, 0, 0)
      vt.rotate(Math.PI / 4, 0, 0)
      expect(vt.getState().rotation).toBeCloseTo(Math.PI / 2)
    })

    it('adjusts pan when rotating around a non-origin point', () => {
      vt.pan(100, 100)
      vt.rotate(Math.PI / 2, 200, 200)
      const s = vt.getState()
      // After 90-degree rotation of (100,100) around (200,200):
      // dx=-100, dy=-100 => x = cos*dx - sin*dy + cx = 0+100+200 = 300
      // y = sin*dx + cos*dy + cy = -100+0+200 = 100
      expect(s.x).toBeCloseTo(300)
      expect(s.y).toBeCloseTo(100)
      expect(s.rotation).toBeCloseTo(Math.PI / 2)
    })
  })

  describe('reset', () => {
    it('restores identity state', () => {
      vt.pan(50, 50)
      vt.zoomAt(0, 0, -100)
      vt.rotate(1, 0, 0)
      vt.reset()
      const s = vt.getState()
      expect(s.x).toBe(0)
      expect(s.y).toBe(0)
      expect(s.zoom).toBe(1)
      expect(s.rotation).toBe(0)
    })
  })

  describe('screenToCanvas', () => {
    it('returns identity conversion at default state', () => {
      const p = vt.screenToCanvas(100, 200)
      expect(p.x).toBe(100)
      expect(p.y).toBe(200)
    })

    it('accounts for pan', () => {
      vt.pan(50, 50)
      const p = vt.screenToCanvas(100, 100)
      expect(p.x).toBe(50)
      expect(p.y).toBe(50)
    })

    it('accounts for zoom', () => {
      vt.setZoom(2, 0, 0)
      const p = vt.screenToCanvas(100, 100)
      expect(p.x).toBeCloseTo(50)
      expect(p.y).toBeCloseTo(50)
    })

    it('accounts for rotation', () => {
      vt.rotate(Math.PI / 2, 0, 0)
      const p = vt.screenToCanvas(100, 0)
      // 90-degree CCW rotation of (100, 0) relative to origin
      expect(p.x).toBeCloseTo(0, 0)
      expect(p.y).not.toBe(0)
    })
  })

  describe('change callback', () => {
    it('receives a copy of state (not the same reference)', () => {
      let received: unknown = null
      vt.setChangeCallback((s) => {
        received = s
      })
      vt.pan(1, 1)
      expect(received).not.toBe(vt.getState())
    })

    it('does not fire when no callback is set', () => {
      // Should not throw
      expect(() => vt.pan(1, 1)).not.toThrow()
    })
  })
})
