import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SelectionManager } from './SelectionManager.ts'

describe('SelectionManager', () => {
  let sm: SelectionManager

  beforeEach(() => {
    sm = new SelectionManager(10, 10)
  })

  describe('constructor', () => {
    it('creates a mask of correct size', () => {
      expect(sm.getMask().length).toBe(100)
      expect(sm.getWidth()).toBe(10)
      expect(sm.getHeight()).toBe(10)
    })

    it('starts with no selection', () => {
      expect(sm.hasSelection()).toBe(false)
    })
  })

  describe('resize', () => {
    it('resizes the mask and clears selection', () => {
      sm.selectAll()
      sm.resize(20, 15)
      expect(sm.getWidth()).toBe(20)
      expect(sm.getHeight()).toBe(15)
      expect(sm.getMask().length).toBe(300)
      expect(sm.hasSelection()).toBe(false)
    })
  })

  describe('getPixel / setPixel', () => {
    it('sets and gets pixel values', () => {
      sm.setPixel(5, 5, 200)
      expect(sm.getPixel(5, 5)).toBe(200)
    })

    it('clamps values to 0-255', () => {
      sm.setPixel(0, 0, 300)
      expect(sm.getPixel(0, 0)).toBe(255)
      sm.setPixel(0, 0, -10)
      expect(sm.getPixel(0, 0)).toBe(0)
    })

    it('returns 0 for out-of-bounds', () => {
      expect(sm.getPixel(-1, 0)).toBe(0)
      expect(sm.getPixel(0, -1)).toBe(0)
      expect(sm.getPixel(10, 0)).toBe(0)
      expect(sm.getPixel(0, 10)).toBe(0)
    })

    it('ignores out-of-bounds sets', () => {
      sm.setPixel(-1, 0, 255)
      sm.setPixel(10, 0, 255)
      expect(sm.hasSelection()).toBe(false)
    })
  })

  describe('selectAll', () => {
    it('fills all pixels to 255', () => {
      sm.selectAll()
      expect(sm.hasSelection()).toBe(true)
      const mask = sm.getMask()
      for (let i = 0; i < mask.length; i++) {
        expect(mask[i]).toBe(255)
      }
    })
  })

  describe('clearSelection', () => {
    it('clears all pixels to 0', () => {
      sm.selectAll()
      sm.clearSelection()
      expect(sm.hasSelection()).toBe(false)
    })
  })

  describe('invertSelection', () => {
    it('inverts all pixel values', () => {
      sm.fillRect(0, 0, 5, 5, 'replace')
      sm.invertSelection()
      // Top-left 5x5 should be 0, rest should be 255
      expect(sm.getPixel(0, 0)).toBe(0)
      expect(sm.getPixel(4, 4)).toBe(0)
      expect(sm.getPixel(5, 0)).toBe(255)
      expect(sm.getPixel(0, 5)).toBe(255)
      expect(sm.getPixel(9, 9)).toBe(255)
    })
  })

  describe('fillRect', () => {
    it('fills a rectangular region (replace mode)', () => {
      sm.fillRect(2, 3, 4, 3, 'replace')
      expect(sm.getPixel(2, 3)).toBe(255)
      expect(sm.getPixel(5, 5)).toBe(255)
      expect(sm.getPixel(1, 3)).toBe(0)
      expect(sm.getPixel(6, 3)).toBe(0)
    })

    it('add mode unions with existing selection', () => {
      sm.fillRect(0, 0, 3, 3, 'replace')
      sm.fillRect(2, 2, 3, 3, 'add')
      // Both areas should be selected
      expect(sm.getPixel(0, 0)).toBe(255)
      expect(sm.getPixel(4, 4)).toBe(255)
    })

    it('subtract mode removes from existing selection', () => {
      sm.fillRect(0, 0, 5, 5, 'replace')
      sm.fillRect(2, 2, 3, 3, 'subtract')
      expect(sm.getPixel(0, 0)).toBe(255)
      expect(sm.getPixel(3, 3)).toBe(0)
    })

    it('intersect mode keeps only overlap', () => {
      sm.fillRect(0, 0, 5, 5, 'replace')
      sm.fillRect(3, 3, 5, 5, 'intersect')
      expect(sm.getPixel(0, 0)).toBe(0)
      expect(sm.getPixel(3, 3)).toBe(255)
      expect(sm.getPixel(4, 4)).toBe(255)
      expect(sm.getPixel(7, 7)).toBe(0)
    })

    it('clamps to canvas bounds', () => {
      sm.fillRect(-5, -5, 20, 20, 'replace')
      expect(sm.hasSelection()).toBe(true)
      expect(sm.getPixel(0, 0)).toBe(255)
      expect(sm.getPixel(9, 9)).toBe(255)
    })
  })

  describe('fillEllipse', () => {
    it('fills an elliptical region', () => {
      sm.fillEllipse(5, 5, 3, 3, 'replace')
      // Center should be selected
      expect(sm.getPixel(5, 5)).toBe(255)
      // Points just inside the circle
      expect(sm.getPixel(3, 5)).toBe(255)
      // Points outside
      expect(sm.getPixel(0, 0)).toBe(0)
    })

    it('supports non-uniform radii', () => {
      sm = new SelectionManager(20, 10)
      sm.fillEllipse(10, 5, 8, 3, 'replace')
      expect(sm.getPixel(10, 5)).toBe(255)
      expect(sm.getPixel(3, 5)).toBe(255) // wide
      expect(sm.getPixel(10, 1)).toBe(0) // narrow — outside (ry=3, center=5, pixel 1.5 is 3.5 away)
    })
  })

  describe('fillPolygon', () => {
    it('fills a triangular polygon', () => {
      sm = new SelectionManager(10, 10)
      sm.fillPolygon([
        { x: 5, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ], 'replace')
      // Center area should be selected
      expect(sm.getPixel(5, 5)).toBe(255)
      // Top-left corner should not be selected
      expect(sm.getPixel(0, 0)).toBe(0)
    })

    it('ignores polygons with fewer than 3 points', () => {
      sm.fillPolygon([{ x: 0, y: 0 }, { x: 5, y: 5 }], 'replace')
      expect(sm.hasSelection()).toBe(false)
    })
  })

  describe('magicWand', () => {
    it('selects matching pixels (contiguous)', () => {
      // Create a 5x5 image with a 3x3 red block in the center
      const pixels = new Uint8Array(10 * 10 * 4)
      // Fill entire image with white
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 255
        pixels[i + 1] = 255
        pixels[i + 2] = 255
        pixels[i + 3] = 255
      }
      // Put a red block at (3,3) to (5,5)
      for (let y = 3; y <= 5; y++) {
        for (let x = 3; x <= 5; x++) {
          const idx = (y * 10 + x) * 4
          pixels[idx] = 255
          pixels[idx + 1] = 0
          pixels[idx + 2] = 0
        }
      }

      sm.magicWand(4, 4, pixels, 10, true, 'replace')
      // Red pixel should be selected
      expect(sm.getPixel(4, 4)).toBe(255)
      expect(sm.getPixel(3, 3)).toBe(255)
      // White pixel should not be selected
      expect(sm.getPixel(0, 0)).toBe(0)
    })

    it('selects all matching pixels (non-contiguous)', () => {
      const pixels = new Uint8Array(10 * 10 * 4)
      // Two separate red pixels
      for (const [x, y] of [[1, 1], [8, 8]]) {
        const idx = (y * 10 + x) * 4
        pixels[idx] = 255
        pixels[idx + 1] = 0
        pixels[idx + 2] = 0
        pixels[idx + 3] = 255
      }

      sm.magicWand(1, 1, pixels, 10, false, 'replace')
      // Both red pixels should be selected
      expect(sm.getPixel(1, 1)).toBe(255)
      expect(sm.getPixel(8, 8)).toBe(255)
    })

    it('respects tolerance', () => {
      const pixels = new Uint8Array(10 * 10 * 4)
      // Fill with color (100, 100, 100, 255)
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 100
        pixels[i + 1] = 100
        pixels[i + 2] = 100
        pixels[i + 3] = 255
      }
      // One pixel slightly different
      pixels[0] = 110
      pixels[1] = 110
      pixels[2] = 110

      // Low tolerance — won't match
      sm.magicWand(0, 0, pixels, 5, false, 'replace')
      expect(sm.getPixel(0, 0)).toBe(255)
      expect(sm.getPixel(1, 0)).toBe(0)

      // Higher tolerance — will match
      sm.magicWand(0, 0, pixels, 15, false, 'replace')
      expect(sm.getPixel(0, 0)).toBe(255)
      expect(sm.getPixel(1, 0)).toBe(255)
    })
  })

  describe('feather', () => {
    it('softens selection edges', () => {
      sm = new SelectionManager(40, 40)
      sm.fillRect(5, 5, 30, 30, 'replace')
      const beforeEdge = sm.getPixel(5, 20)
      expect(beforeEdge).toBe(255)

      sm.feather({ radius: 2 })

      // Center should still be fully selected (large enough selection)
      expect(sm.getPixel(20, 20)).toBe(255)
      // Edge pixels should be partially selected (< 255)
      const afterEdge = sm.getPixel(5, 20)
      expect(afterEdge).toBeLessThan(255)
      expect(afterEdge).toBeGreaterThan(0)
    })

    it('does nothing with radius 0', () => {
      sm.fillRect(0, 0, 5, 5, 'replace')
      const before = new Uint8Array(sm.getMask())
      sm.feather({ radius: 0 })
      expect(sm.getMask()).toEqual(before)
    })
  })

  describe('getBounds', () => {
    it('returns null when no selection', () => {
      expect(sm.getBounds()).toBeNull()
    })

    it('returns correct bounds for a rectangular selection', () => {
      sm.fillRect(2, 3, 4, 3, 'replace')
      const bounds = sm.getBounds()
      expect(bounds).toEqual({ x: 2, y: 3, width: 4, height: 3 })
    })

    it('returns tight bounds for a single pixel', () => {
      sm.setPixel(5, 5, 255)
      const bounds = sm.getBounds()
      expect(bounds).toEqual({ x: 5, y: 5, width: 1, height: 1 })
    })
  })

  describe('extractBoundary', () => {
    it('returns empty for no selection', () => {
      expect(sm.extractBoundary()).toHaveLength(0)
    })

    it('returns boundary segments for a single selected pixel', () => {
      sm.setPixel(5, 5, 255)
      const segments = sm.extractBoundary()
      // A single pixel has 4 boundary edges
      expect(segments.length).toBe(4)
    })

    it('returns boundary segments for a rectangle', () => {
      sm.fillRect(2, 2, 3, 3, 'replace')
      const segments = sm.extractBoundary()
      // A 3x3 rectangle has a perimeter of 12 edges
      expect(segments.length).toBe(12)
    })
  })

  describe('snapshot / restoreSnapshot', () => {
    it('creates a copy and restores', () => {
      sm.fillRect(0, 0, 5, 5, 'replace')
      const snap = sm.snapshot()
      sm.clearSelection()
      expect(sm.hasSelection()).toBe(false)

      sm.restoreSnapshot(snap)
      expect(sm.hasSelection()).toBe(true)
      expect(sm.getPixel(0, 0)).toBe(255)
    })

    it('snapshot is independent of the mask', () => {
      sm.fillRect(0, 0, 5, 5, 'replace')
      const snap = sm.snapshot()
      sm.setPixel(0, 0, 0)
      // Snapshot should still show 255
      expect(snap[0]).toBe(255)
    })

    it('ignores snapshot of wrong size', () => {
      sm.fillRect(0, 0, 5, 5, 'replace')
      sm.restoreSnapshot(new Uint8Array(50)) // wrong size
      // Should still have selection
      expect(sm.hasSelection()).toBe(true)
    })
  })

  describe('change callback', () => {
    it('fires on selectAll', () => {
      const cb = vi.fn()
      sm.setChangeCallback(cb)
      sm.selectAll()
      expect(cb).toHaveBeenCalledWith(true, expect.any(Object))
    })

    it('fires on clearSelection', () => {
      sm.selectAll()
      const cb = vi.fn()
      sm.setChangeCallback(cb)
      sm.clearSelection()
      expect(cb).toHaveBeenCalledWith(false, null)
    })

    it('fires on fillRect', () => {
      const cb = vi.fn()
      sm.setChangeCallback(cb)
      sm.fillRect(0, 0, 5, 5, 'replace')
      expect(cb).toHaveBeenCalledWith(true, expect.any(Object))
    })

    it('fires on invertSelection', () => {
      const cb = vi.fn()
      sm.setChangeCallback(cb)
      sm.invertSelection()
      expect(cb).toHaveBeenCalled()
    })
  })
})
