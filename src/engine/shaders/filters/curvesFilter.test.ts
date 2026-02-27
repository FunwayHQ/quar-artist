import { describe, it, expect } from 'vitest'
import { computeSingleChannelLUT, cpuApplyCurves } from './curvesFilter.ts'

describe('curvesFilter', () => {
  describe('computeSingleChannelLUT', () => {
    it('produces identity LUT for two endpoints', () => {
      const lut = computeSingleChannelLUT([
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ])
      expect(lut).toHaveLength(256)
      expect(lut[0]).toBeCloseTo(0, 2)
      expect(lut[255]).toBeCloseTo(1, 2)
      expect(lut[128]).toBeCloseTo(128 / 255, 1)
    })

    it('produces constant LUT for flat curve', () => {
      const lut = computeSingleChannelLUT([
        { x: 0, y: 128 },
        { x: 255, y: 128 },
      ])
      expect(lut[0]).toBeCloseTo(128 / 255, 2)
      expect(lut[255]).toBeCloseTo(128 / 255, 2)
      expect(lut[100]).toBeCloseTo(128 / 255, 1)
    })

    it('handles S-curve with middle point', () => {
      const lut = computeSingleChannelLUT([
        { x: 0, y: 0 },
        { x: 128, y: 200 },
        { x: 255, y: 255 },
      ])
      expect(lut[128]).toBeCloseTo(200 / 255, 1)
      for (let i = 0; i < 256; i++) {
        expect(lut[i]).toBeGreaterThanOrEqual(0)
        expect(lut[i]).toBeLessThanOrEqual(1)
      }
    })

    it('returns identity for less than 2 points', () => {
      const lut = computeSingleChannelLUT([{ x: 50, y: 50 }])
      expect(lut[0]).toBeCloseTo(0, 2)
      expect(lut[255]).toBeCloseTo(1, 2)
    })

    it('handles unsorted points', () => {
      const lut = computeSingleChannelLUT([
        { x: 255, y: 255 },
        { x: 0, y: 0 },
        { x: 128, y: 64 },
      ])
      expect(lut[0]).toBeCloseTo(0, 2)
      expect(lut[255]).toBeCloseTo(1, 2)
    })
  })

  describe('cpuApplyCurves', () => {
    it('identity curves leave pixels unchanged', () => {
      const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])
      const result = cpuApplyCurves(pixels, {
        rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      })
      expect(result).toHaveLength(8)
      // Red pixel: R=255, G=0, B=0, A=255
      expect(result[0]).toBe(255)
      expect(result[1]).toBe(0)
      expect(result[2]).toBe(0)
      expect(result[3]).toBe(255)
    })

    it('flat red curve clamps red to constant', () => {
      const pixels = new Uint8Array([200, 100, 50, 255])
      const result = cpuApplyCurves(pixels, {
        rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        red: [{ x: 0, y: 128 }, { x: 255, y: 128 }],
        green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      })
      expect(result[0]).toBeCloseTo(128, 0) // Red channel clamped to ~128
      expect(result[1]).toBe(100) // Green unchanged
      expect(result[2]).toBe(50) // Blue unchanged
    })

    it('preserves transparent pixels', () => {
      const pixels = new Uint8Array([0, 0, 0, 0])
      const result = cpuApplyCurves(pixels, {
        rgb: [{ x: 0, y: 128 }, { x: 255, y: 128 }],
        red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      })
      expect(result[0]).toBe(0)
      expect(result[1]).toBe(0)
      expect(result[2]).toBe(0)
      expect(result[3]).toBe(0)
    })
  })
})
