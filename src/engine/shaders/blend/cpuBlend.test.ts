import { describe, it, expect } from 'vitest'
import { cpuBlendPixel, cpuBlendLayers } from './cpuBlend.ts'
import type { BlendMode } from '../../../types/layer.ts'

describe('cpuBlend', () => {
  describe('cpuBlendPixel', () => {
    // Test against known color pairs
    const white = [1, 1, 1] as const
    const black = [0, 0, 0] as const
    const mid = [0.5, 0.5, 0.5] as const
    const red = [1, 0, 0] as const
    const blue = [0, 0, 1] as const

    it('multiply: white * mid = mid', () => {
      const [r, g, b] = cpuBlendPixel(...white, ...mid, 'multiply')
      expect(r).toBeCloseTo(0.5)
      expect(g).toBeCloseTo(0.5)
      expect(b).toBeCloseTo(0.5)
    })

    it('multiply: black * anything = black', () => {
      const [r, g, b] = cpuBlendPixel(...black, ...mid, 'multiply')
      expect(r).toBeCloseTo(0)
      expect(g).toBeCloseTo(0)
      expect(b).toBeCloseTo(0)
    })

    it('screen: black + mid = mid', () => {
      const [r, g, b] = cpuBlendPixel(...black, ...mid, 'screen')
      expect(r).toBeCloseTo(0.5)
      expect(g).toBeCloseTo(0.5)
      expect(b).toBeCloseTo(0.5)
    })

    it('screen: white + anything = white', () => {
      const [r, g, b] = cpuBlendPixel(...white, ...mid, 'screen')
      expect(r).toBeCloseTo(1)
      expect(g).toBeCloseTo(1)
      expect(b).toBeCloseTo(1)
    })

    it('darken: min of each channel', () => {
      const [r, g, b] = cpuBlendPixel(0.3, 0.7, 0.5, 0.6, 0.4, 0.8, 'darken')
      expect(r).toBeCloseTo(0.3)
      expect(g).toBeCloseTo(0.4)
      expect(b).toBeCloseTo(0.5)
    })

    it('lighten: max of each channel', () => {
      const [r, g, b] = cpuBlendPixel(0.3, 0.7, 0.5, 0.6, 0.4, 0.8, 'lighten')
      expect(r).toBeCloseTo(0.6)
      expect(g).toBeCloseTo(0.7)
      expect(b).toBeCloseTo(0.8)
    })

    it('add: clamped sum', () => {
      const [r, g, b] = cpuBlendPixel(0.7, 0.5, 0.3, 0.5, 0.7, 0.9, 'add')
      expect(r).toBeCloseTo(1)
      expect(g).toBeCloseTo(1)
      expect(b).toBeCloseTo(1)
    })

    it('difference: absolute difference', () => {
      const [r, g, b] = cpuBlendPixel(0.8, 0.3, 0.6, 0.5, 0.7, 0.2, 'difference')
      expect(r).toBeCloseTo(0.3)
      expect(g).toBeCloseTo(0.4)
      expect(b).toBeCloseTo(0.4)
    })

    it('exclusion: src + dst - 2*src*dst', () => {
      const [r] = cpuBlendPixel(0.5, 0, 0, 0.5, 0, 0, 'exclusion')
      expect(r).toBeCloseTo(0.5)
    })

    it('subtract: dst - src clamped', () => {
      const [r, g, b] = cpuBlendPixel(0.3, 0.8, 0.5, 0.5, 0.5, 0.5, 'subtract')
      expect(r).toBeCloseTo(0.2)
      expect(g).toBeCloseTo(0)
      expect(b).toBeCloseTo(0)
    })

    it('divide: dst / src clamped', () => {
      const [r] = cpuBlendPixel(0.5, 0.5, 0.5, 0.25, 0.25, 0.25, 'divide')
      expect(r).toBeCloseTo(0.5)
    })

    it('divide: by zero returns 1', () => {
      const [r] = cpuBlendPixel(0, 0, 0, 0.5, 0.5, 0.5, 'divide')
      expect(r).toBeCloseTo(1)
    })

    it('overlay: mid on mid', () => {
      const [r] = cpuBlendPixel(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 'overlay')
      expect(r).toBeCloseTo(0.5)
    })

    it('hardLight: mirrors overlay', () => {
      // hardLight(src, dst) = overlay(dst, src) conceptually — src controls the condition
      const [r] = cpuBlendPixel(0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 'hardLight')
      expect(r).toBeCloseTo(0.25)
    })

    it('linearLight: dst + 2*src - 1 clamped', () => {
      const [r] = cpuBlendPixel(0.75, 0.75, 0.75, 0.5, 0.5, 0.5, 'linearLight')
      expect(r).toBeCloseTo(1)
    })

    it('pinLight: conditional min/max', () => {
      // src < 0.5 → min(dst, 2*src)
      const [r] = cpuBlendPixel(0.25, 0.25, 0.25, 0.8, 0.8, 0.8, 'pinLight')
      expect(r).toBeCloseTo(0.5)
    })

    it('hardMix: thresholded vivid light', () => {
      const [r] = cpuBlendPixel(0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 'hardMix')
      expect(r).toBe(1)
      const [r2] = cpuBlendPixel(0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 'hardMix')
      expect(r2).toBe(0)
    })

    it('darkerColor: picks RGB triple with lower luminance', () => {
      const [r, g, b] = cpuBlendPixel(...red, ...blue, 'darkerColor')
      // blue luminance (0.114) < red luminance (0.299)
      expect(r).toBeCloseTo(0)
      expect(g).toBeCloseTo(0)
      expect(b).toBeCloseTo(1)
    })

    it('lighterColor: picks RGB triple with higher luminance', () => {
      const [r, g, b] = cpuBlendPixel(...red, ...blue, 'lighterColor')
      expect(r).toBeCloseTo(1)
      expect(g).toBeCloseTo(0)
      expect(b).toBeCloseTo(0)
    })

    it('dissolve: returns source', () => {
      const [r, g, b] = cpuBlendPixel(0.3, 0.6, 0.9, 0.1, 0.2, 0.3, 'dissolve')
      expect(r).toBeCloseTo(0.3)
      expect(g).toBeCloseTo(0.6)
      expect(b).toBeCloseTo(0.9)
    })

    it('normal: returns source', () => {
      const [r, g, b] = cpuBlendPixel(0.3, 0.6, 0.9, 0.1, 0.2, 0.3, 'normal')
      expect(r).toBeCloseTo(0.3)
      expect(g).toBeCloseTo(0.6)
      expect(b).toBeCloseTo(0.9)
    })
  })

  describe('cpuBlendLayers', () => {
    it('blends two 1-pixel images with multiply', () => {
      const src = new Uint8ClampedArray([128, 128, 128, 255])
      const dst = new Uint8ClampedArray([200, 200, 200, 255])
      const result = cpuBlendLayers(src, dst, 'multiply', 1)
      // 0.502 * 0.784 ≈ 0.394 → ~100
      expect(result[0]).toBeGreaterThan(90)
      expect(result[0]).toBeLessThan(110)
      expect(result[3]).toBe(255) // full alpha
    })

    it('respects opacity parameter', () => {
      const src = new Uint8ClampedArray([255, 0, 0, 255])
      const dst = new Uint8ClampedArray([0, 255, 0, 255])
      const full = cpuBlendLayers(src, dst, 'multiply', 1)
      const half = cpuBlendLayers(src, dst, 'multiply', 0.5)
      // At 50% opacity, result should be closer to dst (more green)
      expect(half[1]).toBeGreaterThan(full[1])
    })

    it('handles transparent source pixels', () => {
      const src = new Uint8ClampedArray([255, 0, 0, 0])
      const dst = new Uint8ClampedArray([0, 0, 255, 255])
      const result = cpuBlendLayers(src, dst, 'multiply', 1)
      // Transparent source → destination unchanged
      expect(result[2]).toBe(255)
    })

    it('handles normal mode', () => {
      const src = new Uint8ClampedArray([255, 0, 0, 128])
      const dst = new Uint8ClampedArray([0, 0, 255, 255])
      const result = cpuBlendLayers(src, dst, 'normal', 1)
      expect(result[3]).toBe(255)
    })
  })
})
