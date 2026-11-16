import { describe, it, expect, beforeEach } from 'vitest'
import { TransformManager } from './TransformManager.ts'

describe('TransformManager', () => {
  let tm: TransformManager

  beforeEach(() => {
    tm = new TransformManager()
  })

  it('starts inactive', () => {
    expect(tm.isActive()).toBe(false)
    expect(tm.getState()).toBeNull()
  })

  describe('begin', () => {
    it('activates the transform', () => {
      tm.begin({ x: 10, y: 20, width: 100, height: 50 })
      expect(tm.isActive()).toBe(true)
    })

    it('initializes state with correct pivot', () => {
      tm.begin({ x: 10, y: 20, width: 100, height: 50 })
      const state = tm.getState()
      expect(state).not.toBeNull()
      expect(state!.pivotX).toBe(60) // 10 + 100/2
      expect(state!.pivotY).toBe(45) // 20 + 50/2
      expect(state!.scaleX).toBe(1)
      expect(state!.scaleY).toBe(1)
      expect(state!.rotation).toBe(0)
      expect(state!.translateX).toBe(0)
      expect(state!.translateY).toBe(0)
    })
  })

  describe('cancel', () => {
    it('deactivates and clears state', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.cancel()
      expect(tm.isActive()).toBe(false)
      expect(tm.getState()).toBeNull()
    })
  })

  describe('apply', () => {
    it('returns the final state and deactivates', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.translate(10, 20)
      const result = tm.apply()
      expect(result).not.toBeNull()
      expect(result!.translateX).toBe(10)
      expect(result!.translateY).toBe(20)
      expect(tm.isActive()).toBe(false)
    })

    it('returns null when not active', () => {
      expect(tm.apply()).toBeNull()
    })
  })

  describe('translate', () => {
    it('accumulates translation', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.translate(5, 10)
      tm.translate(3, 7)
      expect(tm.getState()!.translateX).toBe(8)
      expect(tm.getState()!.translateY).toBe(17)
    })

    it('does nothing when not active', () => {
      tm.translate(5, 10)
      expect(tm.getState()).toBeNull()
    })
  })

  describe('setTranslation', () => {
    it('sets absolute translation', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.setTranslation(50, 60)
      expect(tm.getState()!.translateX).toBe(50)
      expect(tm.getState()!.translateY).toBe(60)
    })
  })

  describe('setScale', () => {
    it('sets scale factors', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.setScale(2, 0.5)
      expect(tm.getState()!.scaleX).toBe(2)
      expect(tm.getState()!.scaleY).toBe(0.5)
    })
  })

  describe('setRotation', () => {
    it('sets rotation in radians', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.setRotation(Math.PI / 4)
      expect(tm.getState()!.rotation).toBeCloseTo(Math.PI / 4)
    })
  })

  describe('getHandlePositions', () => {
    it('returns null when not active', () => {
      expect(tm.getHandlePositions()).toBeNull()
    })

    it('returns handle positions at identity transform', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      const handles = tm.getHandlePositions()!
      expect(handles.topLeft.x).toBeCloseTo(0)
      expect(handles.topLeft.y).toBeCloseTo(0)
      expect(handles.bottomRight.x).toBeCloseTo(100)
      expect(handles.bottomRight.y).toBeCloseTo(100)
      expect(handles.topCenter.x).toBeCloseTo(50)
      expect(handles.topCenter.y).toBeCloseTo(0)
    })

    it('accounts for translation', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.setTranslation(10, 20)
      const handles = tm.getHandlePositions()!
      expect(handles.topLeft.x).toBeCloseTo(10)
      expect(handles.topLeft.y).toBeCloseTo(20)
    })

    it('accounts for scale', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.setScale(2, 2)
      const handles = tm.getHandlePositions()!
      // Pivot is at (50, 50), scaled by 2 means half-width is 100
      expect(handles.topLeft.x).toBeCloseTo(-50)
      expect(handles.topLeft.y).toBeCloseTo(-50)
      expect(handles.bottomRight.x).toBeCloseTo(150)
      expect(handles.bottomRight.y).toBeCloseTo(150)
    })

    it('rotation handle is above top center', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      const handles = tm.getHandlePositions()!
      expect(handles.rotation.x).toBeCloseTo(50) // same x as topCenter
      expect(handles.rotation.y).toBeCloseTo(-20) // 20px above top
    })
  })

  describe('hitTestHandle', () => {
    it('returns null when not active', () => {
      expect(tm.hitTestHandle({ x: 0, y: 0 })).toBeNull()
    })

    it('detects handle under cursor', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      // Top-left handle is at (0, 0)
      expect(tm.hitTestHandle({ x: 2, y: 2 })).toBe('topLeft')
      // Bottom-right handle is at (100, 100)
      expect(tm.hitTestHandle({ x: 99, y: 99 })).toBe('bottomRight')
    })

    it('returns null when not near any handle', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      expect(tm.hitTestHandle({ x: 50, y: 50 })).toBeNull()
    })
  })

  describe('isInsideBounds', () => {
    it('returns false when not active', () => {
      expect(tm.isInsideBounds({ x: 50, y: 50 })).toBe(false)
    })

    it('detects points inside the bounds', () => {
      tm.begin({ x: 10, y: 10, width: 80, height: 80 })
      expect(tm.isInsideBounds({ x: 50, y: 50 })).toBe(true)
      expect(tm.isInsideBounds({ x: 15, y: 15 })).toBe(true)
    })

    it('detects points outside the bounds', () => {
      tm.begin({ x: 10, y: 10, width: 80, height: 80 })
      expect(tm.isInsideBounds({ x: 5, y: 5 })).toBe(false)
      expect(tm.isInsideBounds({ x: 95, y: 95 })).toBe(false)
    })

    it('works with translation', () => {
      tm.begin({ x: 10, y: 10, width: 80, height: 80 })
      tm.setTranslation(100, 100)
      expect(tm.isInsideBounds({ x: 50, y: 50 })).toBe(false) // original pos
      expect(tm.isInsideBounds({ x: 150, y: 150 })).toBe(true) // new pos
    })
  })

  describe('dragHandle', () => {
    it('scales when dragging bottomRight handle', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      const start = { x: 100, y: 100 }
      const current = { x: 150, y: 150 }
      const result = tm.dragHandle('bottomRight', current, start, false)
      expect(result).not.toBeNull()
      expect(result!.scaleX).toBeCloseTo(1.5)
      expect(result!.scaleY).toBeCloseTo(1.5)
    })

    it('constrains to uniform scale with Shift', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 200 })
      const start = { x: 100, y: 200 }
      const current = { x: 200, y: 250 }
      const result = tm.dragHandle('bottomRight', current, start, true)
      expect(result!.scaleX).toBe(result!.scaleY)
    })

    it('rotates when dragging rotation handle', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      const start = { x: 50, y: -20 } // rotation handle position
      const current = { x: 100, y: 50 } // dragged to the right
      const result = tm.dragHandle('rotation', current, start, false)
      expect(result).not.toBeNull()
      expect(result!.rotation).not.toBe(0)
    })

    it('returns null when not active', () => {
      expect(tm.dragHandle('bottomRight', { x: 0, y: 0 }, { x: 0, y: 0 }, false)).toBeNull()
    })
  })

  describe('transformPoint', () => {
    it('returns same point when not active', () => {
      const p = { x: 10, y: 20 }
      expect(tm.transformPoint(p)).toEqual(p)
    })

    it('applies translation', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.setTranslation(10, 20)
      const result = tm.transformPoint({ x: 50, y: 50 })
      expect(result.x).toBeCloseTo(60)
      expect(result.y).toBeCloseTo(70)
    })

    it('applies scale around pivot', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.setScale(2, 2)
      // Pivot is (50, 50), point at origin
      const result = tm.transformPoint({ x: 0, y: 0 })
      expect(result.x).toBeCloseTo(-50) // scaled away from pivot
      expect(result.y).toBeCloseTo(-50)
    })
  })

  describe('getTransformedBounds', () => {
    it('returns null when not active', () => {
      expect(tm.getTransformedBounds()).toBeNull()
    })

    it('returns original bounds at identity', () => {
      tm.begin({ x: 10, y: 20, width: 100, height: 50 })
      const bounds = tm.getTransformedBounds()!
      expect(bounds.x).toBeCloseTo(10)
      expect(bounds.y).toBeCloseTo(20)
      expect(bounds.width).toBeCloseTo(100)
      expect(bounds.height).toBeCloseTo(50)
    })

    it('returns translated bounds', () => {
      tm.begin({ x: 0, y: 0, width: 100, height: 100 })
      tm.setTranslation(50, 50)
      const bounds = tm.getTransformedBounds()!
      expect(bounds.x).toBeCloseTo(50)
      expect(bounds.y).toBeCloseTo(50)
    })
  })

  describe('flipHorizontal', () => {
    it('mirrors pixels left-to-right', () => {
      // 2x1 image: pixel 0 is red, pixel 1 is blue
      const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])
      const result = TransformManager.flipHorizontal(pixels, 2, 1)
      // After flip: pixel 0 should be blue, pixel 1 should be red
      expect(result[0]).toBe(0)   // R
      expect(result[1]).toBe(0)   // G
      expect(result[2]).toBe(255) // B
      expect(result[3]).toBe(255) // A
      expect(result[4]).toBe(255) // R
      expect(result[5]).toBe(0)   // G
      expect(result[6]).toBe(0)   // B
      expect(result[7]).toBe(255) // A
    })
  })

  describe('flipVertical', () => {
    it('mirrors pixels top-to-bottom', () => {
      // 1x2 image: row 0 is red, row 1 is blue
      const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])
      const result = TransformManager.flipVertical(pixels, 1, 2)
      // After flip: row 0 should be blue, row 1 should be red
      expect(result[0]).toBe(0)
      expect(result[2]).toBe(255)
      expect(result[4]).toBe(255)
      expect(result[6]).toBe(0)
    })
  })

  describe('rotate90CW', () => {
    it('rotates 2x3 image to 3x2', () => {
      // 2x3 image (w=2, h=3)
      const pixels = new Uint8Array(2 * 3 * 4)
      // Mark top-left (0,0) as red
      pixels[0] = 255; pixels[3] = 255
      const result = TransformManager.rotate90CW(pixels, 2, 3)
      expect(result.width).toBe(3)
      expect(result.height).toBe(2)
      // After CW rotation, top-left (0,0) of original → top-right (2,0) of result
      const idx = (0 * 3 + 2) * 4
      expect(result.pixels[idx]).toBe(255)
    })
  })

  describe('rotate90CCW', () => {
    it('rotates 2x3 image to 3x2', () => {
      const pixels = new Uint8Array(2 * 3 * 4)
      // Mark top-left (0,0) as red
      pixels[0] = 255; pixels[3] = 255
      const result = TransformManager.rotate90CCW(pixels, 2, 3)
      expect(result.width).toBe(3)
      expect(result.height).toBe(2)
      // After CCW rotation, top-left (0,0) of original → bottom-left (0,1) of result
      const idx = (1 * 3 + 0) * 4
      expect(result.pixels[idx]).toBe(255)
    })
  })
})
