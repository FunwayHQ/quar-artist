import { describe, it, expect, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class MockGlProgram {
    static from() { return new MockGlProgram() }
  }
  class MockGpuProgram {
    static from() { return new MockGpuProgram() }
  }
  class MockFilter {
    resources: unknown
    constructor(opts: { resources?: unknown }) {
      this.resources = opts.resources
    }
  }
  class MockTexture {
    static from() { return new MockTexture() }
  }
  return {
    Filter: MockFilter,
    GlProgram: MockGlProgram,
    GpuProgram: MockGpuProgram,
    Texture: MockTexture,
  }
})

import { computeSingleChannelLUT, computeCurvesLUT, createCurvesFilter } from './curvesFilter.ts'

describe('curvesFilter', () => {
  describe('computeSingleChannelLUT', () => {
    it('produces identity LUT for two endpoints', () => {
      const lut = computeSingleChannelLUT([
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ])
      expect(lut).toHaveLength(256)
      // Check endpoints
      expect(lut[0]).toBeCloseTo(0, 2)
      expect(lut[255]).toBeCloseTo(1, 2)
      // Check midpoint is approximately identity
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
      // At x=128, should be close to 200/255
      expect(lut[128]).toBeCloseTo(200 / 255, 1)
      // Values should be clamped to [0, 1]
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
      // Should sort internally
      expect(lut[0]).toBeCloseTo(0, 2)
      expect(lut[255]).toBeCloseTo(1, 2)
    })
  })

  describe('computeCurvesLUT', () => {
    it('produces 256x4 RGBA data', () => {
      const data = computeCurvesLUT({
        rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      })
      expect(data).toHaveLength(256 * 4 * 4) // 256 wide, 4 rows, RGBA
    })

    it('identity channels produce identity LUT data', () => {
      const data = computeCurvesLUT({
        rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      })
      // First pixel of row 0 (RGB master) should be ~0
      expect(data[0]).toBe(0)
      // Last pixel of row 0 should be ~255
      const lastPixelRow0 = 255 * 4
      expect(data[lastPixelRow0]).toBe(255)
      // Alpha should always be 255
      expect(data[3]).toBe(255)
    })

    it('per-channel curves affect correct rows', () => {
      const data = computeCurvesLUT({
        rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        red: [{ x: 0, y: 128 }, { x: 255, y: 128 }], // flat at 128
        green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      })
      // Row 1 (red) should have all values near 128
      const midRow1 = (1 * 256 + 0) * 4
      expect(data[midRow1]).toBeCloseTo(128, 0)
      const endRow1 = (1 * 256 + 255) * 4
      expect(data[endRow1]).toBeCloseTo(128, 0)
    })
  })

  describe('createCurvesFilter', () => {
    it('creates a filter with LUT texture resource', async () => {
      const { Texture } = await import('pixi.js')
      const mockTexture = Texture.from('test')
      const filter = createCurvesFilter(mockTexture)
      expect(filter).toBeDefined()
      expect((filter as any).resources.curvesUniforms.uLutTexture.value).toBe(mockTexture)
    })
  })
})
